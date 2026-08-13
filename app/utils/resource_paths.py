"""Resolve and verify immutable resources on desktop and Android."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Dict, Optional

from .writable import get_writable_path


def bundled_resource_path(filename: str) -> Optional[Path]:
    relative = Path(filename)
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
    target = Path(get_writable_path(f"resources/{filename}"))
    manifest_name = filename.replace(".db", ".manifest.json")
    manifest = load_resource_manifest(manifest_name) if filename.endswith(".db") else {}
    if target.is_file() and verify_resource(target, manifest):
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
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
        if manifest and not verify_resource(temporary, manifest):
            raise ValueError(f"Bundled resource checksum mismatch: {filename}")
        os.replace(temporary, target)
        return target
    except Exception:
        temporary.unlink(missing_ok=True)
        return None
