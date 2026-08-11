# ZOOT 自改版（PC 移植）

> 将 Android 版 ZOOT（明日方舟 AI 聊天助手）移植到 Windows PC 的本地运行版本。
> 无需 Android 设备/模拟器，本地服务 + 浏览器访问。

## 致谢

本项目代码与资源提取自原作者的 ZOOT Android 应用（[kiiinou](https://github.com/kiiinou) / kinou），在此致谢。本仓库仅为个人自改版，与原作者无任何关联。

## 这是什么

原 Android APK 使用 **Capacitor**（WebView 前端）+ **Chaquopy**（内嵌 Python 3.13 后端）架构：
- 前端：纯 Web 应用，由后端直接服务 `http://127.0.0.1:PORT/static/index.html`
- 后端：FastAPI + uvicorn，本地 `0.0.0.0` 监听，含 40+ 个 API 模块（聊天、记忆、事件、干员、知识库检索等）
- 数据：SQLite（对话/记忆/任务）+ 62MB 向量知识库（bge-small-zh-v1.5 语义检索）+ ONNX 向量模型

由于 Python 字节码（`.pyc`）与源码同为 3.13 版本、且**跨平台**，本移植无需反编译 Python 代码——将 APK 内打包的字节码与资源直接放到 Windows 的 Python 3.13 环境运行即可。

## 目录结构

```
run/
├── launch.py          # 启动脚本（签发会话 token + 自动打开浏览器）
├── start.bat          # 一键启动（Windows）
├── bootstrap.bat      # 重新建立浏览器会话（token 一次性，重启后失效）
├── requirements.txt   # Python 依赖（版本与 APK 内打包一致）
├── app/               # 后端字节码（.pyc）+ 内置数据库
├── static/            # Web 前端（1,582 个文件）
├── operators/         # 干员配置与角色数据
├── data/              # 初始数据（事件、时间线等）
├── resources/
│   ├── core_knowledge.db        # 向量知识库（62MB，34,297 条）
│   └── vector_model/            # ONNX 嵌入模型
├── .env               # 环境配置（API Key、记忆参数等）
├── memories.db        # 长期记忆
└── stats.db           # 统计
```

## 环境要求

| 依赖 | 版本 |
|---|---|
| Python | 3.13.x（字节码与之严格绑定）|
| fastapi | 0.95.2（pydantic v1 API，勿升级到 v2）|
| pydantic | 1.10.26 |
| uvicorn | 0.52.1 |
| numpy / onnxruntime | 最新（Windows x64）|
| pywin32 | 最新（Windows DPAPI 密钥存储）|

其余：openai 0.28.0、httpx、aiohttp、websockets、pypinyin、jieba、pypdf、Pillow 等（见 `requirements.txt`）。

## 快速开始

```bat
python -m venv venv
venv\Scripts\pip install -r requirements.txt
start.bat
```

启动流程：
1. 后端加载数据库/干员/知识库（约 30~60 秒），监听 `127.0.0.1:55000`
2. 启动脚本自动签发一次性引导 token 并打开浏览器
3. 浏览器经 `/__local/bootstrap?token=...` 建立会话 cookie（HttpOnly）后进入主界面
4. 若浏览器未自动打开：运行 `bootstrap.bat`（token 每 5 秒刷新一次）

## 会话与安全

- 所有非静态 API 需要本地会话 cookie（`zoot_local_session`，进程内随机密钥）
- 引导 token 有效期 15 秒、一次性消费
- 密钥存储使用 Windows DPAPI（`win32crypt`）
- 服务器默认绑定 `0.0.0.0`；LAN 访问受 `LanAccessGate` 策略限制，仅白名单路径可用

## 数据存放

- 可写数据默认存于 `%LOCALAPPDATA%\ZOOT`（官方 PC 分支逻辑）
- 可通过环境变量 `ZOOT_DATA_ROOT` 覆盖
- 日志：`logs/app.log`（`LOG_FILE` 可配置）

## 与 Android 版的差异

| 项目 | Android | PC 本版 |
|---|---|---|
| 运行方式 | Chaquopy 内嵌 Python | 独立 Python 3.13 进程 |
| 前端容器 | Capacitor WebView | 浏览器 |
| 会话建立 | Java 桥接签发 token | launch.py 签发 |
| 密钥存储 | Android Keystore | Windows DPAPI |
| 平台标识 | `android` | `android`（暂未改）|

## 已知问题

- `platform` 字段仍为 `android`（影响前端矩阵布局与更新检查平台参数）
- `operator_title_service` 初始化时偶发 `duplicate column` 告警（不影响启动）
- 磁盘空间检查使用 `os.statvfs`，Windows 上不可用（已捕获，仅警告）
- 后台主动发言、通知等 Android 专属能力不可用

## 免责声明

本项目为个人学习与备份用途，代码与资源提取自原作者的 ZOOT 应用（kiiinou / kinou，`com.rhodesisland.zoot`）。请勿用于商业用途。若版权方要求，本仓库将立即移除相关内容。

## 许可证

[Apache License 2.0](LICENSE)
