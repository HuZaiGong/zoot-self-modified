# ZOOT 插件

本目录存放可直接导入 ZOOT 的插件包（Manifest v2 格式）。ZOOT 内置完整的插件
系统（安装、权限、配置、动作、可信 Python 运行时），但 Android 原版并未把
`trusted_python` 执行器接到插件运行时上；本 PC 移植版通过 `launch.py` 注入
`_TrustedPluginAdapter`，使这类插件可以真正运行（见主 README「插件系统」）。

## 目录结构

```
plugins/
├── README.md
├── custom-embedding-model/          # 插件源码目录（一个插件一个目录）
│   ├── manifest.json                # Manifest v2 声明（id/权限/配置/动作）
│   └── plugin.py                    # trusted_python 插件入口
└── custom-embedding-model.zoot-plugin   # 打包产物，可直接导入
```

## 打包

```bat
python tools\build_plugin_package.py [插件名]
```

- 默认打包 `custom-embedding-model`，输出 `plugins\<插件名>.zoot-plugin`
- `.zoot-plugin` 是 ZOOT 约定的插件包扩展名，内容就是 zip（安装接口不校验后缀，
  前端文件选择器同时接受 `.zoot-plugin` 与 `.zip`）
- 打包时自动排除 `__pycache__` 与 `.pyc`

## 导入安装

两种方式等价：

1. **插件管理页**：设置 → 插件扩展 → 「安装本地插件」选择
   `custom-embedding-model.zoot-plugin` → 预检通过后勾选授予权限 → 确认安装
2. **API**：
   ```
   POST /api/plugins/install/preflight   # multipart 字段名 package
   POST /api/plugins/install/confirm     # {token, accepted_permissions, accept_unsigned, accept_trusted_python}
   ```

**默认不启动**：安装后插件状态为 `disabled`，不会自动运行，需在插件管理页手动
「启用」。启用后状态持久化——之后每次启动 ZOOT 会自动恢复为启用状态；
停用（disable）后则不再自动加载。

## 权限模型

| 权限 | 风险 | 用途 |
|---|---|---|
| `storage:plugin` | low | 读写插件自己的配置与存储 |
| `system:trusted_python` | critical | 允许插件代码在宿主 Python 进程内直接执行 |

`trusted_python` 插件**不是沙箱**：安装即授予它完全的后端代码执行权，
只在确认安装时弹窗警示，请仅安装可信来源的插件。

## 插件开发约定（trusted_python）

插件入口 `plugin.py` 由 PC 宿主的 `_TrustedPluginAdapter` 加载，须提供：

```python
def on_activate(zctx) -> dict      # 启用时调用，返回 {"ok": bool, ...}
def on_deactivate(zctx) -> dict    # 停用时调用
def handle(action, payload, zctx) -> dict   # 动作分发（status/test/...）
```

宿主能力句柄 `zctx`：

| 成员 | 说明 |
|---|---|
| `plugin_id` / `log` / `manifest` | 插件标识、logger（`zoot.plugin.<id>`）、Manifest |
| `runtime` | `PluginRuntime` 单例（可读配置、注册表） |
| `get_config(include_secrets=True)` | 读取配置（secret 字段解密后合并返回） |
| `vector_runtime` | `VectorRuntime` 单例（可替换 `vectorizer` 触发向量化切换） |

`manifest.json` 中 `config_schema` 声明配置项（含 secret 字段，加密存储于本机）、
`actions` 声明插件页上的动作按钮、`permissions` 声明所需权限。

---

# custom-embedding-model

把记忆向量化从内置本地 BGE ONNX 模型切换到任意 OpenAI 兼容 `/embeddings`
服务（OpenAI、Ollama、LM Studio、vLLM 等），无需本地 GPU/ONNX。

## 原理

- 启用时构造 `RemoteEmbedder` 替换 `VectorRuntime.vectorizer`，检索模式切为
  `dense`；停用时置空，下次编码自动回退内置 BGE 模型
- 使用独立向量空间 `custom:<model>:<dim>:<sha256 前 12 位>`：
  新模型产生的向量与旧 BGE 缓存**按 space 隔离**，不会被误检索混用
- `dimensions` 为 `-1`（默认）时，启用前先请求一次 `/embeddings` 自动探测维度
- `auto_reindex`（默认开）启用时自动重建既有记忆的向量索引
  （`VectorRuntime.start_reindex`，数据多时较慢，可关闭后手动触发）

## 安装

```bat
python tools\build_plugin_package.py custom-embedding-model
```

插件管理页导入 `plugins\custom-embedding-model.zoot-plugin`，授予
`storage:plugin` + `system:trusted_python` 后安装并启用。

## 配置

在插件页「配置」表单填写（`endpoint`、`model` 必填，未填则启用失败）：

| 字段 | 说明 | 默认 |
|---|---|---|
| `endpoint` | `/embeddings` 完整 URL，如 `http://127.0.0.1:11434/v1/embeddings` | 必填 |
| `model` | 请求中的模型名，如 `bge-m3`、`text-embedding-3-small` | 必填 |
| `api_key` | 可选 Bearer Key，加密存储（secret） | 空 |
| `dimensions` | 向量维度；`-1` 首次激活自动探测 | `-1` |
| `query_instruction` | 检索查询编码前缀（BGE 类模型需要，OpenAI 类留空） | 空 |
| `document_instruction` | 记忆/消息文档编码前缀 | 空 |
| `timeout_seconds` | 单请求超时 | `60` |
| `batch_size` | 批量重建时的单次请求条数 | `8` |
| `auto_reindex` | 激活后自动重建索引 | `true` |

## 动作

| 动作 | 说明 |
|---|---|
| `status` | 查看当前生效的 `space_id` / `dimensions` / `mode` / 模型 |
| `test` | 立即发一次请求验证配置（返回维度与耗时，不改运行时） |
| `apply` | 不重启插件即用当前配置重新激活（等效重新启用） |
| `restore` | 立即回退内置向量器 |
| `reindex` | 手动重建向量索引 |

## 验证

启用后调用动作 `status`，确认：

```
active: true
space_id: custom:<model>:<dim>:<hash>   # 以 custom: 开头即生效
mode: dense
```

再调用 `test` 确认连通性。也可以直接问博士记忆相关的问题，观察回答是否命中
新向量空间的记忆。

## 故障排查

| 现象 | 处理 |
|---|---|
| 启用报「插件操作失败」 | 看后端控制台 stderr：`[PluginAdapter]` 后的 traceback 即真实原因 |
| 启用报「请先…填写 endpoint 与 model」 | 配置未保存/未填必填项，先保存配置再启用 |
| 启用报「初始化自定义嵌入模型失败」 | 接口不可达、维度探测失败或模型名错误；先用 `test` 动作验证 |
| `test` 报 HTTP 非 200 | 检查 endpoint 是否为完整 `/embeddings` URL、模型名、密钥 |
| 检索结果异常 | 确认 `dimensions` 与模型实际输出一致；换模型后建议 `reindex` |

## 示例：本地 Ollama

```bash
ollama pull bge-m3
```

配置：`endpoint = http://127.0.0.1:11434/v1/embeddings`，`model = bge-m3`，
`query_instruction = 为这个句子生成表示以用于检索相关文章：`。