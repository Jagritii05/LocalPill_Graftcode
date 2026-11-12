"""
SpeechService implementation for LocalPill.
Exposes clean, type-safe methods for Graftcode RPC and local consumers.
"""

import os
import json
import base64
import tempfile
import threading
from typing import Dict, Any, List

try:
    from .registry import registry
    from .audio_prep import convert_to_wav
    from .errors import (
        ModelNotReadyException,
        InvalidAudioException,
        AudioTooLongException,
        EngineUnavailableException,
        TranscriptionFailedException,
        PathNotAllowedException,
    )
    from .config import MCP_ALLOWED_DIR, TEMP_DIR
except ImportError:
    from speech_service.registry import registry
    from speech_service.audio_prep import convert_to_wav
    from speech_service.errors import (
        ModelNotReadyException,
        InvalidAudioException,
        AudioTooLongException,
        EngineUnavailableException,
        TranscriptionFailedException,
        PathNotAllowedException,
    )
    from speech_service.config import MCP_ALLOWED_DIR, TEMP_DIR

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac"}


def _validate_mcp_file_path(file_path: str) -> str:
    if not file_path or not isinstance(file_path, str) or not file_path.strip():
        raise InvalidAudioException("InvalidAudioException: filePath is required and must be a non-empty string")

    allowed_dir = os.environ.get("MCP_ALLOWED_DIR") or MCP_ALLOWED_DIR
    os.makedirs(allowed_dir, exist_ok=True)

    norm_allowed = os.path.abspath(allowed_dir)
    norm_candidate = os.path.abspath(file_path)

    allowed_prefix = norm_allowed.lower().rstrip("\\/") + os.sep
    if not norm_candidate.lower().startswith(allowed_prefix):
        raise PathNotAllowedException(
            f"PathNotAllowedException: Access denied. File '{file_path}' is outside allowed directory '{norm_allowed}'"
        )

    ext = os.path.splitext(norm_candidate)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise InvalidAudioException(
            f"InvalidAudioException: Unsupported file format '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    if not os.path.exists(norm_candidate):
        raise InvalidAudioException(f"InvalidAudioException: File does not exist: {file_path}")

    real_allowed = os.path.realpath(norm_allowed)
    real_target = os.path.realpath(norm_candidate)
    real_allowed_prefix = real_allowed.lower().rstrip("\\/") + os.sep
    if not real_target.lower().startswith(real_allowed_prefix):
        raise PathNotAllowedException(
            f"PathNotAllowedException: Access denied (symlink/junction escape detected). Real path '{real_target}' is outside '{real_allowed}'"
        )

    if not os.path.isfile(real_target):
        raise InvalidAudioException(f"InvalidAudioException: Target is not a regular file: {file_path}")

    if os.path.getsize(real_target) == 0:
        raise InvalidAudioException(f"InvalidAudioException: Audio file is empty (0 bytes): {file_path}")

    return real_target


class SpeechService:
    """
    LocalPill Speech Service.
    Hosted directly on Graftcode Gateway (--runtime python) and exposed via WebSocket RPC and MCP.
    """

    def __init__(self):
        self._registry = registry

    def is_ready(self) -> bool:
        """Check if active engine is loaded and ready."""
        try:
            eng = self._registry.get_engine()
            return eng.is_available()
        except Exception:
            return False

    def health(self):
        """Return engine readiness and status."""
        try:
            eng = self._registry.get_engine()
            return {
                "ready": True,
                "engine": eng.id,
                "label": eng.label,
                "is_local": eng.is_local,
                "error": None,
            }
        except Exception as e:
            return {
                "ready": False,
                "engine": self._registry.active_engine_id,
                "label": "Unavailable",
                "is_local": True,
                "error": str(e),
            }

    def health_json(self) -> str:
        """Health status serialized as JSON string."""
        return json.dumps(self.health())

    @staticmethod
    def healthJson() -> str:
        """Static health status serialized as JSON string for Graftcode RPC."""
        return SpeechService().health_json()

    def list_engines(self):
        """List all supported transcription engines."""
        return self._registry.list_engines()

    def list_engines_json(self) -> str:
        """List engines serialized as JSON string."""
        return json.dumps(self.list_engines())

    @staticmethod
    def listEnginesJson() -> str:
        """Static engine list serialized as JSON string for Graftcode RPC."""
        return SpeechService().list_engines_json()

    def switch_engine(self, engine_id: str) -> bool:
        """Switch active engine and load into memory."""
        engine = self._registry.set_active_engine(engine_id)
        engine.load()
        return True

    @staticmethod
    def switchEngine(engineId: str) -> bool:
        """Static method to switch active engine via Graftcode RPC."""
        return SpeechService().switch_engine(engineId)

    def _transcribe_path_internal(self, file_path: str, prompt: str = "") -> Dict[str, Any]:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        effective_prompt = prompt or ""
        language = None
        if isinstance(effective_prompt, str) and effective_prompt.startswith('{"__localpill_opts":'):
            try:
                opts = json.loads(effective_prompt)
                if isinstance(opts, dict) and opts.get("__localpill_opts"):
                    language = opts.get("language") or None
                    effective_prompt = opts.get("prompt") or ""
            except Exception:
                pass

        wav_path = None
        try:
            wav_path, duration = convert_to_wav(file_path)
            engine = self._registry.get_engine()
            result = engine.transcribe(wav_path, prompt=effective_prompt, language=language)
            result["duration"] = result.get("duration") or duration
            return result
        finally:
            if wav_path and os.path.exists(wav_path) and wav_path != file_path:
                try:
                    os.remove(wav_path)
                except OSError:
                    pass

    def transcribe_file(self, file_path: str, prompt: str = ""):
        """
        Transcribe an existing audio file inside the allowed MCP directory.
        Converts to 16 kHz mono WAV and transcribes using the active engine.
        """
        safe_path = _validate_mcp_file_path(file_path)
        return self._transcribe_path_internal(safe_path, prompt=prompt)

    def transcribe_file_json(self, file_path: str, prompt: str = "") -> str:
        """Transcribe file within MCP_ALLOWED_DIR with JSON string return."""
        res = self.transcribe_file(file_path, prompt=prompt)
        return json.dumps(res)

    def transcribe_bytes(self, audio_bytes: bytes, prompt: str = ""):
        """
        Transcribe raw audio bytes (WebM, WAV, OGG, etc.) received over wire.
        """
        if not audio_bytes or len(audio_bytes) == 0:
            raise InvalidAudioException("InvalidAudioException: Empty audio payload received (0 bytes).")

        os.makedirs(TEMP_DIR, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(suffix=".webm", dir=TEMP_DIR)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(audio_bytes)
            return self._transcribe_path_internal(tmp_path, prompt=prompt)
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    def transcribe_bytes_json(self, audio_bytes: bytes, prompt: str = "") -> str:
        """Transcribe raw audio bytes with JSON string return."""
        res = self.transcribe_bytes(audio_bytes, prompt=prompt)
        return json.dumps(res)

    @staticmethod
    def transcribeBytesJson(audioBase64: str, prompt: str = "") -> str:
        """Transcribe base64-encoded audio payload received over Graftcode WebSocket RPC."""
        if not audioBase64 or not isinstance(audioBase64, str) or not audioBase64.strip():
            raise InvalidAudioException("InvalidAudioException: audioBase64 is required and must be a non-empty base64 string")
        try:
            audio_bytes = base64.b64decode(audioBase64)
        except Exception as e:
            raise InvalidAudioException(f"InvalidAudioException: Failed to decode base64 audio: {e}") from e

        if not audio_bytes:
            raise InvalidAudioException("InvalidAudioException: Decoded audio buffer is empty (0 bytes)")

        svc = SpeechService()
        res = svc.transcribe_bytes(audio_bytes, prompt=prompt or "")
        return json.dumps(res)

    @staticmethod
    def transcribeFileJson(filePath: str, prompt: str = "") -> str:
        """Transcribe audio file within allowed directory (camelCase alias)."""
        return SpeechService.TranscribeFileJson(filePath, prompt=prompt)

    @staticmethod
    def TranscribeFileJson(filePath: str, prompt: str = "") -> str:
        """Transcribe audio file within MCP_ALLOWED_DIR security sandbox."""
        safe_path = _validate_mcp_file_path(filePath)
        svc = SpeechService()
        res = svc._transcribe_path_internal(safe_path, prompt=prompt or "")
        return json.dumps(res)


# Module-level instance
speech_service = SpeechService()
