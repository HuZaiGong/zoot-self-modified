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

由于 Python 字节码（`.pyc`）与源码同为 3.13 版本、且**跨平台**，本移植直接复用 APK 内打包的字节码与资源；平台相关模块与运行时缺陷通过**源码覆盖（同名 `.py` 优先于 `.pyc` 加载）**和**字节码补丁脚本**修复，详见下文「后端改造清单」。

## 目录结构

```
run/
├── launch.py          # 启动脚本（运行时修复 + 会话 token + 可选自动打开浏览器）
├── start.bat          # 一键启动（Windows，自动装 Python 3.13/建 venv/装依赖）
├── start.sh           # 一键启动（Linux / macOS，同上）
├── bootstrap.bat      # 重新建立浏览器会话（Windows）
├── bootstrap.sh       # 重新建立浏览器会话（Linux / macOS）
├── requirements.txt   # Python 依赖（>= 区间 + 平台 marker）
├── tools/
│   ├── patch_main_pyc.py      # 主字节码补丁：platform=pc、lifespan LOAD_NAME 修复
│   └── patch_timeline_pyc.py  # 时间线字节码补丁：fork_points 绑定数不匹配
├── app/               # 后端（.pyc + 平台模块源码覆盖，见下文清单）
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
| uv | 最新（环境准备工具：装 Python / 建 venv / 装依赖） |
| Python | 3.13.x（字节码与之严格绑定；启动器会对其他版本给出明确提示） |
| fastapi | >=0.95.2（已验证 0.125） |
| pydantic | >=1.10.26,<2（后端为 v1 API，勿升级到 v2） |
| uvicorn | >=0.52.1 |
| openai | >=0.28.0,<1.0（后端使用 0.x 全局 api_key/api_base API） |
| cryptography | >=43（桌面设备身份 + 密钥存储） |
| numpy / onnxruntime | 最新（已验证 numpy 2.5 + onnxruntime 1.28） |
| pywin32 | 仅 Windows（DPAPI 密钥存储；缺失时自动回退到 cryptography 方案） |

### 依赖版本策略

- 依赖统一使用 `>=` 区间声明，**可随时升级到更高的兼容版本**（uv / pip 均可解析）；只有存在破坏性 API 变更的 `pydantic`（v2）与 `openai`（1.x）设置了上界。
- 平台专属依赖通过 environment marker 声明（`pywin32; sys_platform == 'win32'`），Linux/macOS 不会安装。
- 其余：httpx、aiohttp、websockets、pypinyin、jieba、pypdf、Pillow 等（见 `requirements.txt`）。
- Python 解释器本身是唯一的硬约束：后端以 3.13 字节码发布，请用 3.13.x 创建虚拟环境（含后续补丁版本）；`launch.py` 与启动脚本都会在解释器不兼容时给出明确提示，而不是莫名崩溃。

## 快速开始

环境准备统一使用 [uv](https://docs.astral.sh/uv/)（未安装时脚本会提示/自动安装）。

### Windows

```bat
start.bat
```

`start.bat` 自动完成：探测 Python（无 3.13 时经 `uv python install 3.13` 安装）→ 创建仓库内 `venv` → 用 `uv pip install` 装依赖 → 启动。手动方式：

```bat
uv venv venv --python 3.13
uv pip install --python venv\Scripts\python.exe -r requirements.txt
start.bat
```

### Linux / macOS

```bash
./start.sh
```

`start.sh` 自动完成：校验 Python 3.13（缺失时经 `uv` 自动安装）→ `uv venv` 创建/修复 `venv` → `uv pip install` 装依赖 → 启动。手动方式：

```bash
uv venv venv --python 3.13
uv pip install --python venv/bin/python -r requirements.txt
./start.sh 55000 --no-browser   # 端口 + 额外参数直接透传给 launch.py
```

启动流程：

1. 后端加载数据库/干员/知识库（约 30~60 秒），监听 `127.0.0.1:55000`（占用时自动换端口；已有实例运行时直接复用其会话打开浏览器）
2. 启动脚本签发一次性引导 token，`--no-browser` 时跳过自动打开浏览器
3. 浏览器经 `/__local/bootstrap?token=...` 建立会话 cookie（HttpOnly）后进入主界面
4. 若浏览器未自动打开：运行 `bootstrap.bat` / `bootstrap.sh`（token 会持续刷新）

命令行参数：

```
python launch.py --port 55000           # 指定端口
python launch.py --no-browser           # 不自动打开浏览器
python launch.py --data-dir ~/zoot-data # 覆盖数据目录（等价 ZOOT_DATA_ROOT）
```

## 配置（.env）

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | 对话模型 API 密钥（首次使用需在前端 API 设置页配置或直接填入） |
| `KNOWLEDGE_SERVICE_URL` / `KNOWLEDGE_SERVICE_API_KEY` | 知识图谱服务地址与密钥 |
| `ENABLE_VECTOR_RETRIEVAL` / `VECTOR_RETRIEVAL_COUNT` | 向量检索开关与返回条数（默认关闭） |
| `ENABLE_NLP_STATE_TRACKING` | NLP 状态跟踪（默认关闭） |
| `LOG_LEVEL` / `LOG_FILE` / `LOG_MAX_BYTES` / `LOG_BACKUP_COUNT` | 日志配置 |
| `ZOOT_DATA_ROOT` | 可写数据根目录（覆盖默认位置） |
| `ZOOT_RESOURCE_ROOT` | 覆盖只读资源目录（`resources/`） |
| `ZOOT_DEV_MODE=0\|1` | 开发入口开关（免会话仅限 `localhost:8000` 非 GET；源码运行默认开启） |
| `ZOOT_LAN_SYNC_ENABLED=0\|1` | 强制关闭/开启 LAN 同步面 |
| `ZOOT_ENABLE_LEGACY_SYNC=1` | 重新启用旧版 `/sync/` 接口（默认 404） |
| `HTTP_PROXY` / `HTTPS_PROXY` | 代理（云端服务、知识图谱、模型调用经 httpx 默认读取）；也可用 `ZOOT_HTTP_PROXY` / `ZOOT_HTTPS_PROXY`（或通用 `ZOOT_PROXY`），launch.py 会转发为标准变量 |

## 会话与安全

- 所有非静态 API 需要本地会话 cookie（`zoot_local_session`，进程内随机密钥）
- 引导 token 有效期 2 分钟、一次性消费
- 服务器默认绑定 `0.0.0.0`；LAN 访问受 `LanAccessGate` 策略限制，仅白名单路径可用
- 密钥存储：Windows 用 DPAPI（缺失时自动回退 cryptography）；Linux/macOS 用 XChaCha20/ChaCha20-Poly1305 + 0600 权限的机器密钥文件

## 数据存放

| 平台 | 默认位置 |
|---|---|
| Windows（源码运行） | `%USERPROFILE%\.zoot` |
| Linux / macOS（源码运行） | `~/.zoot` |
| PyInstaller 打包（可移动模式） | 可执行文件旁的 `data/` |
| 任意平台覆盖 | 环境变量 `ZOOT_DATA_ROOT` |

日志默认写入 `logs/app.log`（`LOG_FILE` 可配置）。

## 后端改造清单

后端主体仍是原 APK 的 `.pyc` 字节码。本仓库的改造分两类：

### 源码覆盖（同名 `.py` 优先于 `.pyc` 加载）

| 模块 | 修复内容 |
|---|---|
| `app/security/device_secret_store.py` | 新增 Linux/macOS 密钥存储后端（原版只有 DPAPI/Keystore） |
| `app/security/local_access.py` | 开发入口策略在 Windows/Linux 上行为一致（原版仅 Windows 源码运行开启） |
| `app/utils/resource_paths.py` | 支持 `ZOOT_RESOURCE_ROOT` 覆盖资源目录 |
| `app/api/diary.py` | `list_diaries` 不再把自身抛出的 404 吞成 500（HTTPException 原样透传） |
| `app/services/finance/maintenance.py` | 维护配置读写前自动建 `config` 表（原版 FinanceDB 从不建此表，自动扣费永不生效） |
| `app/utils/vectorizer_onnx.py` | 补 `MODEL_DIR` 导出（原版 `/vector/config` 在桌面端必抛 ImportError） |

### 字节码补丁（重新解包 APK 后重跑）

| 脚本 | 修复内容 |
|---|---|
| `tools/patch_main_pyc.py` | `platform` 常量 `android`→`pc`（更新通道/云服务/插件/能力广播/版本上报）；lifespan 中 `get_vector_runtime` 局部变量先于赋值被 `LOAD_FAST_CHECK` 读取的 UnboundLocalError，改为 `LOAD_NAME` 回退全局（原版补丁曾用 `LOAD_GLOBAL`，会破坏 3.13 内联缓存导致 `Executing a cache` 致命崩溃） |
| `tools/patch_timeline_pyc.py` | `fork_points` 分支查询 SQL 占位符按 `uids` 生成而参数用 `messages.keys()`，消息缺失时绑定数差 1 抛 `ProgrammingError`；参数改为同一份 `uids`（被删消息的分支在后续循环本就跳过） |

两脚本均幂等、可重放，运行前自动备份 `.bak`（已 gitignore）。

### 启动器运行时修复（`launch.py`）

- `os.statvfs` shim：Windows 用 `shutil.disk_usage` 补齐（原版磁盘检查永远 WARNING）
- `builtins.random` 注入：`chat_continue` 兜底分支调用 `random.choice` 但模块从未 import random（NameError）
- 运行时建表：首次安装即建 `stats.db` 的 `mood_history` 表（原版只在写情绪时才建，读取接口先 500）
- `_operator_catalog_ids` 补全：从 `operators/compiled` 目录加载内置角色 ID（原版全局变量从未赋值，联络接口 NameError）
- API 错误映射：`/dynamics/*` 非数字 ID 的 `ValueError` → 422；多模态服务档案未配置的 `CapabilityRouteError` → 400（原版均返回 500）
- 代理转发：`ZOOT_HTTP_PROXY` / `ZOOT_HTTPS_PROXY`（或 `ZOOT_PROXY`）自动转为标准代理环境变量，供 httpx 客户端使用
- 其他：UTF-8 输出兜底（GBK 控制台）、pythonw 无控制台崩溃修复、单实例检测、Python 版本护栏

## 与 Android 版的差异

| 项目 | Android | 本版 |
|---|---|---|
| 运行方式 | Chaquopy 内嵌 Python | 独立 Python 3.13 进程 |
| 前端容器 | Capacitor WebView | 浏览器 |
| 会话建立 | Java 桥接签发 token | launch.py 签发 |
| 密钥存储 | Android Keystore | Windows DPAPI / 其他平台 XChaCha20-Poly1305 |
| 平台标识 | `android` | `pc` |
| 更新通道 | APK 下载 | PC 更新通道 |

## 已知限制

- 后台主动发言、系统通知等 Android 专属能力不可用
- 向量检索、NLP 状态跟踪默认关闭（`.env` 中开启）
- 云端远程能力（远程配置、遥测、知识图谱）需要可达的外网：无代理的网络环境会降级失败（单请求 5 秒超时，接口返回错误而非挂起），设 `HTTP_PROXY` / `ZOOT_HTTP_PROXY` 即可恢复
- 未配置 API 密钥时，聊天与 AI 事件生成不可用（前端 API 设置页或 `.env` 配置）
- 控制矩阵、更新检查等界面已按 PC 平台渲染（`/api/version/local` 返回 `platform: pc`）
- 首次调用衣柜目录、助手审批等接口较慢（冷缓存构建），后续请求正常

## 免责声明

本项目为个人学习与备份用途，代码与资源提取自原作者的 ZOOT 应用（kiiinou / kinou，`com.rhodesisland.zoot`）。请勿用于商业用途。若版权方要求，本仓库将立即移除相关内容。

## 许可证

[Apache License 2.0](LICENSE)
