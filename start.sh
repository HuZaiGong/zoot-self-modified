#!/usr/bin/env bash
# ZOOT 一键启动（Linux / macOS）
# 首次运行自动：校验 Python 3.13 -> (缺则用 uv 安装) -> 建 venv -> 装依赖 -> 启动
set -euo pipefail
cd "$(dirname "$0")"

# 首个参数为纯数字时视为端口，其余参数（如 --no-browser）原样透传给 launch.py
if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    PORT="$1"
    shift
else
    PORT=55000
fi
PY_TARGET="3.13"

# 仅接受 3.13.x 的解释器（后端字节码与 Python 3.13 严格绑定）
is_target_python() {
    local ver
    ver="$("$1" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || true)"
    [[ "${ver}" == "${PY_TARGET}" ]]
}

find_python() {
    local candidate uv_py
    for candidate in \
        "$(pwd)/venv/bin/python" \
        "$(pwd)/../venv/bin/python" \
        "$(command -v python3.13 2>/dev/null || true)" \
        "$(command -v python3 2>/dev/null || true)" \
        "$(command -v python 2>/dev/null || true)"; do
        if [[ -n "${candidate}" && -x "${candidate}" ]]; then
            if is_target_python "${candidate}"; then
                echo "${candidate}"
                return 0
            fi
        fi
    done
    if command -v uv >/dev/null 2>&1; then
        if uv_py="$(uv python find "${PY_TARGET}" 2>/dev/null)"; then
            echo "${uv_py}"
            return 0
        fi
    fi
    return 1
}

install_python() {
    local uv_bin
    uv_bin="$(command -v uv || true)"
    if [[ -z "${uv_bin}" ]]; then
        echo "[ZOOT] 未找到 uv，正在安装 uv 到 ~/.local/bin ..."
        if ! curl -LsSf https://astral.sh/uv/install.sh | sh; then
            echo "[ZOOT] uv 安装失败。请检查网络后重试，或手动安装 Python ${PY_TARGET}（见 README）。" >&2
            return 1
        fi
        uv_bin="$HOME/.local/bin/uv"
    fi
    echo "[ZOOT] 使用 uv 安装 Python ${PY_TARGET}（仅当前用户，已安装时会自动跳过）..."
    if ! "${uv_bin}" python install "${PY_TARGET}"; then
        echo "[ZOOT] Python ${PY_TARGET} 安装失败。请检查网络/代理后重试。" >&2
        return 1
    fi
}

# 探针：既验证依赖存在，也拦截会静默破坏后端的版本（pydantic v2）
deps_ok() {
    "$(pwd)/venv/bin/python" -c \
        "import fastapi, openai, uvicorn, pydantic, cryptography; assert pydantic.__version__.startswith('1.')" \
        2>/dev/null
}

# 确保 venv 存在且基于 Python 3.13；缺失或版本不符时重建，依赖缺失时增量修复
ensure_venv() {
    local venv_py="$(pwd)/venv/bin/python"
    local recreate=0
    if [[ -x "${venv_py}" ]]; then
        if ! is_target_python "${venv_py}"; then
            echo "[ZOOT] venv 内 Python 版本不符（需要 ${PY_TARGET}），正在重建 venv ..."
            rm -rf "$(pwd)/venv"
            recreate=1
        fi
    else
        recreate=1
    fi
    if [[ "${recreate}" -eq 1 ]]; then
        echo "[ZOOT] 创建虚拟环境 venv/（Python ${PY_TARGET}）..."
        if ! "$1" -m venv "$(pwd)/venv"; then
            echo "[ZOOT] 创建 venv 失败。" >&2
            return 1
        fi
    fi
    if ! deps_ok; then
        echo "[ZOOT] 依赖缺失或版本不符，正在安装（首次运行可能需要几分钟）..."
        if ! "$(pwd)/venv/bin/pip" install -r requirements.txt; then
            echo "[ZOOT] 依赖安装失败。请检查网络后重试，或手动执行: venv/bin/pip install -r requirements.txt" >&2
            return 1
        fi
    fi
}

PY="$(find_python || true)"
if [[ -z "${PY}" ]]; then
    install_python || exit 1
    # 安装完成后重新查找（uv 安装的解释器直接可被 uv python find 定位）
    PY="$(find_python || true)"
    if [[ -z "${PY}" ]]; then
        echo "[ZOOT] 仍无法找到 Python ${PY_TARGET}，请手动安装后重试（见 README）。" >&2
        exit 1
    fi
fi

echo "[ZOOT] 使用 Python: ${PY} ($("${PY}" --version 2>/dev/null || true))"
ensure_venv "${PY}" || exit 1

export PYTHONIOENCODING=utf-8
exec "$(pwd)/venv/bin/python" "$(pwd)/launch.py" --port "${PORT}" "$@"
