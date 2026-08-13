"""ZOOT 桌面版启动器。

职责单一：配置运行时环境 -> 启动内置服务器 -> 可选地自动打开浏览器。

用法::

    python launch.py [--port PORT] [--no-browser] [--data-dir DIR]

如果目标端口上已有 ZOOT 实例在运行，启动器不会二次启动服务器，
而是复用其引导 token 直接打开浏览器。

环境变量::

    ZOOT_DATA_ROOT   可写数据根目录（默认遵循各平台惯例）
    ZOOT_DEV_MODE    1/0 覆盖开发入口开关
    PYTHONIOENCODING 输出编码（启动器会自动尝试切换为 utf-8）
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass
try:
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

app_main = None

TOKEN_FILE = os.path.join(BASE_DIR, "bootstrap_token.txt")
DEFAULT_PORT = 55000
BOOTSTRAP_URL = "http://127.0.0.1:{port}/__local/bootstrap?token={token}&next=%2Fstatic%2Findex.html"

REQUIRED_PYTHON = (3, 13)


def load_app():
    """延迟加载后端；解释器版本不兼容时给出可操作的错误提示。"""
    global app_main
    if app_main is not None:
        return app_main
    if sys.version_info[:2] != REQUIRED_PYTHON:
        print(
            f"后端字节码为 Python {REQUIRED_PYTHON[0]}.{REQUIRED_PYTHON[1]} 编译，"
            f"当前解释器为 {sys.version.split()[0]}。"
            f"请使用 Python {REQUIRED_PYTHON[0]}.{REQUIRED_PYTHON[1]} 创建虚拟环境（见 README）。",
            file=sys.stderr,
        )
        raise SystemExit(1)
    try:
        import app.main
    except (ImportError, ValueError) as exc:
        message = str(exc).lower()
        if "bad magic number" in message or "unsupported" in message:
            print(
                f"后端字节码与当前解释器（{sys.version.split()[0]}）不兼容。"
                f"请使用 Python {REQUIRED_PYTHON[0]}.{REQUIRED_PYTHON[1]} 创建虚拟环境（见 README）。",
                file=sys.stderr,
            )
            raise SystemExit(1) from exc
        raise
    app_main = app.main
    return app_main


def parse_args(argv):
    parser = argparse.ArgumentParser(description="启动 ZOOT 本地服务器")
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"监听端口（默认 {DEFAULT_PORT}，被占用时自动分配）",
    )
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    parser.add_argument(
        "--data-dir",
        default=None,
        help="可写数据根目录（等价于环境变量 ZOOT_DATA_ROOT）",
    )
    return parser.parse_args(argv)


def is_zoot_running(port: int) -> bool:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/ping", timeout=2
        ) as response:
            return response.status == 200
    except (urllib.error.URLError, OSError):
        return False


def can_bind(port: int) -> bool:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def wait_for_port(port: int, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def read_token_file() -> str:
    try:
        with open(TOKEN_FILE, encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return ""


def refresh_token_loop(stop_event: threading.Event):
    while not stop_event.is_set():
        if getattr(app_main, "_runtime_server_socket", None) is not None:
            try:
                token = app_main.issue_local_bootstrap_token()
                with open(TOKEN_FILE, "w", encoding="utf-8") as handle:
                    handle.write(token)
            except OSError:
                pass
        stop_event.wait(timeout=30)


def open_browser(port: int) -> None:
    token = read_token_file()
    if not token:
        try:
            token = app_main.issue_local_bootstrap_token()
            with open(TOKEN_FILE, "w", encoding="utf-8") as handle:
                handle.write(token)
        except OSError:
            pass
    url = BOOTSTRAP_URL.format(port=port, token=token)
    try:
        import webbrowser

        if not webbrowser.open(url):
            raise RuntimeError("no browser")
    except Exception:
        print(f"浏览器未能自动打开，请手动访问: {url}")


def reuse_running_instance(port: int, no_browser: bool) -> int:
    print(f"检测到 ZOOT 已在 http://127.0.0.1:{port} 运行，直接打开浏览器。")
    if not no_browser:
        open_browser(port)
    else:
        print("已跳过浏览器自动打开。")
    return 0


def main(argv=None) -> int:
    global app_main
    args = parse_args(argv)
    if args.data_dir:
        os.environ["ZOOT_DATA_ROOT"] = os.path.abspath(
            os.path.expanduser(args.data_dir)
        )
    app_main = load_app()

    if is_zoot_running(args.port) or not can_bind(args.port):
        return reuse_running_instance(args.port, args.no_browser)

    stop_event = threading.Event()
    server_thread = threading.Thread(
        target=app_main.start_server,
        args=(args.port,),
        name="zoot-server",
        daemon=True,
    )
    server_thread.start()
    threading.Thread(
        target=refresh_token_loop, args=(stop_event,), name="zoot-token", daemon=True
    ).start()

    if not wait_for_port(args.port, timeout=120):
        print("服务器启动失败，请检查日志。")
        stop_event.set()
        return 1

    actual_port = int(
        getattr(app_main, "_runtime_server_socket", None).getsockname()[1]
        if getattr(app_main, "_runtime_server_socket", None) is not None
        else args.port
    )
    print(f"ZOOT 服务器已启动: http://127.0.0.1:{actual_port}")

    if not args.no_browser:
        open_browser(actual_port)
    else:
        print("已跳过浏览器自动打开；运行 bootstrap 脚本或手动访问上述地址。")

    try:
        server_thread.join()
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
