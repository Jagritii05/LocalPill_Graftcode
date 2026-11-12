import os
import sys
import wave
import math
import struct
import tempfile
import pytest

# Ensure services/speech is on python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from speech_service.errors import (
    InvalidAudioException,
    AudioTooLongException,
    EngineUnavailableException,
)
from speech_service.audio_prep import validate_audio_file, convert_to_wav
from speech_service.registry import registry
from speech_service.engines.mlx_granite_engine import MlxGraniteEngine
from speech_service.engines.groq_engine import GroqEngine
from speech_service.engines.gnani_engine import GnaniEngine
from speech_service.engines.faster_whisper_engine import FasterWhisperEngine

def create_dummy_wav(path: str, duration_sec: float = 1.0, sample_rate: int = 16000):
    """Create a valid mono 16-bit PCM wav file with a 440Hz sine wave."""
    num_samples = int(duration_sec * sample_rate)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        for i in range(num_samples):
            val = int(32767.0 * 0.5 * math.sin(2.0 * math.pi * 440.0 * i / sample_rate))
            w.writeframes(struct.pack('<h', val))

def test_validate_audio_file_not_found():
    with pytest.raises(FileNotFoundError):
        validate_audio_file("C:/nonexistent/file.wav")

def test_validate_audio_file_empty(tmp_path):
    empty_file = tmp_path / "empty.wav"
    empty_file.write_bytes(b"")
    with pytest.raises(InvalidAudioException):
        validate_audio_file(str(empty_file))

def test_audio_conversion_synthetic_wav(tmp_path):
    input_wav = tmp_path / "input.wav"
    create_dummy_wav(str(input_wav), duration_sec=1.5, sample_rate=16000)

    out_wav, duration = convert_to_wav(str(input_wav))
    try:
        assert os.path.exists(out_wav)
        assert abs(duration - 1.5) < 0.1
        with wave.open(out_wav, 'rb') as w:
            assert w.getnchannels() == 1
            assert w.getframerate() == 16000
            assert w.getsampwidth() == 2
    finally:
        if os.path.exists(out_wav):
            os.remove(out_wav)

def test_registry_engines():
    engines = registry.list_engines()
    ids = [e["id"] for e in engines]
    assert "whisper-tiny" in ids
    assert "whisper-base" in ids
    assert "whisper-small" in ids
    assert "groq-whisper" in ids
    assert "gnani-prisma" in ids
    assert "mlx-granite" in ids

def test_mlx_granite_unavailable_on_windows():
    mlx_eng = MlxGraniteEngine()
    if sys.platform != "darwin":
        assert mlx_eng.is_available() is False
        with pytest.raises(EngineUnavailableException):
            mlx_eng.load()

def test_groq_engine_availability():
    groq = GroqEngine(api_key="")
    assert groq.is_available() is False
    groq_with_key = GroqEngine(api_key="gsk_test123")
    assert groq_with_key.is_available() is True

def test_faster_whisper_engine_creation():
    eng = FasterWhisperEngine(model_size="tiny")
    assert eng.id == "whisper-tiny"
    assert eng.is_local is True
    assert eng.is_available() is True
    assert eng._device in ("cpu", "cuda")

def test_speech_service_facade(tmp_path):
    from speech_service.service import SpeechService
    from speech_service.errors import PathNotAllowedException
    import json

    svc = SpeechService()
    assert svc.is_ready() is True

    health = svc.health()
    assert health["ready"] is True
    assert "whisper" in health["engine"]

    health_json = svc.health_json()
    parsed_health = json.loads(health_json)
    assert parsed_health["ready"] is True

    engines = svc.list_engines()
    assert len(engines) >= 5

    # Test MCP security boundary
    outside_file = str(tmp_path / "secret.wav")
    with pytest.raises(PathNotAllowedException):
        SpeechService.TranscribeFileJson(outside_file)


def test_gnani_engine_availability():
    gnani = GnaniEngine(api_key="")
    assert gnani.is_available() is False
    gnani_with_key = GnaniEngine(api_key="gnani_test_key")
    assert gnani_with_key.is_available() is True


def test_gnani_engine_transcribe_mocked(tmp_path, monkeypatch):
    import requests

    wav_file = tmp_path / "sample.wav"
    create_dummy_wav(str(wav_file), duration_sec=0.5, sample_rate=16000)

    captured = {}

    class MockResponse:
        status_code = 200
        text = "{}"

        def json(self):
            return {
                "transcript": "Mera naam Rahul hai",
                "detected_language_code": "hi-IN",
                "duration": 0.5,
            }

    def fake_post(url, headers=None, files=None, data=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["data"] = data
        return MockResponse()

    monkeypatch.setattr(requests, "post", fake_post)

    gnani = GnaniEngine(api_key="gnani_test_key")
    res = gnani.transcribe(str(wav_file), language="hi-IN")
    assert res["text"] == "Mera naam Rahul hai"
    assert res["language"] == "hi-IN"
    assert captured["url"] == "https://api.vachana.ai/stt/v3"
    assert captured["headers"]["X-API-Key-ID"] == "gnani_test_key"
    assert captured["data"]["language_code"] == "hi-IN"
    assert captured["data"]["model"] == "prisma-v3.0"
