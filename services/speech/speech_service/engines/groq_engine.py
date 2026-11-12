import os
import requests
from typing import Dict, Any, Optional
try:
    from .base import SpeechEngine
    from ..errors import EngineUnavailableException, TranscriptionFailedException
    from ..config import get_groq_api_key, get_speech_language
except ImportError:
    from speech_service.engines.base import SpeechEngine
    from speech_service.errors import EngineUnavailableException, TranscriptionFailedException
    from speech_service.config import get_groq_api_key, get_speech_language

class GroqEngine(SpeechEngine):
    """
    Opt-in cloud transcription via Groq's high-speed Whisper API.
    """
    id = "groq-whisper"
    label = "Groq Whisper (Cloud: whisper-large-v3-turbo)"
    is_local = False

    def __init__(self, api_key: Optional[str] = None):
        self._explicit_key = api_key
        self.endpoint = "https://api.groq.com/openai/v1/audio/transcriptions"
        self.model_name = "whisper-large-v3-turbo"

    def _resolve_key(self) -> str:
        if self._explicit_key is not None:
            return self._explicit_key.strip()
        return get_groq_api_key()

    def is_available(self) -> bool:
        return bool(self._resolve_key())

    def load(self) -> None:
        if not self.is_available():
            raise EngineUnavailableException("Groq API key not set. Set GROQ_API_KEY environment variable or in Settings.")

    def unload(self) -> None:
        pass

    def transcribe(
        self, wav_path: str, prompt: str = "", language: Optional[str] = None
    ) -> Dict[str, Any]:
        key = self._resolve_key()
        if not key:
            raise EngineUnavailableException("Groq API key not configured.")

        headers = {
            "Authorization": f"Bearer {key}"
        }

        try:
            with open(wav_path, "rb") as f:
                files = {
                    "file": (os.path.basename(wav_path), f, "audio/wav")
                }
                data = {
                    "model": self.model_name,
                    "response_format": "verbose_json"
                }
                raw_lang = (language or get_speech_language() or "").strip().lower()
                if raw_lang and raw_lang != "auto":
                    data["language"] = raw_lang.split("-")[0]
                if prompt:
                    data["prompt"] = prompt

                resp = requests.post(self.endpoint, headers=headers, files=files, data=data, timeout=30)

            if resp.status_code != 200:
                raise TranscriptionFailedException(f"Groq API error {resp.status_code}: {resp.text}")

            result = resp.json()
            words_raw = result.get("words", [])
            words = []
            for w in words_raw:
                words.append({
                    "word": w.get("word", "").strip(),
                    "start": float(w.get("start", 0.0)),
                    "end": float(w.get("end", 0.0)),
                    "prob": float(w.get("probability", 1.0))
                })

            return {
                "text": result.get("text", "").strip(),
                "language": result.get("language", "en"),
                "duration": float(result.get("duration", 0.0)),
                "words": words
            }
        except Exception as e:
            if isinstance(e, (EngineUnavailableException, TranscriptionFailedException)):
                raise
            raise TranscriptionFailedException(f"Groq transcription failed: {e}") from e
