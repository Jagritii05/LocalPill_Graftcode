import os
from typing import Dict, Any, Optional

import requests

try:
    from .base import SpeechEngine
    from ..errors import EngineUnavailableException, TranscriptionFailedException
    from ..config import get_gnani_api_key, get_speech_language
except ImportError:
    from speech_service.engines.base import SpeechEngine
    from speech_service.errors import EngineUnavailableException, TranscriptionFailedException
    from speech_service.config import get_gnani_api_key, get_speech_language


def _normalize_gnani_lang(language: Optional[str]) -> str:
    lang = (language or "").strip()
    if not lang or lang.lower() == "auto":
        return "hi-IN"
    low = lang.lower()
    if low == "en":
        return "en-IN"
    if low == "hi":
        return "hi-IN"
    if low == "ta":
        return "ta-IN"
    if low == "bn":
        return "bn-IN"
    if low == "te":
        return "te-IN"
    if low == "kn":
        return "kn-IN"
    if low == "mr":
        return "mr-IN"
    if low == "gu":
        return "gu-IN"
    if low == "ml":
        return "ml-IN"
    if low == "pa":
        return "pa-IN"
    return lang


class GnaniEngine(SpeechEngine):
    """Opt-in cloud multilingual transcription via Gnani AI Vachana Prisma STT."""

    id = "gnani-prisma"
    label = "Gnani Prisma STT (Cloud: Multilingual Indic)"
    is_local = False

    def __init__(self, api_key: Optional[str] = None):
        self._explicit_key = api_key
        self.endpoint = "https://api.vachana.ai/stt/v3"
        self.model_name = "prisma-v3.0"

    def _resolve_key(self) -> str:
        if self._explicit_key is not None:
            return self._explicit_key.strip()
        return get_gnani_api_key()

    def is_available(self) -> bool:
        return bool(self._resolve_key())

    def load(self) -> None:
        if not self.is_available():
            raise EngineUnavailableException(
                "Gnani API key not set. Add GNANI_API_KEY in .env or Settings."
            )

    def unload(self) -> None:
        pass

    def transcribe(
        self, wav_path: str, prompt: str = "", language: Optional[str] = None
    ) -> Dict[str, Any]:
        key = self._resolve_key()
        if not key:
            raise EngineUnavailableException("Gnani API key not configured.")

        if not os.path.exists(wav_path):
            raise FileNotFoundError(f"Audio file not found: {wav_path}")

        target_lang = _normalize_gnani_lang(language or get_speech_language())
        headers = {"X-API-Key-ID": key}

        try:
            with open(wav_path, "rb") as f:
                files = {"audio_file": (os.path.basename(wav_path), f, "audio/wav")}
                data = {
                    "language_code": target_lang,
                    "model": self.model_name,
                }
                resp = requests.post(
                    self.endpoint, headers=headers, files=files, data=data, timeout=25
                )

            if resp.status_code in (401, 403):
                raise EngineUnavailableException(
                    f"Gnani API authentication failed ({resp.status_code}). Check GNANI_API_KEY."
                )
            if resp.status_code == 429:
                raise TranscriptionFailedException("Gnani STT rate limit exceeded (429).")
            if resp.status_code != 200:
                raise TranscriptionFailedException(
                    f"Gnani STT error {resp.status_code}: {resp.text}"
                )

            result = resp.json()
            transcript = (result.get("transcript") or result.get("text") or "").strip()
            detected_lang = result.get("detected_language_code") or target_lang

            return {
                "text": transcript,
                "language": detected_lang,
                "duration": float(result.get("duration", 0.0)),
                "words": [],
            }
        except (EngineUnavailableException, TranscriptionFailedException):
            raise
        except Exception as e:
            raise TranscriptionFailedException(f"Gnani STT request failed: {e}") from e

