"""ElevenLabs speech generation."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from threading import RLock

from api_types import ElevenLabsSpeechRequest, ElevenLabsSpeechResponse
from _routes._errors import HTTPError
from handlers.base import StateHandlerBase
from runtime_config.runtime_config import RuntimeConfig
from services.elevenlabs_client import (
    DEFAULT_ELEVENLABS_MODEL_ID,
    DEFAULT_ELEVENLABS_VOICE_ID,
    ElevenLabsError,
    synthesize_speech,
)
from services.http_client.http_client import HTTPClient
from state.app_state_types import AppState

logger = logging.getLogger(__name__)


class ElevenLabsHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        config: RuntimeConfig,
        http: HTTPClient,
    ) -> None:
        super().__init__(state, lock, config)
        self._http = http

    def synthesize(self, req: ElevenLabsSpeechRequest) -> ElevenLabsSpeechResponse:
        settings = self.state.app_settings
        api_key = settings.elevenlabs_api_key
        voice_id = req.voiceId.strip() or DEFAULT_ELEVENLABS_VOICE_ID
        model_id = req.modelId.strip() or DEFAULT_ELEVENLABS_MODEL_ID
        try:
            audio = synthesize_speech(
                self._http,
                api_key=api_key,
                text=req.text,
                voice_id=voice_id,
                model_id=model_id,
            )
        except ElevenLabsError as exc:
            raise HTTPError(exc.status_code, str(exc)) from exc

        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = self.config.outputs_dir / f"elevenlabs_{stamp}_{uuid.uuid4().hex[:8]}.mp3"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(audio)
        logger.info("Wrote ElevenLabs speech to %s", output)
        return ElevenLabsSpeechResponse(path=str(output), voiceId=voice_id, modelId=model_id)
