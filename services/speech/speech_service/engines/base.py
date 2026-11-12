from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional

class SpeechEngine(ABC):
    """
    Abstract base class for all LocalPill speech engines.
    """
    id: str
    label: str
    is_local: bool = True

    @abstractmethod
    def is_available(self) -> bool:
        """Check if engine prerequisites (model downloaded, hardware, API key) are satisfied."""
        pass

    @abstractmethod
    def load(self) -> None:
        """Load model into memory or initialize API client."""
        pass

    @abstractmethod
    def unload(self) -> None:
        """Release loaded model from memory to free resources."""
        pass

    @abstractmethod
    def transcribe(self, wav_path: str, prompt: str = "", language: Optional[str] = None) -> Dict[str, Any]:
        """
        Transcribe a 16 kHz mono WAV file.
        Returns a dict:
        {
            "text": str,
            "language": str,
            "duration": float,
            "words": List[{"word": str, "start": float, "end": float, "prob": float}]
        }
        """
        pass
