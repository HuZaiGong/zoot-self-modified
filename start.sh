#!/usr/bin/env bash
# ZOOT 一键启动（Linux / macOS）
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-55000}"

find_python() {
    for candidate in \
        "$(pwd)/venv/bin/python" \
        "$(pwd)/../venv/bin/python" \
        "$(command -v python3 2>/dev/null || true)" \
        "$(command -v python 2>/dev/null || true)"; do
        if [[ -n "${candidate}" && -x "${candidate}" ]]; then
            echo "${candidate}"
            return 0
        fi
    done
    return 1
}

PY="$(find_python || true)"
if [[ -z "${PY}" ]]; then
    echo "未找到 Python，请先安装 Python 3.13 并创建虚拟环境（见 README）。" >&2
    exit 1
fi

export PYTHONIOENCODING=utf-8
exec "${PY}" "$(pwd)/launch.py" --port "${PORT}"
