"""ElevenLabs text-to-speech client."""

from __future__ import annotations

from collections.abc import Mapping

from services.http_client.http_client import HTTPClient, HttpTransportError

DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"
DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2"
ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"


class ElevenLabsError(Exception):
    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def synthesize_speech(
    http: HTTPClient,
    *,
    api_key: str,
    text: str,
    voice_id: str = DEFAULT_ELEVENLABS_VOICE_ID,
    model_id: str = DEFAULT_ELEVENLABS_MODEL_ID,
    timeout: int = 60,
) -> bytes:
    key = api_key.strip()
    prompt = text.strip()
    voice = voice_id.strip() or DEFAULT_ELEVENLABS_VOICE_ID
    model = model_id.strip() or DEFAULT_ELEVENLABS_MODEL_ID
    if not key:
        raise ElevenLabsError("ELEVENLABS_API_KEY_MISSING", status_code=400)
    if not prompt:
        raise ElevenLabsError("ELEVENLABS_TEXT_MISSING", status_code=400)

    url = ELEVENLABS_TTS_URL.format(voice_id=voice)
    headers: dict[str, str] = {
        "xi-api-key": key,
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
    }
    payload: Mapping[str, str] = {"text": prompt, "model_id": model}
    try:
        response = http.post(url, headers=headers, json_payload=dict(payload), timeout=timeout)
    except HttpTransportError as exc:
        raise ElevenLabsError(f"ELEVENLABS_TRANSPORT: {exc}", status_code=502) from exc

    if response.status_code == 401:
        raise ElevenLabsError("ELEVENLABS_API_KEY_INVALID", status_code=401)
    if response.status_code >= 400:
        detail = response.text.strip() or f"HTTP_{response.status_code}"
        raise ElevenLabsError(detail, status_code=502)
    audio = response.content
    if not audio:
        raise ElevenLabsError("ELEVENLABS_EMPTY_AUDIO", status_code=502)
    return audio
