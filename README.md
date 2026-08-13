# ZOOT 桌面版（Windows / Linux 双平台）

> 将 Android 版 ZOOT（明日方舟 AI 聊天助手）移植到 PC 的本地运行版本。
> 无需 Android 设备/模拟器：本地 Python 服务 + 浏览器访问，Windows 与 Linux 均可运行。

## 致谢

本项目代码与资源提取自原作者的 ZOOT Android 应用（[kiiinou](https://github.com/kiiinou) / kinou），在此致谢。本仓库仅为个人自改版，与原作者无任何关联。

## 这是什么

原 Android APK 使用 **Capacitor**（WebView 前端）+ **Chaquopy**（内嵌 Python 3.13 后端）架构：

- 前端：纯 Web 应用，由后端直接服务 `http://127.0.0.1:PORT/static/index.html`
- 后端：FastAPI + uvicorn，含 40+ 个 API 模块（聊天、记忆、事件、干员、知识库检索等）
- 数据：SQLite（对话/记忆/任务）+ 62MB 向量知识库（bge-small-zh-v1.5 语义检索）+ ONNX 向量模型

由于 Python 字节码（`.pyc`）与源码同为 3.13 版本、且**跨平台**，本移植直接复用 APK 内打包的字节码与资源；平台相关模块已提供源码覆盖（见下文「与 Android 版的差异」）。

## 目录结构

```
run/
├── launch.py          # 启动脚本（签发会话 token + 可选自动打开浏览器）
├── start.bat          # 一键启动（Windows）
├── start.sh           # 一键启动（Linux / macOS）
├── bootstrap.bat      # 重新建立浏览器会话（Windows）
├── bootstrap.sh       # 重新建立浏览器会话（Linux / macOS）
├── requirements.txt   # Python 依赖（按平台条件安装）
├── tools/
│   └── patch_main_pyc.py  # 后端字节码平台补丁（重新解包 APK 后重跑）
├── app/               # 后端（.pyc + 平台模块源码覆盖）
├── static/            # Web 前端
├── operators/         # 干员配置与角色数据
├── data/              # 初始数据（事件、时间线等）
├── resources/
│   ├── core_knowledge.db        # 向量知识库（62MB，34,297 条）
│   └── vector_model/            # ONNX 嵌入模型
├── .env               # 环境配置（API Key、记忆参数等）
├── memories.db        # 长期记忆（运行时生成，不入库）
└── stats.db           # 统计（运行时生成，不入库）
```

## 环境要求

| 依赖 | 版本 |
|---|---|
| Python | 3.13.x（字节码与之严格绑定；启动器会对其他版本给出明确提示） |
| fastapi | >=0.95.2（已验证 0.125） |
| pydantic | >=1.10.26,<2（后端为 v1 API，勿升级到 v2） |
| uvicorn | >=0.52.1 |
| openai | >=0.28.0,<1.0（后端使用 0.x 全局 api_key/api_base API） |
| cryptography | >=43（桌面设备身份 + 密钥存储） |
| numpy / onnxruntime | 最新（已验证 numpy 2.5 + onnxruntime 1.28） |
| pywin32 | 仅 Windows（DPAPI 密钥存储；缺失时自动回退到 cryptography 方案） |

### 依赖版本策略

- 依赖统一使用 `>=` 区间声明，**pip 可以随时升级**、依赖可以安装更高的兼容版本；只有存在破坏性 API 变更的 `pydantic`（v2）与 `openai`（1.x）设置了上界。
- 平台专属依赖通过 environment marker 声明（`pywin32; sys_platform == 'win32'`），Linux/macOS 不会安装。
- 其余：httpx、aiohttp、websockets、pypinyin、jieba、pypdf、Pillow 等（见 `requirements.txt`）。
- Python 解释器本身是唯一的硬约束：后端以 3.13 字节码发布，请用 3.13.x 创建虚拟环境（含后续补丁版本）；`launch.py` 会在解释器不兼容时给出明确提示，而不是莫名崩溃。

## 快速开始

### Windows

```bat
python -m venv venv
venv\Scripts\pip install -r requirements.txt
start.bat
```

### Linux / macOS

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
./start.sh
```

启动流程：

1. 后端加载数据库/干员/知识库（约 30~60 秒），监听 `127.0.0.1:55000`（占用时自动换端口）
2. 启动脚本签发一次性引导 token，`--no-browser` 时跳过自动打开浏览器
3. 浏览器经 `/__local/bootstrap?token=...` 建立会话 cookie（HttpOnly）后进入主界面
4. 若浏览器未自动打开：运行 `bootstrap.bat` / `bootstrap.sh`（token 会持续刷新）

命令行参数：

```
python launch.py --port 55000           # 指定端口
python launch.py --no-browser           # 不自动打开浏览器
python launch.py --data-dir ~/zoot-data # 覆盖数据目录（等价 ZOOT_DATA_ROOT）
```

## 会话与安全

- 所有非静态 API 需要本地会话 cookie（`zoot_local_session`，进程内随机密钥）
- 引导 token 有效期 2 分钟、一次性消费
- 服务器默认绑定 `0.0.0.0`；LAN 访问受 `LanAccessGate` 策略限制，仅白名单路径可用
- 开发入口（免会话）仅限 `localhost:8000` 的非 GET 请求；源码运行默认开启，可用 `ZOOT_DEV_MODE=0` 关闭（打包运行时默认关闭）
- 环境变量：`ZOOT_LAN_SYNC_ENABLED=0|1` 强制关闭/开启 LAN 同步面

## 数据存放

| 平台 | 默认位置 |
|---|---|
| Windows（源码运行） | `%USERPROFILE%\.zoot` |
| Linux / macOS（源码运行） | `~/.zoot` |
| PyInstaller 打包（可移动模式） | 可执行文件旁的 `data/` |
| 任意平台覆盖 | 环境变量 `ZOOT_DATA_ROOT` |

日志默认写入 `logs/app.log`（`LOG_FILE` 可配置）。

## 与 Android 版的差异

| 项目 | Android | 本版 |
|---|---|---|
| 运行方式 | Chaquopy 内嵌 Python | 独立 Python 3.13 进程 |
| 前端容器 | Capacitor WebView | 浏览器 |
| 会话建立 | Java 桥接签发 token | launch.py 签发 |
| 密钥存储 | Android Keystore | Windows DPAPI / 其他平台 XChaCha20-Poly1305（`app/security/device_secret_store.py` 源码覆盖） |
| 平台标识 | `android` | `pc`（`tools/patch_main_pyc.py` 修补字节码） |
| 更新通道 | APK 下载 | PC 更新通道 |

后端大部分仍是原 APK 的 `.pyc` 字节码。平台相关模块已用源码覆盖（同名 `.py` 优先于 `.pyc` 加载）：

- `app/security/device_secret_store.py` — 新增 Linux/macOS 密钥存储后端
- `app/security/local_access.py` — 开发入口策略在 Windows/Linux 上行为一致
- `app/utils/resource_paths.py` — 支持 `ZOOT_RESOURCE_ROOT` 覆盖资源目录

从 APK 重新解包 `app/main.pyc` 后，运行 `python tools/patch_main_pyc.py` 重新应用平台补丁。

## 已知限制

- 后台主动发言、系统通知等 Android 专属能力不可用
- 向量检索、NLP 状态跟踪默认关闭（`.env` 中开启）

## 免责声明

本项目为个人学习与备份用途，代码与资源提取自原作者的 ZOOT 应用（kiiinou / kinou，`com.rhodesisland.zoot`）。请勿用于商业用途。若版权方要求，本仓库将立即移除相关内容。

## 许可证

[Apache License 2.0](LICENSE)
