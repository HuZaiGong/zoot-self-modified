# 插件目录

这里放可直接安装的 ZOOT 插件包（Manifest v2）。每个子目录一个插件，用
`python tools/build_plugin_package.py <插件名>` 打成
`plugins/<插件名>.zoot-plugin`，再通过插件管理页（安装本地插件）或
`POST /api/plugins/install` 导入。

导入后插件默认为禁用状态（status=disabled），不会自动启动；
需在插件管理页手动启用。

## custom-embedding-model

把记忆向量化从内置本地 BGE ONNX 模型切换到任意 OpenAI 兼容
`/embeddings` 服务（OpenAI、Ollama、LM Studio、vLLM 等）。

- 激活后替换 `VectorRuntime.vectorizer`，写入独立向量空间
  `custom:<model>:<dim>:<hash>`，与原 BGE 向量缓存互不影响；
  停用后自动回退内置模型。
- 维度默认 `-1`：首次激活时调用一次 `/embeddings` 自动探测。
- `auto_reindex` 开启时，激活后自动重建既有记忆的向量索引。

### 安装

```bat
python tools\build_plugin_package.py custom-embedding-model
```

然后在插件管理页上传 `plugins\custom-embedding-model.zoot-plugin`，授予
`storage:plugin`、`system:trusted_python` 权限后安装（默认为禁用，需手动启用）。

### 配置

| 字段 | 说明 |
| --- | --- |
| `endpoint` | `/embeddings` 完整 URL，必填，如 `http://127.0.0.1:11434/v1/embeddings` |
| `model` | 模型名，必填，如 `bge-m3` |
| `api_key` | 可选，保存在本机加密存储（secret） |
| `dimensions` | 向量维度，`-1`（默认）自动探测 |
| `query_instruction` / `document_instruction` | BGE 类模型的前缀指令 |
| `timeout_seconds` / `batch_size` | 请求超时与批量 |
| `auto_reindex` | 激活后自动重建索引（默认开） |

### 验证

启用后调用动作 `status` 可看到生效的 `space_id`、`dimensions`、`mode`。
也可直接看记忆检索结果是否来自新向量空间。
