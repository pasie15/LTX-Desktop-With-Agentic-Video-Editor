"""Fal Sync lipsync and native Sync.so lip-sync clients.

Runway's official API has no dedicated lip-sync endpoint. Requests that ask for
Runway fall back to Fal or Sync.so with an explicit reason — we do not invent a
Runway /lip_sync call or reuse character_performance (Act Two driving).
"""

from __future__ import annotations

import base64
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

_MACHINE_CODE = re.compile(r"^[A-Z0-9]+(?:_[A-Z0-9]+)*$")

from services.http_client.http_client import HTTPClient, HttpTransportError
from services.services_utils import JSONValue

LipSyncProviderName = Literal["fal", "sync"]
LipSyncRequestedProvider = Literal["auto", "fal", "sync", "runway"]

FAL_RUN_BASE = "https://fal.run"
FAL_LIPSYNC_VIDEO_ENDPOINT = "/fal-ai/sync-lipsync/v3"
FAL_LIPSYNC_IMAGE_ENDPOINT = "/fal-ai/sync-lipsync/v3/image-to-video"

SYNC_GENERATE_URL = "https://api.sync.so/v2/generate"
DEFAULT_SYNC_MODEL = "lipsync-2"
DEFAULT_MAX_MEDIA_BYTES = 25 * 1024 * 1024
DEFAULT_POLL_ATTEMPTS = 60
DEFAULT_POLL_INTERVAL_S = 2.0

RUNWAY_FALLBACK_REASON = (
    "Runway's official API has no dedicated lip-sync endpoint "
    "(character_performance is Act Two driving, not mouth sync). "
    "Used Fal or Sync.so instead."
)

_MIME_BY_SUFFIX: dict[str, str] = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


