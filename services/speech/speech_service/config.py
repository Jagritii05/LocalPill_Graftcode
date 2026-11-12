import os
import json
import pathlib

MAX_AUDIO_SECONDS = int(os.environ.get("MAX_AUDIO_SECONDS", "600"))
MAX_AUDIO_MB = int(os.environ.get("MAX_AUDIO_MB", "50"))

user_profile = os.environ.get("USERPROFILE", os.path.expanduser("~"))
app_data = os.environ.get("APPDATA", os.path.join(user_profile, "AppData", "Roaming"))
temp_root = os.environ.get("TEMP", os.path.join(user_profile, "AppData", "Local", "Temp"))

MCP_ALLOWED_DIR = os.environ.get("MCP_ALLOWED_DIR", os.path.join(user_profile, "LocalPillRecordings"))
MODELS_DIR = os.path.join(app_data, "LocalPill", "models")
TEMP_DIR = os.path.join(temp_root, "LocalPill")
SETTINGS_FILE = os.path.join(app_data, "LocalPill", "settings.json")
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
bundled_ffmpeg_win = os.path.join(PROJECT_ROOT, "node_modules", "ffmpeg-static", "ffmpeg.exe")
bundled_ffmpeg_posix = os.path.join(PROJECT_ROOT, "node_modules", "ffmpeg-static", "ffmpeg")

if os.path.exists(bundled_ffmpeg_win):
    DEFAULT_FFMPEG = bundled_ffmpeg_win
elif os.path.exists(bundled_ffmpeg_posix):
    DEFAULT_FFMPEG = bundled_ffmpeg_posix
else:
    DEFAULT_FFMPEG = "ffmpeg"

FFMPEG_PATH = os.environ.get("FFMPEG_PATH", DEFAULT_FFMPEG)
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GNANI_API_KEY = os.environ.get("GNANI_API_KEY", "")
SPEECH_LANGUAGE = os.environ.get("SPEECH_LANGUAGE", "en")


def _read_settings_json() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {}


def get_groq_api_key() -> str:
    env_key = os.environ.get("GROQ_API_KEY", "").strip()
    if env_key:
        return env_key
    settings = _read_settings_json()
    return str(settings.get("groqApiKey") or "").strip() or GROQ_API_KEY


def get_gnani_api_key() -> str:
    env_key = os.environ.get("GNANI_API_KEY", "").strip()
    if env_key:
        return env_key
    settings = _read_settings_json()
    return str(settings.get("gnaniApiKey") or "").strip() or GNANI_API_KEY


def get_speech_language() -> str:
    settings = _read_settings_json()
    lang = str(settings.get("speechLanguage") or "").strip()
    if lang:
        return lang
    return os.environ.get("SPEECH_LANGUAGE", SPEECH_LANGUAGE).strip() or "en"


# Ensure directories exist
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(MCP_ALLOWED_DIR, exist_ok=True)
