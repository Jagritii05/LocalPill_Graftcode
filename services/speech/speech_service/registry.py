from typing import Dict, List, Any, Optional
try:
    from .engines.base import SpeechEngine
    from .engines.faster_whisper_engine import FasterWhisperEngine
    from .engines.groq_engine import GroqEngine
    from .engines.gnani_engine import GnaniEngine
    from .engines.mlx_granite_engine import MlxGraniteEngine
    from .errors import EngineUnavailableException
except ImportError:
    from speech_service.engines.base import SpeechEngine
    from speech_service.engines.faster_whisper_engine import FasterWhisperEngine
    from speech_service.engines.groq_engine import GroqEngine
    from speech_service.engines.gnani_engine import GnaniEngine
    from speech_service.engines.mlx_granite_engine import MlxGraniteEngine
    from speech_service.errors import EngineUnavailableException

class EngineRegistry:
    """
    Central registry for available speech transcription engines.
    """
    def __init__(self):
        self._engines: Dict[str, SpeechEngine] = {
            "whisper-tiny": FasterWhisperEngine(model_size="tiny"),
            "whisper-base": FasterWhisperEngine(model_size="base"),
            "whisper-small": FasterWhisperEngine(model_size="small"),
            "groq-whisper": GroqEngine(),
            "gnani-prisma": GnaniEngine(),
            "mlx-granite": MlxGraniteEngine(),
        }
        self._active_id: str = "whisper-base"

    def list_engines(self) -> List[Dict[str, Any]]:
        result = []
        for eng_id, eng in self._engines.items():
            result.append({
                "id": eng.id,
                "label": eng.label,
                "is_local": eng.is_local,
                "is_available": eng.is_available(),
                "is_active": (eng_id == self._active_id),
                "is_downloaded": getattr(eng, "is_downloaded", lambda: True)(),
                "device": getattr(eng, "_device", "cloud" if not eng.is_local else "cpu"),
                "compute_type": getattr(eng, "_compute_type", "n/a"),
            })
        return result

    def get_engine(self, engine_id: Optional[str] = None) -> SpeechEngine:
        target_id = engine_id or self._active_id
        if target_id not in self._engines:
            raise EngineUnavailableException(f"Unknown engine ID: {target_id}")
        return self._engines[target_id]

    def set_active_engine(self, engine_id: str) -> SpeechEngine:
        if engine_id not in self._engines:
            raise EngineUnavailableException(f"Unknown engine ID: {engine_id}")
        engine = self._engines[engine_id]
        if not engine.is_available():
            raise EngineUnavailableException(f"Engine '{engine_id}' is not available on this system.")
        
        # If switching engines, unload previous if loaded
        if self._active_id != engine_id and self._active_id in self._engines:
            try:
                self._engines[self._active_id].unload()
            except Exception:
                pass

        self._active_id = engine_id
        return engine

    @property
    def active_engine_id(self) -> str:
        return self._active_id

# Global singleton
registry = EngineRegistry()