class LipSyncError(Exception):
    def __init__(self, message: str, *, status_code: int = 502, code: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        matched = _MACHINE_CODE.fullmatch(message)
        self.code = code or (matched.group(0) if matched else None)


@dataclass(frozen=True)
class LipSyncKeys:
    fal_api_key: str = ""
    sync_api_key: str = ""
    runway_api_key: str = ""


@dataclass(frozen=True)
class LipSyncJob:
    video: bytes
    provider: LipSyncProviderName
    model: str
    fallback_reason: str = ""


@dataclass(frozen=True)
class ResolvedLipSyncProvider:
    name: LipSyncProviderName
    api_key: str
    fallback_reason: str = ""


def resolve_lipsync_provider(
    requested: LipSyncRequestedProvider,
    keys: LipSyncKeys,
    *,
    image_only: bool = False,
    fallback: bool = True,
) -> ResolvedLipSyncProvider:
    fal_key = keys.fal_api_key.strip()
    sync_key = keys.sync_api_key.strip()
    runway_key = keys.runway_api_key.strip()

    if image_only and requested in ("auto", "fal", "runway"):
        if fal_key:
            reason = RUNWAY_FALLBACK_REASON if requested == "runway" else ""
            return ResolvedLipSyncProvider(name="fal", api_key=fal_key, fallback_reason=reason)
        if requested == "fal":
            raise LipSyncError("LIPSYNC_FAL_API_KEY_MISSING", status_code=400)
        raise LipSyncError("LIPSYNC_IMAGE_TO_VIDEO_REQUIRES_FAL", status_code=400)

    if requested == "fal":
        if not fal_key:
            raise LipSyncError("LIPSYNC_FAL_API_KEY_MISSING", status_code=400)
        return ResolvedLipSyncProvider(name="fal", api_key=fal_key)

    if requested == "sync":
        if not sync_key:
            raise LipSyncError("LIPSYNC_SYNC_API_KEY_MISSING", status_code=400)
        return ResolvedLipSyncProvider(name="sync", api_key=sync_key)

    if requested == "runway":
        if not fallback or not (fal_key or sync_key):
            raise LipSyncError(
                "Runway's official API has no dedicated lip-sync endpoint. Add a Fal or Sync.so key.",
                status_code=400,
                code="RUNWAY_LIPSYNC_UNAVAILABLE",
            )
        if fal_key:
            return ResolvedLipSyncProvider(name="fal", api_key=fal_key, fallback_reason=RUNWAY_FALLBACK_REASON)
        return ResolvedLipSyncProvider(name="sync", api_key=sync_key, fallback_reason=RUNWAY_FALLBACK_REASON)

    if fal_key:
        return ResolvedLipSyncProvider(name="fal", api_key=fal_key)
    if sync_key:
        return ResolvedLipSyncProvider(name="sync", api_key=sync_key)
    if runway_key:
        raise LipSyncError(
            "Runway's official API has no dedicated lip-sync endpoint. Add a Fal or Sync.so key.",
            status_code=400,
            code="RUNWAY_LIPSYNC_UNAVAILABLE",
        )
    raise LipSyncError("LIPSYNC_API_KEY_MISSING", status_code=400)


def generate_lipsync(
    http: HTTPClient,
    *,
    keys: LipSyncKeys,
    audio_path: str,
    video_path: str = "",
    image_path: str = "",
    provider: LipSyncRequestedProvider = "auto",
    model: str = "",
    fallback: bool = True,
    max_media_bytes: int = DEFAULT_MAX_MEDIA_BYTES,
    poll_interval_s: float = DEFAULT_POLL_INTERVAL_S,
    poll_attempts: int = DEFAULT_POLL_ATTEMPTS,
) -> LipSyncJob:
    audio = audio_path.strip()
    video = video_path.strip()
    image = image_path.strip()
    if not audio:
        raise LipSyncError("LIPSYNC_AUDIO_MISSING", status_code=400)
    if not video and not image:
        raise LipSyncError("LIPSYNC_VIDEO_MISSING", status_code=400)

    resolved = resolve_lipsync_provider(
        provider,
        keys,
        image_only=bool(image) and not video,
        fallback=fallback,
    )
    audio_url = media_url(audio, max_bytes=max_media_bytes)
    if resolved.name == "fal":
        if video:
            visual_url = media_url(video, max_bytes=max_media_bytes)
            endpoint = FAL_LIPSYNC_VIDEO_ENDPOINT
            payload: dict[str, JSONValue] = {"video_url": visual_url, "audio_url": audio_url}
        else:
            visual_url = media_url(image, max_bytes=max_media_bytes)
            endpoint = FAL_LIPSYNC_IMAGE_ENDPOINT
            payload = {"image_url": visual_url, "audio_url": audio_url}
        video_bytes = _fal_lipsync(
            http,
            api_key=resolved.api_key,
            endpoint=endpoint,
            payload=payload,
            poll_interval_s=poll_interval_s,
            poll_attempts=poll_attempts,
        )
        return LipSyncJob(
            video=video_bytes,
            provider="fal",
            model="fal-ai/sync-lipsync/v3",
            fallback_reason=resolved.fallback_reason,
        )

    if image and not video:
        raise LipSyncError("LIPSYNC_IMAGE_TO_VIDEO_REQUIRES_FAL", status_code=400)
    video_url = media_url(video, max_bytes=max_media_bytes)
    sync_model = model.strip() or DEFAULT_SYNC_MODEL
    video_bytes = _sync_so_lipsync(
        http,
        api_key=resolved.api_key,
        video_url=video_url,
        audio_url=audio_url,
        model=sync_model,
        poll_interval_s=poll_interval_s,
        poll_attempts=poll_attempts,
    )
    return LipSyncJob(
        video=video_bytes,
        provider="sync",
        model=sync_model,
        fallback_reason=resolved.fallback_reason,
    )


def media_url(path: str, *, max_bytes: int = DEFAULT_MAX_MEDIA_BYTES) -> str:
    trimmed = path.strip()
    if not trimmed:
        raise LipSyncError("LIPSYNC_MEDIA_MISSING", status_code=400)
    if trimmed.startswith(("http://", "https://", "data:")):
        return trimmed
    file_path = Path(trimmed)
    if not file_path.is_file():
        raise LipSyncError("LIPSYNC_FILE_NOT_FOUND", status_code=400)
    size = file_path.stat().st_size
    if size > max_bytes:
        raise LipSyncError("LIPSYNC_FILE_TOO_LARGE", status_code=400)
    mime = _mime_for_path(file_path)
    encoded = base64.b64encode(file_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _mime_for_path(path: Path) -> str:
    return _MIME_BY_SUFFIX.get(path.suffix.lower(), "application/octet-stream")


def _json_object(payload: object, *, context: str) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise LipSyncError(f"LIPSYNC_INVALID_{context.upper()}_JSON", status_code=502)
    return cast(dict[str, object], payload)


def _as_str(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _extract_video_url(payload: Mapping[str, object]) -> str | None:
    direct = _as_str(payload.get("video_url")) or _as_str(payload.get("outputUrl")) or _as_str(payload.get("output_url"))
    if direct:
        return direct
    video = payload.get("video")
    if isinstance(video, dict):
        url = _as_str(cast(dict[str, object], video).get("url"))
        if url:
            return url
    output = payload.get("output")
    if isinstance(output, dict):
        url = _as_str(cast(dict[str, object], output).get("url")) or _as_str(
            cast(dict[str, object], output).get("outputUrl")
        )
        if url:
            return url
    if isinstance(output, str) and output.startswith(("http://", "https://")):
        return output
    return None


def _download_video(http: HTTPClient, url: str) -> bytes:
    try:
        response = http.get(url, timeout=120)
    except HttpTransportError as exc:
        raise LipSyncError(f"LIPSYNC_TRANSPORT: {exc}", status_code=502) from exc
    if response.status_code >= 400:
        detail = response.text.strip() or f"HTTP_{response.status_code}"
        raise LipSyncError(detail, status_code=502)
    if not response.content:
        raise LipSyncError("LIPSYNC_EMPTY_VIDEO", status_code=502)
    return response.content


def _fal_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Key {api_key}",
        "Content-Type": "application/json",
    }


def _fal_lipsync(
    http: HTTPClient,
    *,
    api_key: str,
    endpoint: str,
    payload: dict[str, JSONValue],
    poll_interval_s: float,
    poll_attempts: int,
) -> bytes:
    url = f"{FAL_RUN_BASE}{endpoint}"
    try:
        response = http.post(url, headers=_fal_headers(api_key), json_payload=payload, timeout=300)
    except HttpTransportError as exc:
        raise LipSyncError(f"LIPSYNC_TRANSPORT: {exc}", status_code=502) from exc
    if response.status_code == 401:
        raise LipSyncError("LIPSYNC_FAL_API_KEY_INVALID", status_code=401)
    if response.status_code >= 400:
        detail = response.text.strip() or f"HTTP_{response.status_code}"
        raise LipSyncError(detail, status_code=502)

    body = _json_object(response.json(), context="fal_submit")
    video_url = _extract_video_url(body)
    if video_url:
        return _download_video(http, video_url)

    request_id = _as_str(body.get("request_id"))
    if not request_id:
        raise LipSyncError("LIPSYNC_FAL_NO_VIDEO", status_code=502)
    return _poll_fal_queue(
        http,
        api_key=api_key,
        endpoint=endpoint,
        request_id=request_id,
        poll_interval_s=poll_interval_s,
        poll_attempts=poll_attempts,
    )


def _poll_fal_queue(
    http: HTTPClient,
    *,
    api_key: str,
    endpoint: str,
    request_id: str,
    poll_interval_s: float,
    poll_attempts: int,
) -> bytes:
    status_url = f"https://queue.fal.run{endpoint}/requests/{request_id}/status"
    result_url = f"https://queue.fal.run{endpoint}/requests/{request_id}"
    for _ in range(max(1, poll_attempts)):
        try:
            status_response = http.get(status_url, headers=_fal_headers(api_key), timeout=60)
        except HttpTransportError as exc:
            raise LipSyncError(f"LIPSYNC_TRANSPORT: {exc}", status_code=502) from exc
        status_body = _json_object(status_response.json(), context="fal_status") if status_response.status_code < 400 else {}
        status = _as_str(status_body.get("status")) or ""
        if status.upper() in {"FAILED", "ERROR", "CANCELLED"}:
            detail = _as_str(status_body.get("error")) or "LIPSYNC_FAL_FAILED"
            raise LipSyncError(detail, status_code=502)
        if status.upper() in {"COMPLETED", "COMPLETE", "SUCCESS"}:
            try:
                result_response = http.get(result_url, headers=_fal_headers(api_key), timeout=60)
            except HttpTransportError as exc:
                raise LipSyncError(f"LIPSYNC_TRANSPORT: {exc}", status_code=502) from exc
            if result_response.status_code >= 400:
                detail = result_response.text.strip() or f"HTTP_{result_response.status_code}"
                raise LipSyncError(detail, status_code=502)
            result_body = _json_object(result_response.json(), context="fal_result")
            video_url = _extract_video_url(result_body)
            if not video_url:
                raise LipSyncError("LIPSYNC_FAL_NO_VIDEO", status_code=502)
            return _download_video(http, video_url)
        if poll_interval_s > 0:
            time.sleep(poll_interval_s)
    raise LipSyncError("LIPSYNC_FAL_TIMEOUT", status_code=504)


def _sync_so_lipsync(
    http: HTTPClient,
    *,
    api_key: str,
    video_url: str,
    audio_url: str,
    model: str,
    poll_interval_s: float,
    poll_attempts: int,
) -> bytes:
    headers = {
        "x-api-key": api_key,
        "Content-Type": "application/json",
    }
    payload: dict[str, JSONValue] = {
        "model": model,
        "input": [
            {"type": "video", "url": video_url},
            {"type": "audio", "url": audio_url},
        ],
    }
    try:
        response = http.post(SYNC_GENERATE_URL, headers=headers, json_payload=payload, timeout=60)
    except HttpTransportError as exc:
        raise LipSyncError(f"LIPSYNC_TRANSPORT: {exc}", status_code=502) from exc
    if response.status_code == 401:
        raise LipSyncError("LIPSYNC_SYNC_API_KEY_INVALID", status_code=401)
    if response.status_code >= 400:
        detail = response.text.strip() or f"HTTP_{response.status_code}"
        raise LipSyncError(detail, status_code=502)

    body = _json_object(response.json(), context="sync_submit")
    video_url_out = _extract_video_url(body)
    status = (_as_str(body.get("status")) or "").upper()
    if video_url_out and status in {"", "COMPLETED", "COMPLETE", "SUCCESS"}:
        return _download_video(http, video_url_out)

    job_id = _as_str(body.get("id"))
    if not job_id:
        raise LipSyncError("LIPSYNC_SYNC_NO_JOB", status_code=502)
    return _poll_sync_job(
        http,
        api_key=api_key,
        job_id=job_id,
        poll_interval_s=poll_interval_s,
        poll_attempts=poll_attempts,
    )


def _poll_sync_job(
    http: HTTPClient,
    *,
    api_key: str,
    job_id: str,
    poll_interval_s: float,
    poll_attempts: int,
) -> bytes:
    url = f"{SYNC_GENERATE_URL}/{job_id}"
    headers = {"x-api-key": api_key}
    for _ in range(max(1, poll_attempts)):
        try:
            response = http.get(url, headers=headers, timeout=60)
        except HttpTransportError as exc:
            raise LipSyncError(f"LIPSYNC_TRANSPORT: {exc}", status_code=502) from exc
        if response.status_code >= 400:
            detail = response.text.strip() or f"HTTP_{response.status_code}"
            raise LipSyncError(detail, status_code=502)
        body = _json_object(response.json(), context="sync_status")
        status = (_as_str(body.get("status")) or "").upper()
        if status in {"FAILED", "ERROR", "CANCELLED", "CANCELED"}:
            detail = _as_str(body.get("error")) or _as_str(body.get("message")) or "LIPSYNC_SYNC_FAILED"
            raise LipSyncError(detail, status_code=502)
        if status in {"COMPLETED", "COMPLETE", "SUCCESS"}:
            video_url = _extract_video_url(body)
            if not video_url:
                raise LipSyncError("LIPSYNC_SYNC_NO_VIDEO", status_code=502)
            return _download_video(http, video_url)
        if poll_interval_s > 0:
            time.sleep(poll_interval_s)
    raise LipSyncError("LIPSYNC_SYNC_TIMEOUT", status_code=504)
