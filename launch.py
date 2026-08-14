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
import importlib.util
import logging
import os
import socket
import sys
import threading
import time
import traceback
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


def _install_posix_shims() -> None:
    """为 Windows 补充后端用到的 POSIX 接口（os.statvfs 等）。"""
    if hasattr(os, "statvfs"):
        return
    import shutil

    class _StatvfsResult:
        def __init__(self, free_bytes: int):
            self.f_frsize = 1
            self.f_bavail = free_bytes

    def _statvfs(path) -> _StatvfsResult:
        return _StatvfsResult(shutil.disk_usage(path).free)

    os.statvfs = _statvfs


def _ensure_runtime_schema() -> None:
    """补齐原版遗漏的运行时建表（首次安装时相关接口会 500）。"""
    import sqlite3

    from app.utils.writable import get_writable_path

    try:
        conn = sqlite3.connect(get_writable_path("stats.db"))
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS mood_history ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "operator_id TEXT NOT NULL,"
                "mood TEXT,"
                "mood_value REAL,"
                "timestamp REAL,"
                "conversation_round INTEGER DEFAULT 0)"
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def _populate_operator_catalog_ids() -> None:
    """补全 main.pyc 中从未赋值的 _operator_catalog_ids 全局变量。"""
    try:
        from pathlib import Path

        from app.services import builtin_character_catalog

        catalog_dir = Path(app_main.__file__).resolve().parent.parent / "operators" / "compiled"
        app_main._operator_catalog_ids = set(
            builtin_character_catalog.catalog_ids(catalog_dir)
        )
    except Exception:
        app_main._operator_catalog_ids = set()


def _install_builtin_shims() -> None:
    """补齐 pyc 后端缺失的内置名。

    main.pyc 的 chat_continue 在兜底分支调用 random.choice(...)，
    但模块级从未 import random，会抛 NameError。把 random 注入
    builtins 后，LOAD_GLOBAL 会回退到 builtins 解析成功。
    """
    import builtins
    import random

    if not hasattr(builtins, "random"):
        builtins.random = random


def _apply_proxy_settings() -> None:
    """把 ZOOT 专用代理变量转发为标准 httpx 环境变量。

    ZOOT_HTTP_PROXY / ZOOT_HTTPS_PROXY（或通用 ZOOT_PROXY）在导入后端
    前生效，云端服务、知识图谱、模型调用等 httpx 客户端会自动读取
    HTTP_PROXY / HTTPS_PROXY。
    """
    http_proxy = os.getenv("ZOOT_HTTP_PROXY") or os.getenv("ZOOT_PROXY") or ""
    https_proxy = os.getenv("ZOOT_HTTPS_PROXY") or os.getenv("ZOOT_PROXY") or ""
    if http_proxy:
        os.environ.setdefault("HTTP_PROXY", http_proxy)
    if https_proxy:
        os.environ.setdefault("HTTPS_PROXY", https_proxy)


def _apply_feature_defaults() -> None:
    """桌面版默认打开向量检索与 NLP 状态跟踪。

    config.pyc 用 os.getenv(..., 'false') 读取这两个开关，Android 原版
    默认关闭；桌面版没有移动端省电压力，这里在导入后端前把默认值改为
    true（用户显式设置的环境变量仍然优先，可设 0 关闭）。
    """
    for key in ("ENABLE_VECTOR_RETRIEVAL", "ENABLE_NLP_STATE_TRACKING"):
        os.environ.setdefault(key, "true")


def _install_api_error_handlers(app) -> None:
    """注册原版未处理的业务异常到合理的 HTTP 状态码。

    * /dynamics/* 的非数字 ID 会抛 ValueError -> 422（路由为 str 类型但
      处理器内 int() 转换，FastAPI 无法在参数层拦截）
    * 未配置多模态服务档案时的 CapabilityRouteError -> 400（原版 500）
    """
    from fastapi.responses import JSONResponse

    async def _dynamics_value_error_handler(request, exc):
        if request.url.path.startswith("/dynamics/"):
            return JSONResponse(
                status_code=422, content={"detail": "无效的动态 ID 格式"}
            )
        return JSONResponse(status_code=500, content={"detail": str(exc)})

    async def _capability_route_error_handler(request, exc):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    app.add_exception_handler(ValueError, _dynamics_value_error_handler)
    try:
        from app.services.api_connection_profiles import CapabilityRouteError

        app.add_exception_handler(
            CapabilityRouteError, _capability_route_error_handler
        )
    except ImportError:
        pass


