"""Compatibility import for the shared ONNX vectorizer."""

from pathlib import Path

from .resource_paths import bundled_resource_path
from .unified_vectorizer import UnifiedOnnxVectorizer, get_vectorizer

VectorizerONNX = UnifiedOnnxVectorizer


def _model_dir() -> Path:
    model_file = bundled_resource_path("vector_model/model.int8.onnx")
    if model_file is not None:
        return model_file.parent
    return Path(__file__).resolve().parents[2] / "resources" / "vector_model"


MODEL_DIR = _model_dir()
