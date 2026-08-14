"""custom-embedding-model 插件入口。

把记忆向量化从内置本地 BGE ONNX 模型切换到用户配置的
OpenAI 兼容 ``/embeddings`` 服务（OpenAI / Ollama / LM Studio / vLLM 等）。

契约（由 PC 宿主 launch.py 的 _TrustedPluginAdapter 调用）：
  * on_activate(zctx) / on_deactivate(zctx)
  * handle(action, payload, zctx) -> dict

设计要点：
  * 用一个独立 ``space_id`` 的向量器替换 ``VectorRuntime.vectorizer``，
    旧的 BGE 缓存向量按 space 隔离不会被误用；
  * 激活时自动 ``start_reindex`` 用新模型重建派生缓存；
  * 激活前先探测一次接口拿到真实维度（可被配置覆盖）。
"""

from __future__ import annotations

import json
import threading
import time

import httpx
import numpy as np

_LOCK = threading.RLock()
_SESSION = {"embedder": None}


class _Space:
    def __init__(self, space_id):
        self.space_id = space_id

    def to_dict(self):
        return {
            "space_id": self.space_id,
            "origin": "custom-embedding-model",
        }


class RemoteEmbedder:
    """OpenAI 兼容 ``/embeddings`` 适配器，实现 VectorRuntime 期望的接口。

    VectorRuntime 通过 ``vectorizer.encode`` / ``vectorizer.encode_query``
    计算向量，并通过 ``vectorizer.dim`` / ``vectorizer.space.space_id``
    读取维度与向量空间标识。
    """

    def __init__(self, cfg, log):
        self.endpoint = str(cfg.get("endpoint") or "").strip().rstrip("/")
        self.model = str(cfg.get("model") or "").strip()
        self.api_key = str(cfg.get("api_key") or "")
        self.dimensions = int(cfg.get("dimensions") or 0)
        self.timeout = float(cfg.get("timeout_seconds") or 60)
        self.batch_size = int(cfg.get("batch_size") or 8)
        self.query_instruction = str(cfg.get("query_instruction") or "")
        self.doc_instruction = str(cfg.get("document_instruction") or "")
        self.log = log

        if not self.endpoint or not self.model:
            raise ValueError("endpoint 与 model 均为必填")
        if self.dimensions <= 0:
            probe = self._request(["dimension probe"])
            if not probe or not probe[0]:
                raise ValueError("无法从 /embeddings 响应探测向量维度")
            self.dimensions = len(probe[0])
        self.dim = int(self.dimensions)
        self.space = _Space(self._make_space_id())
        self._client = httpx.Client(
            timeout=self.timeout,
            headers=self._headers(),
        )

    def _headers(self):
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _make_space_id(self):
        import hashlib

        raw = json.dumps(
            {
                "endpoint": self.endpoint.lower(),
                "model": self.model.lower(),
                "dimensions": self.dim,
                "query_instruction": self.query_instruction,
                "document_instruction": self.doc_instruction,
            },
            sort_keys=True,
            ensure_ascii=False,
        )
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]
        return f"custom:{self.model}:{self.dim}:{digest}"

    def _request(self, texts):
        payload = {"model": self.model, "input": list(texts)}
        try:
            response = self._client.post(self.endpoint, json=payload)
        except httpx.RequestError as exc:
            raise RuntimeError(f"请求 embeddings 服务失败：{exc}") from exc
        if response.status_code != 200:
            raise RuntimeError(
                f"embeddings 服务返回 HTTP {response.status_code}: "
                f"{response.text[:200]}"
            )
        try:
            data = response.json()
        except ValueError as exc:
            raise RuntimeError("embeddings 响应不是合法 JSON") from exc
        items = data.get("data")
        if not isinstance(items, list) or not items:
            raise RuntimeError("embeddings 响应缺少 data 数组")
        items = sorted(items, key=lambda it: int(it.get("index") or 0))
        vectors = [list(it.get("embedding") or []) for it in items]
        if len(vectors) != len(texts):
            raise RuntimeError(
                f"embeddings 返回 {len(vectors)} 条，期望 {len(texts)} 条"
            )
        return vectors

    def encode(self, text):
        prefixed = f"{self.doc_instruction}{text}"
        vector = self._request([prefixed])[0]
        return np.asarray(vector, dtype=np.float32)

    def encode_query(self, text):
        prefixed = f"{self.query_instruction}{text}" if self.query_instruction else text
        vector = self._request([prefixed])[0]
        return np.asarray(vector, dtype=np.float32)

    def batch_encode(self, texts):
        prefixed = [f"{self.doc_instruction}{t}" for t in texts]
        vectors = []
        for i in range(0, len(prefixed), self.batch_size):
            vectors.extend(self._request(prefixed[i : i + self.batch_size]))
        return [np.asarray(v, dtype=np.float32) for v in vectors]

    def describe_space(self):
        return self.space.to_dict()

    def close(self):
        try:
            self._client.close()
        except Exception:
            pass


