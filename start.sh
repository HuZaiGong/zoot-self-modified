#!/usr/bin/env bash
# ZOOT 一键启动（Linux / macOS）
# 首次运行自动：校验 Python 3.13 -> (缺则用 uv 安装) -> uv 建 venv -> uv 装依赖 -> 启动
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

# 定位 uv：PATH 优先；没有则尝试 python -m pip install uv，再不行用官方脚本
find_uv() {
    local uv_bin
    uv_bin="$(command -v uv || true)"
    if [[ -n "${uv_bin}" ]]; then
        echo "${uv_bin}"
        return 0
    fi
    if "$1" -m pip install uv >/dev/null 2>&1; then
        echo "$1 -m uv"
        return 0
    fi
    if curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1; then
        uv_bin="$HOME/.local/bin/uv"
        if [[ -x "${uv_bin}" ]]; then
            echo "${uv_bin}"
            return 0
        fi
    fi
    return 1
}

# uv 可用时经 uv 安装 Python 3.13（仅当前用户，已安装时自动跳过）
install_python() {
    echo "[ZOOT] 使用 uv 安装 Python ${PY_TARGET}（仅当前用户，已安装时会自动跳过）..."
    if ! "${UV[@]}" python install "${PY_TARGET}"; then
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

# 确保 venv 存在且基于 Python 3.13；版本不符才重建，依赖缺失用 uv 增量安装
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
        if ! "${UV[@]}" venv --python "$1" "$(pwd)/venv"; then
            echo "[ZOOT] 创建 venv 失败。" >&2
            return 1
        fi
    fi
    if ! deps_ok; then
        echo "[ZOOT] 依赖缺失或版本不符，正在用 uv 安装（首次运行可能需要几分钟）..."
        if ! "${UV[@]}" pip install --python "${venv_py}" -r requirements.txt; then
            echo "[ZOOT] 依赖安装失败。请检查网络后重试，或手动执行: uv pip install --python venv/bin/python -r requirements.txt" >&2
            return 1
        fi
    fi
}

PY="$(find_python || true)"
UV_BIN="$(command -v uv || true)"

if [[ -z "${PY}" ]]; then
    # 没有可用解释器：必须有 uv 才能装 Python
    if [[ -z "${UV_BIN}" ]]; then
        echo "[ZOOT] 未找到 Python ${PY_TARGET} 与 uv，正在安装 uv 到 ~/.local/bin ..."
        if ! curl -LsSf https://astral.sh/uv/install.sh | sh; then
            echo "[ZOOT] uv 安装失败。请检查网络后重试，或手动安装 Python ${PY_TARGET}（见 README）。" >&2
            exit 1
        fi
        UV_BIN="$HOME/.local/bin/uv"
    fi
    UV=("${UV_BIN}")
    install_python || exit 1
    PY="$(find_python || true)"
    if [[ -z "${PY}" ]]; then
        echo "[ZOOT] 仍无法找到 Python ${PY_TARGET}，请手动安装后重试（见 README）。" >&2
        exit 1
    fi
fi

# 解释器已就绪：补找 uv（含 pip 安装与官方脚本两种兜底），失败则退出并提示
if [[ -z "${UV_BIN}" ]]; then
    if UV_FALLBACK="$(find_uv "${PY}")"; then
        UV=(${UV_FALLBACK})
    else
        echo "[ZOOT] uv 不可用（PATH / pip / 官方脚本均失败）。请安装 uv 后重试，或手动管理 venv（见 README）。" >&2
        exit 1
    fi
else
    UV=("${UV_BIN}")
fi

echo "[ZOOT] 使用 Python: ${PY} ($("${PY}" --version 2>/dev/null || true))"
ensure_venv "${PY}" || exit 1

export PYTHONIOENCODING=utf-8
exec "$(pwd)/venv/bin/python" "$(pwd)/launch.py" --port "${PORT}" "$@"