class _PluginContext:
    """交给可信插件入口的宿主能力句柄。"""

    def __init__(self, adapter, plugin_id):
        self._adapter = adapter
        self.plugin_id = plugin_id
        self.log = logging.getLogger(f"zoot.plugin.{plugin_id}")
        self.manifest = None

    @property
    def runtime(self):
        return self._adapter.runtime

    @property
    def app(self):
        return getattr(app_main, "app", None)

    @property
    def vector_runtime(self):
        from app.services.vector_runtime import get_vector_runtime

        return get_vector_runtime()

    def get_config(self, include_secrets=True):
        outcome = self._adapter.runtime.get_config(
            self.plugin_id, include_secrets=include_secrets
        )
        return dict(outcome or {})

    def set_config(self, config):
        return self._adapter.runtime.update_config(self.plugin_id, dict(config))


class _TrustedPluginAdapter:
    """PC 端 trusted_python 插件执行适配器。

    PluginRuntime 仅定义适配器契约并把执行委托给宿主；Android 端由宿主注入，
    PC 移植缺失导致可信插件启用报「当前宿主不支持可信 Python 插件」。

    适配器从插件安装目录执行入口模块 plugin.py，模块可实现：

    * on_activate(zctx) / on_deactivate(zctx) —— 启停生命周期
    * handle(action, payload, zctx) —— 动作与 __event__ 钩子入口
    """

    def __init__(self, runtime):
        self.runtime = runtime
        self._loaded = {}
        self._lock = threading.RLock()

    def start(self, plugin_id, plugin_path, manifest):
        try:
            module, zctx = self._load(plugin_id, plugin_path)
            zctx.manifest = manifest
            hook = getattr(module, "on_activate", None)
            if callable(hook):
                outcome = hook(zctx)
                if isinstance(outcome, dict) and outcome.get("ok") is False:
                    raise RuntimeError(
                        str(outcome.get("error") or "插件激活失败")
                    )
            return outcome if isinstance(outcome, dict) else {"ok": True}
        except Exception:
            print(
                f"[PluginAdapter] 插件 {plugin_id} 启动失败：",
                file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            raise

    def stop(self, plugin_id):
        with self._lock:
            module, zctx, _ = self._loaded.pop(plugin_id, (None, None, None))
        if module is None:
            return {"ok": True}
        hook = getattr(module, "on_deactivate", None)
        if callable(hook):
            try:
                hook(zctx)
            except Exception as exc:
                zctx.log.warning("on_deactivate 失败：%s", exc)
        return {"ok": True}

    def call(self, plugin_id, action, payload):
        try:
            with self._lock:
                entry = self._loaded.get(plugin_id)
            module, zctx, _ = entry if entry else (None, None, None)
            if module is None:
                record = self.runtime._record(plugin_id)
                module, zctx = self._load(
                    plugin_id, self.runtime._plugin_path(record)
                )
            handler = getattr(module, "handle", None)
            if not callable(handler):
                return {"ok": False, "error": "插件未实现 handle(action, payload, zctx)"}
            outcome = handler(
                action, payload if isinstance(payload, dict) else {}, zctx
            )
            return outcome if isinstance(outcome, dict) else {"ok": True, "result": outcome}
        except Exception:
            print(
                f"[PluginAdapter] 插件 {plugin_id} 动作 {action} 执行失败：",
                file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            raise

    def _load(self, plugin_id, plugin_path):
        from pathlib import Path

        plugin_dir = Path(plugin_path)
        source = None
        for candidate in ("plugin.py", "__init__.py", "main.py"):
            item = plugin_dir / candidate
            if item.is_file():
                source = item
                break
        if source is None:
            raise RuntimeError(f"插件 {plugin_id} 缺少可执行入口 plugin.py")
        signature = (str(source), source.stat().st_mtime)
        with self._lock:
            cached = self._loaded.get(plugin_id)
            if cached is not None and cached[2] == signature:
                return cached[0], cached[1]
        zctx = _PluginContext(self, plugin_id)
        spec = importlib.util.spec_from_file_location(
            f"zoot_plugins.{plugin_id}", source
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            sys.modules.pop(spec.name, None)
            raise
        with self._lock:
            self._loaded[plugin_id] = (module, zctx, signature)
        return module, zctx


def _install_trusted_plugin_adapter() -> None:
    """为 PC 宿主补齐 PluginRuntime 的 trusted_adapter。"""
    runtime = getattr(app_main, "plugin_runtime", None)
    if runtime is None:
        state = getattr(getattr(app_main, "app", None), "state", None)
        runtime = getattr(state, "plugin_runtime", None)
    if runtime is None or getattr(runtime, "trusted_adapter", None) is not None:
        return
    runtime.trusted_adapter = _TrustedPluginAdapter(runtime)


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
        _apply_proxy_settings()
        _apply_feature_defaults()
        _install_posix_shims()
        _install_builtin_shims()
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
    _ensure_runtime_schema()
    _populate_operator_catalog_ids()
    _install_api_error_handlers(app_main.app)
    _install_trusted_plugin_adapter()
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