def _build_embedder(cfg, log):
    return RemoteEmbedder(cfg, log)


def on_activate(zctx):
    cfg = zctx.get_config() or {}
    if not (cfg.get("endpoint") or "").strip() or not (cfg.get("model") or "").strip():
        return {"ok": False, "error": "请先在插件设置中填写 endpoint 与 model"}
    try:
        embedder = _build_embedder(cfg, zctx.log)
    except Exception as exc:
        return {"ok": False, "error": f"初始化自定义嵌入模型失败：{exc}"}

    runtime = zctx.vector_runtime
    with _LOCK:
        _SESSION["embedder"] = embedder
        try:
            runtime.vectorizer = embedder
            runtime.mode = "dense"
            runtime.fallback_reason = ""
            runtime.last_error = ""
            runtime.consecutive_failures = 0
        except AttributeError:
            _SESSION["embedder"] = None
            return {"ok": False, "error": "宿主向量运行时不可写"}

    zctx.log.info(
        "已切换到自定义嵌入模型 %s（space=%s dim=%d）",
        embedder.model,
        embedder.space.space_id,
        embedder.dim,
    )

    if cfg.get("auto_reindex", True):
        try:
            runtime.start_reindex()
            zctx.log.info("已触发向量索引重建（space=%s）", embedder.space.space_id)
        except Exception as exc:
            zctx.log.warning("触发 reindex 失败：%s", exc)

    return {
        "ok": True,
        "model": embedder.model,
        "space_id": embedder.space.space_id,
        "dimensions": embedder.dim,
    }


def on_deactivate(zctx):
    runtime = zctx.vector_runtime
    with _LOCK:
        embedder = _SESSION.get("embedder")
        _SESSION["embedder"] = None
    try:
        runtime.vectorizer = None
        runtime.fallback_reason = ""
    except Exception:
        pass
    if embedder is not None:
        embedder.close()
        zctx.log.info(
            "已停用自定义嵌入模型 %s，将在下次编码时回退内置向量器",
            embedder.model,
        )
    return {"ok": True}


def handle(action, payload, zctx):
    if action == "__event__":
        return {"ok": True}
    if action == "status":
        return _status(zctx)
    if action == "test":
        return _test(payload, zctx)
    if action == "apply":
        return on_activate(zctx)
    if action == "restore":
        return on_deactivate(zctx)
    if action == "reindex":
        runtime = zctx.vector_runtime
        return {"ok": True, "reindex": runtime.start_reindex()}
    return {"ok": False, "error": f"未知动作：{action}"}


def _status(zctx):
    runtime = zctx.vector_runtime
    embedder = _SESSION.get("embedder")
    return {
        "ok": True,
        "active": bool(embedder),
        "space_id": runtime.space_id,
        "dimensions": runtime.dimensions,
        "mode": getattr(runtime, "mode", None),
        "model": embedder.model if embedder else None,
        "endpoint": embedder.endpoint if embedder else None,
    }


def _test(payload, zctx):
    text = str((payload or {}).get("text") or "你好，博士")
    cfg = zctx.get_config() or {}
    try:
        embedder = _build_embedder(cfg, zctx.log)
    except Exception as exc:
        return {"ok": False, "error": f"配置无效：{exc}"}
    started = time.perf_counter()
    try:
        vector = embedder.encode_query(text)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        embedder.close()
    elapsed = (time.perf_counter() - started) * 1000.0
    return {
        "ok": True,
        "model": embedder.model,
        "dim": int(vector.shape[0]),
        "latency_ms": round(elapsed, 1),
        "preview": [round(float(v), 4) for v in vector[:6]],
    }
