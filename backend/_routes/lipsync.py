"""Route handlers for dedicated lip-sync."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api_types import LipSyncRequest, LipSyncResponse
from app_handler import AppHandler
from state import get_state_service

router = APIRouter(prefix="/api", tags=["lipsync"])


@router.post("/lipsync", response_model=LipSyncResponse)
def route_lipsync(
    req: LipSyncRequest,
    handler: AppHandler = Depends(get_state_service),
) -> LipSyncResponse:
    return handler.lipsync.generate(req)
