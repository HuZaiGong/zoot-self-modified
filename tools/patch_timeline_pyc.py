"""Apply the fork_points binding-count fix to app/services/timeline_service.pyc.

The backend ships as Python 3.13 bytecode (extracted from the original APK).

Bug: in ``TimelineService.fork_points`` the query that loads
``timeline_branches`` builds its SQL placeholders from the requested message
uids (``uids``: one ``?`` per uid plus one for ``scope_key``) but supplies the
parameters as ``(*messages.keys(), conversation_key)``. ``messages`` only
contains uids that still resolve to a live message row, so when any requested
uid references a deleted or missing message the binding count comes up short
and sqlite3 raises ``ProgrammingError: Incorrect number of bindings
supplied``. The mismatch grows as the conversation accumulates fork points
(the server log shows "uses N, N-1 supplied" repeatedly).

Fix: build the parameter tuple from ``uids`` so it matches the placeholders.
Branches whose fork message no longer exists are skipped later in the same
loop (``uid not in messages -> continue``), so the result is unchanged.

Patched bytecode region (source line 333 of ``fork_points``)::

    BUILD_LIST 0
    LOAD_FAST uids              # was: LOAD_FAST messages; LOAD_ATTR keys; CALL 0
    NOP * N                     # padding keeps every later offset unchanged
    LIST_EXTEND 1
    LOAD_FAST conversation_key
    LIST_APPEND 1

Usage::

    python tools/patch_timeline_pyc.py [path/to/app/services/timeline_service.pyc]

Idempotent: already-patched bytecode is skipped. A backup of the previous
bytecode is kept as ``timeline_service.pyc.bak`` next to the target.
"""

from __future__ import annotations

import dis
import importlib.util
import marshal
import pathlib
import shutil
import sys
import types


def _find_code(code, name):
    if code.co_name == name:
        return code
    for const in code.co_consts:
        if isinstance(const, types.CodeType):
            found = _find_code(const, name)
            if found is not None:
                return found
    return None


def _instruction_span(instrs, index):
    """Return (offset, size) of the real instruction at ``index``.

    ``dis.get_instructions`` hides inline cache slots in 3.13, so the size is
    derived from the gap to the next real instruction; the final instruction
    of a code object is always a plain 2-byte instruction.
    """
    offset = instrs[index].offset
    if index + 1 < len(instrs):
        size = instrs[index + 1].offset - offset
    else:
        size = 2
    return offset, size


def patch_fork_points(code, changed):
    if code.co_name != "fork_points":
        return code
    try:
        uids_index = code.co_varnames.index("uids")
        messages_index = code.co_varnames.index("messages")
        conversation_index = code.co_varnames.index("conversation_key")
    except ValueError:
        return code
    if max(uids_index, messages_index, conversation_index) > 255:
        raise SystemExit("fork_points: cannot patch: local index > 255")

    instrs = list(dis.get_instructions(code))
    matches = []
    for i, instr in enumerate(instrs):
        if i + 6 >= len(instrs):
            break
        window = instrs[i : i + 7]
        if (
            window[0].opname == "BUILD_LIST"
            and window[0].arg == 0
            and window[1].opname == "LOAD_FAST"
            and window[1].argval == "messages"
            and window[2].opname == "LOAD_ATTR"
            and window[2].argval == "keys"
            and window[3].opname == "CALL"
            and window[3].arg == 0
            and window[4].opname == "LIST_EXTEND"
            and window[4].arg == 1
            and window[5].opname == "LOAD_FAST"
            and window[5].argval == "conversation_key"
            and window[6].opname == "LIST_APPEND"
            and window[6].arg == 1
        ):
            matches.append(i)

    if not matches:
        return code
    if len(matches) > 1:
        raise SystemExit("fork_points: ambiguous patch site: %d matches" % len(matches))
    index = matches[0]

    load_fast = instrs[index + 1]
    load_attr = instrs[index + 2]
    call = instrs[index + 3]
    if load_fast.arg != messages_index:
        raise SystemExit(
            "fork_points: unexpected messages local index %d" % load_fast.arg
        )

    load_fast_offset, load_fast_size = _instruction_span(instrs, index + 1)
    _, load_attr_size = _instruction_span(instrs, index + 2)
    _, call_size = _instruction_span(instrs, index + 3)
    if load_fast_size != 2:
        raise SystemExit(
            "fork_points: unexpected LOAD_FAST size %d" % load_fast_size
        )

    fill_start = load_attr.offset
    fill_end = call.offset + call_size

    nop = dis.opmap["NOP"]
    load_fast_op = dis.opmap["LOAD_FAST"]

    co_code = bytearray(code.co_code)
    co_code[load_fast_offset] = load_fast_op
    co_code[load_fast_offset + 1] = uids_index
    for offset in range(fill_start, fill_end):
        co_code[offset] = nop

    changed.append((code.co_name, "messages.keys()", "uids"))
    return code.replace(co_code=bytes(co_code))


def patch_tree(code, changed):
    code = patch_fork_points(code, changed)
    return code.replace(
        co_consts=tuple(
            patch_tree(const, changed)
            if isinstance(const, types.CodeType)
            else const
            for const in code.co_consts
        )
    )


def main(argv):
    target = pathlib.Path(argv[1]) if len(argv) > 1 else None
    if target is None:
        candidate = (
            pathlib.Path(__file__).resolve().parents[1]
            / "app"
            / "services"
            / "timeline_service.pyc"
        )
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
        print(f"patched {name}: {old} -> {new}")
    print(f"backup written to {backup}")
    return 0


def _find_trailing(body):
    for offset in range(len(body), -1, -1):
        try:
            marshal.loads(body[:offset])
            return body[offset:]
        except (EOFError, ValueError):
            continue
    return b""


if __name__ == "__main__":
    sys.exit(main(sys.argv))
