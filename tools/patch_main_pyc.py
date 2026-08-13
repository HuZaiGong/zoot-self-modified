"""Apply the cross-platform desktop patches to app/main.pyc.

The backend ships as Python 3.13 bytecode (extracted from the original APK).
This script rewrites the platform constants that were hardcoded to ``android``
so the PC port reports/requests the ``pc`` platform:

* module level: PluginRuntime / archive router / update router platform
* lifespan(): CloudService platform
* get_local_version(): ``platform`` field returned to the frontend
* get_local_origin_device_id(): fallback device id
* device_fabric_capability_loop(): capability published to LAN peers

Usage:

    python tools/patch_main_pyc.py [path/to/app/main.pyc]

Run it after extracting a fresh ``main.pyc`` from the APK. It is idempotent:
already-patched constants are skipped. A backup of the previous bytecode is
kept as ``main.pyc.bak`` next to the target.
"""

from __future__ import annotations

import importlib.util
import marshal
import pathlib
import shutil
import sys

REPLACEMENTS = {
    "<module>": ("android", "pc"),
    "lifespan": ("android", "pc"),
    "get_local_version": ("android", "pc"),
    "get_local_origin_device_id": ("android-local", "desktop-local"),
    "device_fabric_capability_loop": ("android", "pc"),
}


def patch_tree(code, changed):
    old, new = REPLACEMENTS.get(code.co_name, (None, None))
    if old is not None and old in code.co_consts:
        code = code.replace(
            co_consts=tuple(new if c == old else c for c in code.co_consts)
        )
        changed.append((code.co_name, old, new))
    return code.replace(
        co_consts=tuple(
            patch_tree(c, changed) if isinstance(c, type(code)) else c
            for c in code.co_consts
        )
    )


def main(argv):
    target = pathlib.Path(argv[1]) if len(argv) > 1 else None
    if target is None:
        candidate = pathlib.Path(__file__).resolve().parents[1] / "app" / "main.pyc"
        target = candidate
    target = target.resolve()
    if not target.exists():
        raise SystemExit(f"{target} does not exist")

    raw = target.read_bytes()
    header = raw[:16]
    if header[:4] != importlib.util.MAGIC_NUMBER:
        raise SystemExit(
            f"{target.name} was compiled for a different Python version "
            f"(magic {header[:4].hex()}, expected {importlib.util.MAGIC_NUMBER.hex()})"
        )
    body = raw[16:]
    root = marshal.loads(body)
    trailing = _find_trailing(body)

    changed = []
    root = patch_tree(root, changed)

    if not changed:
        print(f"{target}: already patched, nothing to do")
        return 0

    backup = target.with_name(target.name + ".bak")
    shutil.copy2(target, backup)
    target.write_bytes(header + marshal.dumps(root) + trailing)
    for name, old, new in changed:
        print(f"patched {name}: {old!r} -> {new!r}")
    print(f"backup written to {backup}")
    return 0


def _find_trailing(body: bytes) -> bytes:
    for offset in range(len(body), -1, -1):
        try:
            marshal.loads(body[:offset])
            return body[offset:]
        except (EOFError, ValueError):
            continue
    return b""


if __name__ == "__main__":
    sys.exit(main(sys.argv))
