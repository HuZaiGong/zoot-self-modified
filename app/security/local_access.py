"""Process-local authorization for the embedded ZOOT HTTP service."""

from __future__ import annotations

import hmac
import ipaddress
import os
import secrets
import sys
import threading
import time
from http.cookies import SimpleCookie
from typing import Dict, Optional
from urllib.parse import urlsplit

LOCAL_SESSION_COOKIE = "zoot_local_session"

_PUBLIC_PREFIXES = ("/css/", "/fonts/", "/images/", "/js/", "/static/")

_PUBLIC_PATHS = {"/ping", "/favicon.ico", "/__local/bootstrap", "/api/startup_progress"}

_LAN_PREFIXES = ("/sync/v2/",)

_LAN_PATHS = {
    "/device-fabric/pairing/offer",
    "/device-fabric/signed-ingress",
    "/device-fabric/pairing/accept",
    "/device-fabric/signed-envelope",
}


def _client_host(scope: Dict[str, object]) -> str:
    client = scope.get("client")
    if isinstance(client, (list, tuple)) and client:
        return str(client[0] or "")
    return ""


def _is_loopback(host: str) -> bool:
    if host == "testclient":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host.lower() == "localhost"


def _headers(scope: Dict[str, object]) -> Dict[str, str]:
    result = {}
    for raw_name, raw_value in scope.get("headers", []):
        name = raw_name.decode("latin-1").lower()
        value = raw_value.decode("latin-1")
        result[name] = value
    return result


class LocalAccessPolicy:
    """Authorize requests to a single embedded-server process.

    The policy intentionally keeps all tokens in memory. Restarting the process
    invalidates both bootstrap tokens and browser sessions.
    """

    def __init__(self) -> None:
        self._session_secret = secrets.token_urlsafe(32)
        self._bootstrap_tokens = {}
        self._lock = threading.RLock()

    def issue_bootstrap_token(self, ttl_seconds: int = 120) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._remove_expired_tokens()
            self._bootstrap_tokens[token] = time.monotonic() + max(15, ttl_seconds)
        return token

    def consume_bootstrap_token(self, token: str) -> bool:
        with self._lock:
            self._remove_expired_tokens()
            expires_at = self._bootstrap_tokens.pop(str(token or ""), None)
        return expires_at is not None and expires_at >= time.monotonic()

    def session_cookie_value(self) -> str:
        return self._session_secret

    def internal_header_value(self) -> str:
        return self._session_secret

    def is_valid_internal_header(self, value: str) -> bool:
        return bool(value) and hmac.compare_digest(str(value), self._session_secret)

    def is_valid_cookie_header(self, cookie_header: str) -> bool:
        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header or "")
            morsel = cookie.get(LOCAL_SESSION_COOKIE)
            return bool(
                morsel and hmac.compare_digest(str(morsel.value), self._session_secret)
            )
        except Exception:
            return False

    def _remove_expired_tokens(self) -> None:
        now = time.monotonic()
        expired = [
            token
            for token, expires_at in self._bootstrap_tokens.items()
            if expires_at < now
        ]
        for token in expired:
            self._bootstrap_tokens.pop(token, None)


class LanAccessGate:
    """Decide whether the small authenticated LAN surface is currently open.

    The default ``auto`` mode creates no extra user setting: trusted devices
    enable Sync v2, while an explicit local pairing session temporarily enables
    only the pairing offer endpoint. A deployment may force the gate with
    ``ZOOT_LAN_SYNC_ENABLED=0|1``.
    """

    def configured_mode(self) -> str:
        value = os.getenv("ZOOT_LAN_SYNC_ENABLED", "auto").strip().lower()
        if value in {"true", "1", "yes", "on"}:
            return "enabled"
        if value in {"0", "off", "false", "no"}:
            return "disabled"
        return "auto"

    def allows(self, path: str) -> bool:
        mode = self.configured_mode()
        if mode == "disabled":
            return False
        if mode == "enabled":
            return True
        if path == "/device-fabric/pairing/accept":
            return True
        try:
            from ..api.device_fabric import get_device_fabric_service

            service = get_device_fabric_service(required=False)
        except Exception:
            return False
        if service is None:
            return False
        if path == "/device-fabric/pairing/offer":
            now = time.time()
            return any(
                item.get("state") in {"pending_confirmation", "open"}
                and float(item.get("expires_at") or 0) > now
                for item in service.pairing_sessions()
            )
        return bool(service.trusted_devices)

    def status(self) -> Dict[str, object]:
        mode = self.configured_mode()
        try:
            from ..api.device_fabric import get_device_fabric_service

            service = get_device_fabric_service(required=False)
            trusted_count = len(service.trusted_devices) if service else 0
            pairing_open = bool(
                service
                and any(
                    item.get("state") in {"pending_confirmation", "open"}
                    for item in service.pairing_sessions()
                )
            )
        except Exception:
            trusted_count = 0
            pairing_open = False
        return {
            "mode": mode,
            "sync_accepting": mode == "enabled"
            or (mode == "auto" and trusted_count > 0),
            "trusted_device_count": trusted_count,
            "pairing_open": pairing_open,
        }


