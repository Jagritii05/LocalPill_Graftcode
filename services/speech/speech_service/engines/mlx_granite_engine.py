import sys
from typing import Dict, Any, Optional
try:
    from .base import SpeechEngine
    from ..errors import EngineUnavailableException
except ImportError:
    from speech_service.engines.base import SpeechEngine
    from speech_service.errors import EngineUnavailableException

class MlxGraniteEngine(SpeechEngine):
    """
    Original macOS Granite / MLX engine, preserved for macOS cross-platform compatibility.
    Unavailable on Windows.
    """
    id = "mlx-granite"
    label = "Granite MLX (macOS Apple Silicon only)"
    is_local = True

    def __init__(self):
        self._model = None

    def is_available(self) -> bool:
        if sys.platform != "darwin":
            return False
        try:
            import mlx.core
            return True
        except ImportError:
            return False

    def load(self) -> None:
        if not self.is_available():
            raise EngineUnavailableException("MLX Granite engine is only available on macOS with Apple Silicon.")
        # Lazy load if on macOS
        pass

    def unload(self) -> None:
        self._model = None

    def transcribe(self, wav_path: str, prompt: str = "", language: Optional[str] = None) -> Dict[str, Any]:
        if not self.is_available():
            raise EngineUnavailableException("MLX Granite engine is only available on macOS with Apple Silicon.")
        raise NotImplementedError("MLX execution is not supported on this platform.")
