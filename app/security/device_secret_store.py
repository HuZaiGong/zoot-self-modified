"""Device-bound storage for application secrets.

The encrypted payload is kept outside the configuration database.

Platform backends (selected automatically at runtime):

* Windows: DPAPI (``win32crypt``) bound to the current user account.
* Android: delegates to the application's Keystore bridge (Chaquopy).
* Linux / macOS / any other desktop: XChaCha20-Poly1305 (``cryptography``)
  with a per-installation machine key stored next to the payload with
  owner-only permissions (0600).
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import sys
import time
from pathlib import Path
from threading import RLock
from typing import Dict

_MAGIC_XCHACHA = b"ZOOT-SECRETS-V1"
_MAGIC_CHACHA = b"ZOOT-SECRETS-V2"
_NONCE_XCHACHA = 24
_NONCE_CHACHA = 12


class DeviceSecretStoreError(RuntimeError):
    """Raised when a secret cannot be safely protected or restored."""

    def __init__(self, message: str, code: str = "secret_store_unavailable") -> None:
        super().__init__(message)
        self.code = str(code)


SECRET_STORE_UNREADABLE_HINT = "设备密钥存储无法解密（可能因系统账户变更、数据从其他设备迁移或密钥库失效）。请重新输入并保存 API 密钥，保存时会自动重建密钥存储。"


def _import_aead():
    try:
        from cryptography.hazmat.primitives.ciphers.aead import XChaCha20Poly1305

        return XChaCha20Poly1305, _MAGIC_XCHACHA, _NONCE_XCHACHA
    except ImportError:
        from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

        return ChaCha20Poly1305, _MAGIC_CHACHA, _NONCE_CHACHA
    except Exception as exc:
        raise DeviceSecretStoreError(
            "cryptography 不可用（桌面密钥存储需要安装 cryptography）",
            "secret_store_unavailable",
        ) from exc


def _import_aead_variant(magic: bytes):
    try:
        from cryptography.hazmat.primitives.ciphers.aead import XChaCha20Poly1305

        xchacha = XChaCha20Poly1305
    except ImportError:
        xchacha = None
    from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

    if magic == _MAGIC_XCHACHA:
        if xchacha is None:
            raise DeviceSecretStoreError(
                "设备密钥存储无法解密：当前 cryptography 版本不支持该密钥格式"
            )
        return xchacha, _NONCE_XCHACHA
    return ChaCha20Poly1305, _NONCE_CHACHA


class DeviceSecretStore:
    ALIAS = "zoot_device_secrets_v1"

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = RLock()

    # ------------------------------------------------------------------
    # Platform protection backends
    # ------------------------------------------------------------------

    def _protect(self, value: bytes) -> bytes:
        if hasattr(sys, "getandroidapilevel"):
            try:
                from java import jclass

                bridge = jclass("com.rhodesisland.zoot.DeviceIdentityBridge")
                encoded = bridge.encryptSecret(
                    self.ALIAS, base64.b64encode(value).decode("ascii")
                )
            except Exception as exc:
                raise DeviceSecretStoreError(f"Android Keystore 不可用：{exc}") from exc
            return base64.b64decode(str(encoded))
        if os.name == "nt":
            try:
                import win32crypt

                return win32crypt.CryptProtectData(
                    value, "ZOOT Device Secrets", None, None, None, 0
                )
            except Exception as exc:
                if not _cryptography_available():
                    raise DeviceSecretStoreError(f"Windows DPAPI 不可用：{exc}") from exc
                return self._protect_software(value)
        return self._protect_software(value)

    def _unprotect(self, value: bytes) -> bytes:
        if hasattr(sys, "getandroidapilevel"):
            try:
                from java import jclass

                bridge = jclass("com.rhodesisland.zoot.DeviceIdentityBridge")
                decoded = bridge.decryptSecret(
                    self.ALIAS, base64.b64encode(value).decode("ascii")
                )
            except Exception as exc:
                raise DeviceSecretStoreError(f"Android Keystore 解密失败：{exc}") from exc
            return base64.b64decode(str(decoded))
        if os.name == "nt":
            try:
                import win32crypt

                return win32crypt.CryptUnprotectData(value, None, None, None, 0)[1]
            except Exception as exc:
                if self._software_payload(value):
                    return self._unprotect_software(value)
                raise DeviceSecretStoreError(f"Windows DPAPI 解密失败：{exc}") from exc
        if self._software_payload(value):
            return self._unprotect_software(value)
        raise DeviceSecretStoreError(
            "设备密钥存储无法读取：数据不是本机可识别的格式"
        )

    # ------------------------------------------------------------------
    # Software backend (cryptography, non-Windows or DPAPI fallback)
    # ------------------------------------------------------------------

    @staticmethod
    def _software_payload(value: bytes) -> bool:
        return value.startswith(_MAGIC_XCHACHA) or value.startswith(_MAGIC_CHACHA)

    def _key_path(self) -> Path:
        return self.path.with_name(self.path.name + ".key")

    def _machine_key(self) -> bytes:
        key_path = self._key_path()
        if key_path.exists():
            return key_path.read_bytes()
        key_path.parent.mkdir(parents=True, exist_ok=True)
        key = secrets.token_bytes(32)
        key_path.write_bytes(key)
        try:
            os.chmod(key_path, 0o600)
        except OSError:
            pass
        return key

    def _protect_software(self, value: bytes) -> bytes:
        try:
            cipher_class, magic, nonce_length = _import_aead()
            cipher = cipher_class(self._machine_key())
        except DeviceSecretStoreError:
            raise
        except Exception as exc:
            raise DeviceSecretStoreError(f"软件密钥存储不可用：{exc}") from exc
        nonce = secrets.token_bytes(nonce_length)
        ciphertext = cipher.encrypt(nonce, value, None)
        return magic + nonce + ciphertext

    def _unprotect_software(self, value: bytes) -> bytes:
        try:
            if value.startswith(_MAGIC_XCHACHA):
                cipher_class, nonce_length = _import_aead_variant(_MAGIC_XCHACHA)
                magic = _MAGIC_XCHACHA
            elif value.startswith(_MAGIC_CHACHA):
                cipher_class, nonce_length = _import_aead_variant(_MAGIC_CHACHA)
                magic = _MAGIC_CHACHA
            else:
                raise DeviceSecretStoreError("设备密钥存储无法解密：未知的密钥格式")
            cipher = cipher_class(self._machine_key())
        except DeviceSecretStoreError:
            raise
        except Exception as exc:
            raise DeviceSecretStoreError(f"软件密钥存储不可用：{exc}") from exc
        nonce = value[len(magic):len(magic) + nonce_length]
        ciphertext = value[len(magic) + nonce_length:]
        try:
            return cipher.decrypt(nonce, ciphertext, None)
        except Exception as exc:
            raise DeviceSecretStoreError(f"设备密钥存储无法解密：{exc}") from exc

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load_all(self) -> Dict[str, str]:
        if not self.path.exists():
            return {}
        try:
            protected = base64.b64decode(
                self.path.read_text(encoding="ascii"), validate=True
            )
            payload = json.loads(
                self._unprotect(protected).decode("utf-8")
            )
            if not isinstance(payload, dict):
                raise ValueError("secret payload is not an object")
            return {
                str(key): str(value)
                for key, value in payload.items()
                if isinstance(value, str)
            }
        except Exception as exc:
            raise DeviceSecretStoreError(f"设备密钥存储无法读取：{exc}") from exc

    def _save_all(self, values: Dict[str, str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
        encoded = base64.b64encode(self._protect(raw)).decode("ascii")
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        with open(temporary, "w", encoding="ascii", newline="") as handle:
            handle.write(encoded)
        os.replace(str(temporary), str(self.path))
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def _quarantine_unreadable(self) -> None:
        try:
            if self.path.exists():
                stamp = time.strftime("%Y%m%d%H%M%S")
                target = self.path.with_name(f"{self.path.name}.unreadable-{stamp}")
                os.replace(str(self.path), str(target))
        except OSError:
            pass

    def probe_read(self) -> None:
        with self._lock:
            self._load_all()

    def items(self) -> Dict[str, str]:
        with self._lock:
            return dict(self._load_all())

    def status(self) -> Dict[str, object]:
        try:
            self.probe_read()
            self.probe()
            return {
                "status": "ready",
                "payload_exists": self.path.exists(),
                "error_code": "",
            }
        except DeviceSecretStoreError as exc:
            message = str(exc).lower()
            if "class" in message or "deviceidentitybridge" in message:
                code = "secret_bridge_missing"
            elif self.path.exists() and any(
                key in message for key in ("decrypt", "解密", "读取")
            ):
                code = "secret_payload_unreadable"
            else:
                code = getattr(exc, "code", "secret_store_unavailable")
            status = "unreadable" if code == "secret_payload_unreadable" else "store_unavailable"
            return {
                "status": status,
                "payload_exists": self.path.exists(),
                "error_code": code,
            }

    def _load_all_or_heal(self) -> Dict[str, str]:
        try:
            return self._load_all()
        except DeviceSecretStoreError:
            self._quarantine_unreadable()
            return {}

    def get(self, key: str, default: str = "") -> str:
        with self._lock:
            return self._load_all().get(str(key), default)

    def set(self, key: str, value: str) -> None:
        with self._lock:
            values = self._load_all_or_heal()
            values[str(key)] = str(value)
            self._save_all(values)
            if self._load_all().get(str(key)) != str(value):
                raise DeviceSecretStoreError("设备密钥写入校验失败")

    def delete(self, key: str) -> None:
        with self._lock:
            values = self._load_all_or_heal()
            if str(key) not in values:
                return
            values.pop(str(key), None)
            self._save_all(values)

    def probe(self) -> bool:
        sample = secrets.token_bytes(32)
        return self._unprotect(self._protect(sample)) == sample


def _cryptography_available() -> bool:
    try:
        import cryptography  # noqa: F401

        return True
    except ImportError:
        return False
