#!/usr/bin/env bash
# 重新建立浏览器会话（token 由运行中的服务器持续刷新）
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-55000}"

TOKEN_FILE="bootstrap_token.txt"
if [[ ! -f "${TOKEN_FILE}" ]]; then
    echo "未找到 ${TOKEN_FILE}，请确认服务器正在运行（start.sh / start.bat）。" >&2
    exit 1
fi

TOKEN="$(tr -d '[:space:]' < "${TOKEN_FILE}")"

if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:${PORT}/__local/bootstrap?token=${TOKEN}&next=%2Fstatic%2Findex.html"
elif command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:${PORT}/__local/bootstrap?token=${TOKEN}&next=%2Fstatic%2Findex.html"
else
    echo "请手动访问: http://127.0.0.1:${PORT}/__local/bootstrap?token=${TOKEN}&next=%2Fstatic%2Findex.html"
fi
