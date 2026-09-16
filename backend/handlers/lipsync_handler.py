"""Dedicated lip-sync via Fal Sync lipsync v3 or native Sync.so."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from threading import RLock

from api_types import LipSyncRequest, LipSyncResponse
from _routes._errors import HTTPError
from handlers.base import StateHandlerBase
from runtime_config.runtime_config import RuntimeConfig
from services.http_client.http_client import HTTPClient
from services.lipsync_client import LipSyncError, LipSyncKeys, generate_lipsync
from state.app_state_types import AppState

logger = logging.getLogger(__name__)


class LipSyncHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        config: RuntimeConfig,
        http: HTTPClient,
    ) -> None:
        super().__init__(state, lock, config)
        self._http = http

    def generate(self, req: LipSyncRequest) -> LipSyncResponse:
        settings = self.state.app_settings
        try:
            job = generate_lipsync(
                self._http,
                keys=LipSyncKeys(
                    fal_api_key=settings.fal_api_key,
                    sync_api_key=settings.sync_api_key,
                    runway_api_key=settings.runway_api_key,
                ),
                audio_path=req.audioPath,
                video_path=req.videoPath,
                image_path=req.imagePath,
                provider=req.provider,
                model=req.model,
                fallback=req.fallback,
            )
        except LipSyncError as exc:
            raise HTTPError(exc.status_code, str(exc), code=exc.code) from exc

        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = self.config.outputs_dir / f"lipsync_{stamp}_{uuid.uuid4().hex[:8]}.mp4"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(job.video)
        logger.info("Wrote lip-sync video to %s via %s", output, job.provider)
        return LipSyncResponse(
            path=str(output),
            provider=job.provider,
            model=job.model,
            fallbackReason=job.fallback_reason,
        )
