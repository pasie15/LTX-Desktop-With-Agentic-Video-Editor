"""Route handlers for ElevenLabs speech."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api_types import ElevenLabsSpeechRequest, ElevenLabsSpeechResponse
from app_handler import AppHandler
from state import get_state_service

router = APIRouter(prefix="/api", tags=["elevenlabs"])


@router.post("/elevenlabs/speech", response_model=ElevenLabsSpeechResponse)
def route_elevenlabs_speech(
    req: ElevenLabsSpeechRequest,
    handler: AppHandler = Depends(get_state_service),
) -> ElevenLabsSpeechResponse:
    return handler.elevenlabs.synthesize(req)