class LocalAccessMiddleware:
    """ASGI middleware which protects HTTP and WebSocket control surfaces."""

    def __init__(
        self,
        app,
        policy: Optional[LocalAccessPolicy] = None,
        allow_development_entry: Optional[bool] = None,
        lan_gate: Optional[LanAccessGate] = None,
    ) -> None:
        self.app = app
        self.policy = policy or get_local_access_policy()
        self.allow_development_entry = (
            _pc_source_development_mode()
            if allow_development_entry is None
            else bool(allow_development_entry)
        )
        self.lan_gate = lan_gate or get_lan_access_gate()

    async def __call__(self, scope, receive, send) -> None:
        scope_type = scope.get("type")
        if scope_type not in {"websocket", "http"}:
            await self.app(scope, receive, send)
            return

        path = str(scope.get("path") or "/")
        client_host = _client_host(scope)
        headers = _headers(scope)
        loopback = _is_loopback(client_host)

        if client_host == "testclient":
            await self._call_with_security_headers(scope, receive, send)
            return

        if not loopback:
            if path.startswith("/sync/") and not path.startswith("/sync/v2/"):
                await self._reject(scope_type, send, 404, "not found")
                return
            if path in _LAN_PATHS and not any(
                path.startswith(prefix) for prefix in _LAN_PREFIXES
            ):
                await self._reject(scope_type, send, 403, "LAN access denied")
                return
            if not self.lan_gate.allows(path):
                await self._reject(scope_type, send, 403, "LAN sync disabled")
                return
            await self._call_with_security_headers(scope, receive, send)
            return

        if path.startswith("/sync/") and not path.startswith("/sync/v2/"):
            if not _legacy_sync_enabled():
                await self._reject(scope_type, send, 404, "not found")
                return

        development_entry = self._is_development_entry(scope, headers, path)

        is_public = path in _PUBLIC_PATHS or any(
            path.startswith(prefix) for prefix in _PUBLIC_PREFIXES
        )

        authenticated = self.policy.is_valid_cookie_header(
            headers.get("cookie", "")
        ) or self.policy.is_valid_internal_header(
            headers.get("x-zoot-local-internal", "")
        )

        if (
            loopback
            and not authenticated
            and not is_public
            and path == "/"
            and str(scope.get("method") or "GET").upper() in {"GET", "HEAD"}
        ):
            await self._redirect_to_bootstrap(scope, send)
            return

        if not is_public and not authenticated and not development_entry:
            await self._reject(scope_type, send, 401, "local session required")
            return

        if authenticated and not self._origin_is_allowed(scope, headers):
            await self._reject(scope_type, send, 403, "origin denied")
            return

        await self._call_with_security_headers(
            scope,
            receive,
            send,
            establish_development_session=development_entry and not authenticated,
        )

    async def _redirect_to_bootstrap(self, scope: Dict[str, object], send) -> None:
        """Auto-login for a plain loopback visit to ``/``.

        Lets ``http://127.0.0.1:<port>/`` land on the home page without the
        launcher: the server issues a fresh single-use bootstrap token and
        redirects through ``/__local/bootstrap``, which swaps it for the
        ``zoot_local_session`` cookie. Non-loopback clients never reach this
        branch, so the LAN surface stays gated as before.
        """
        from urllib.parse import quote

        token = self.policy.issue_bootstrap_token()
        next_path = quote("/static/index.html", safe="")
        headers = _headers(scope)
        scheme = str(scope.get("scheme") or "http")
        host = headers.get("host", "")
        base = f"{scheme}://{host}"
        location = (
            f"{base}/__local/bootstrap?token={token}&next={next_path}"
        )
        body = b""
        await send(
            {
                "type": "http.response.start",
                "status": 302,
                "headers": [
                    (b"location", location.encode("ascii")),
                    (b"content-length", b"0"),
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"x-frame-options", b"SAMEORIGIN"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    def _is_development_entry(
        self, scope: Dict[str, object], headers: Dict[str, str], path: str
    ) -> bool:
        if not self.allow_development_entry:
            return False
        if str(scope.get("type") or "") != "http":
            return False
        if str(scope.get("method") or "GET").upper() not in {"GET", "HEAD"}:
            return False
        if path in {"/", "/test"}:
            return False
        try:
            parsed = urlsplit("//" + headers.get("host", ""))
        except ValueError:
            return False
        return parsed.hostname in {"localhost", "::1", "127.0.0.1"} and parsed.port == 8000

    def _origin_is_allowed(
        self, scope: Dict[str, object], headers: Dict[str, str]
    ) -> bool:
        origin = headers.get("origin", "")
        if not origin:
            return True
        scheme = str(scope.get("scheme") or "http")
        if scheme == "ws":
            scheme = "http"
        elif scheme == "wss":
            scheme = "https"
        host = headers.get("host", "")
        return origin.rstrip("/") == f"{scheme}://{host}".rstrip("/")

    async def _call_with_security_headers(
        self, scope, receive, send, establish_development_session: bool = False
    ) -> None:
        async def send_with_headers(message):
            if message.get("type") == "http.response.start":
                response_headers = list(message.get("headers") or [])
                if establish_development_session:
                    cookie_value = (
                        f"{LOCAL_SESSION_COOKIE}={self.policy.session_cookie_value()}; HttpOnly; Path=/; SameSite=Strict"
                    )
                    response_headers.append(
                        (b"set-cookie", cookie_value.encode("ascii"))
                    )
                response_headers.extend(
                    [
                        (b"x-content-type-options", b"nosniff"),
                        (b"referrer-policy", b"no-referrer"),
                        (b"x-frame-options", b"SAMEORIGIN"),
                        (
                            b"content-security-policy",
                            b"default-src 'self' data: blob:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' ws: wss: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self' blob:;",
                        ),
                    ]
                )
                message["headers"] = response_headers
            await send(message)

        await self.app(scope, receive, send_with_headers)

    async def _reject(
        self, scope_type: str, send, status: int, detail: str
    ) -> None:
        try:
            from ..services.system_center import get_system_center_service

            get_system_center_service().store.record_security_event(
                {
                    "LAN access denied": "lan_access",
                    "LAN sync disabled": "lan_gate",
                    "origin denied": "origin_check",
                    "local session required": "local_session",
                    "not found": "legacy_sync",
                }.get(detail, "access_control"),
                source_type="websocket" if scope_type == "websocket" else "http",
                result=f"rejected:{status}",
            )
        except Exception:
            pass

        if scope_type == "websocket":
            await send({"type": "websocket.close", "code": 4401})
            return
        body = ('{"detail":"' + detail.replace('"', "") + '"}').encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json; charset=utf-8"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"x-content-type-options", b"nosniff"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


def _legacy_sync_enabled() -> bool:
    return (
        os.getenv("ZOOT_ENABLE_LEGACY_SYNC", "").strip().lower()
        in {"true", "1", "yes"}
    )


def _pc_source_development_mode() -> bool:
    configured = os.getenv("ZOOT_DEV_MODE")
    if configured is not None and configured.strip():
        return configured.strip().lower() in {"true", "1", "yes", "on"}
    return not bool(getattr(sys, "frozen", False))


_POLICY = LocalAccessPolicy()
_LAN_GATE = LanAccessGate()


def get_local_access_policy() -> LocalAccessPolicy:
    return _POLICY


def get_lan_access_gate() -> LanAccessGate:
    return _LAN_GATE


def local_access_security_status() -> Dict[str, object]:
    return {
        "local_session_required": True,
        "origin_protection": True,
        "websocket_session_protection": True,
        "legacy_sync_enabled": _legacy_sync_enabled(),
        "lan": _LAN_GATE.status(),
    }
