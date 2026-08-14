"""Resolve and verify immutable resources on desktop and Android."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
from pathlib import Path
from typing import Dict, Optional

from .writable import get_writable_path

_android_asset_lock = threading.RLock()
_refreshed_android_manifests: set[str] = set()


def bundled_resource_path(filename: str) -> Optional[Path]:
    relative = Path(filename)
    is_manifest = relative.name == "manifest.json" or relative.name.endswith(
        ".manifest.json"
    )
    if hasattr(sys, "getandroidapilevel") and is_manifest:
        refreshed = _copy_android_asset(relative.as_posix())
        if refreshed is not None:
            return refreshed
    candidates: list[Path] = []
    override = os.getenv("ZOOT_RESOURCE_ROOT", "").strip()
    if override:
        candidates.append(Path(override).expanduser() / relative)
    if hasattr(sys, "_MEIPASS"):
        candidates.append(Path(sys._MEIPASS) / "resources" / relative)
    candidates.extend(
        [
            Path(__file__).resolve().parents[2] / "resources" / relative,
            Path.cwd() / "resources" / relative,
        ]
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    if hasattr(sys, "getandroidapilevel"):
        return _copy_android_asset(relative.as_posix())
    return None


def load_resource_manifest(name: str) -> Dict[str, object]:
    path = bundled_resource_path(name)
    if path is None:
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if isinstance(value, dict):
        return value
    return {}


def verify_resource(path: Path, manifest: Dict[str, object]) -> bool:
    expected_size = int(manifest.get("size") or 0)
    expected_sha256 = str(manifest.get("sha256") or "").lower()
    if expected_size and path.stat().st_size != expected_size:
        return False
    if not expected_sha256:
        return True
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1048576), b""):
            digest.update(chunk)
    return digest.hexdigest() == expected_sha256


def _copy_android_asset(filename: str) -> Optional[Path]:
    with _android_asset_lock:
        target = Path(get_writable_path(f"resources/{filename}"))
        resource_name = Path(filename).name
        is_manifest = resource_name == "manifest.json" or resource_name.endswith(
            ".manifest.json"
        )
        if is_manifest:
            if filename in _refreshed_android_manifests and target.is_file():
                return target
            manifest: Dict[str, object] = {}
        else:
            manifest_name = filename.replace(".db", ".manifest.json")
            manifest = (
                load_resource_manifest(manifest_name)
                if filename.endswith(".db")
                else {}
            )
            if target.is_file() and verify_resource(target, manifest):
                return target
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f"{target.name}.tmp")
        try:
            from java import jclass

            python = jclass("com.chaquo.python.Python")
            application = python.getPlatform().getApplication()
            stream = application.getAssets().open(filename)
            try:
                with temporary.open("wb") as output:
                    buffer = bytearray(1048576)
                    while True:
                        count = stream.read(buffer)
                        if count == -1:
                            break
                        output.write(bytes(buffer[:count]))
            finally:
                stream.close()
            if is_manifest:
                payload = json.loads(temporary.read_text(encoding="utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError(f"Bundled manifest is invalid: {filename}")
            elif manifest and not verify_resource(temporary, manifest):
                raise ValueError(f"Bundled resource checksum mismatch: {filename}")
            os.replace(temporary, target)
            if is_manifest:
                _refreshed_android_manifests.add(filename)
            return target
        except Exception:
            temporary.unlink(missing_ok=True)
            return None
