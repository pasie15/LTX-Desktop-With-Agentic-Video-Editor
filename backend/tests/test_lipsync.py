from pathlib import Path

from tests.fakes.services import FakeResponse


def _write_media(path: Path, payload: bytes = b"media") -> str:
    path.write_bytes(payload)
    return str(path)


def test_lipsync_requires_key(client):
    response = client.post("/api/lipsync", json={"videoPath": "/tmp/a.mp4", "audioPath": "/tmp/b.mp3"})
    assert response.status_code == 400
    assert response.json()["code"] == "LIPSYNC_API_KEY_MISSING"


def test_fal_lipsync_writes_mp4(client, test_state, tmp_path):
    video = _write_media(tmp_path / "in.mp4", b"fake-video")
    audio = _write_media(tmp_path / "line.mp3", b"fake-audio")
    test_state.state.app_settings.fal_api_key = "fal-test-key"
    test_state.http.queue(
        "post",
        FakeResponse(status_code=200, json_payload={"video": {"url": "https://fal.media/out.mp4"}}),
    )
    test_state.http.queue("get", FakeResponse(status_code=200, content=b"ftypfake-mp4"))
    response = client.post("/api/lipsync", json={"videoPath": video, "audioPath": audio})
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "fal"
    assert body["model"] == "fal-ai/sync-lipsync/v3"
    assert body["fallbackReason"] == ""
    assert body["path"].endswith(".mp4")
    assert test_state.http.calls[0].url.endswith("/fal-ai/sync-lipsync/v3")
    assert test_state.http.calls[0].headers["Authorization"] == "Key fal-test-key"
    assert "video_url" in (test_state.http.calls[0].json_payload or {})
    assert "audio_url" in (test_state.http.calls[0].json_payload or {})
    written = Path(body["path"])
    assert written.exists()
    assert written.read_bytes() == b"ftypfake-mp4"


def test_sync_so_lipsync_writes_mp4(client, test_state, tmp_path):
    video = _write_media(tmp_path / "in.mp4")
    audio = _write_media(tmp_path / "line.mp3")
    test_state.state.app_settings.sync_api_key = "sync-test-key"
    test_state.http.queue(
        "post",
        FakeResponse(
            status_code=200,
            json_payload={"id": "job-1", "status": "COMPLETED", "outputUrl": "https://cdn.sync.so/out.mp4"},
        ),
    )
    test_state.http.queue("get", FakeResponse(status_code=200, content=b"sync-bytes"))
    response = client.post(
        "/api/lipsync",
        json={"videoPath": video, "audioPath": audio, "provider": "sync"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "sync"
    assert body["model"] == "lipsync-2"
    assert test_state.http.calls[0].url == "https://api.sync.so/v2/generate"
    assert test_state.http.calls[0].headers["x-api-key"] == "sync-test-key"
    assert Path(body["path"]).read_bytes() == b"sync-bytes"


def test_auto_prefers_fal_when_both_keys_exist(client, test_state, tmp_path):
    video = _write_media(tmp_path / "in.mp4")
    audio = _write_media(tmp_path / "line.mp3")
    test_state.state.app_settings.fal_api_key = "fal-key"
    test_state.state.app_settings.sync_api_key = "sync-key"
    test_state.http.queue(
        "post",
        FakeResponse(status_code=200, json_payload={"video": {"url": "https://fal.media/out.mp4"}}),
    )
    test_state.http.queue("get", FakeResponse(status_code=200, content=b"out"))
    response = client.post("/api/lipsync", json={"videoPath": video, "audioPath": audio})
    assert response.status_code == 200
    assert response.json()["provider"] == "fal"


def test_runway_falls_back_to_fal(client, test_state, tmp_path):
    video = _write_media(tmp_path / "in.mp4")
    audio = _write_media(tmp_path / "line.mp3")
    test_state.state.app_settings.runway_api_key = "rw-key"
    test_state.state.app_settings.fal_api_key = "fal-key"
    test_state.http.queue(
        "post",
        FakeResponse(status_code=200, json_payload={"video": {"url": "https://fal.media/out.mp4"}}),
    )
    test_state.http.queue("get", FakeResponse(status_code=200, content=b"out"))
    response = client.post(
        "/api/lipsync",
        json={"videoPath": video, "audioPath": audio, "provider": "runway"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "fal"
    assert "no dedicated lip-sync" in body["fallbackReason"]


def test_runway_only_is_unavailable(client, test_state, tmp_path):
    video = _write_media(tmp_path / "in.mp4")
    audio = _write_media(tmp_path / "line.mp3")
    test_state.state.app_settings.runway_api_key = "rw-key"
    response = client.post(
        "/api/lipsync",
        json={"videoPath": video, "audioPath": audio, "provider": "runway", "fallback": False},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "RUNWAY_LIPSYNC_UNAVAILABLE"


def test_fal_image_to_video(client, test_state, tmp_path):
    image = _write_media(tmp_path / "face.png", b"png")
    audio = _write_media(tmp_path / "line.mp3")
    test_state.state.app_settings.fal_api_key = "fal-key"
    test_state.http.queue(
        "post",
        FakeResponse(status_code=200, json_payload={"video": {"url": "https://fal.media/out.mp4"}}),
    )
    test_state.http.queue("get", FakeResponse(status_code=200, content=b"talking"))
    response = client.post("/api/lipsync", json={"imagePath": image, "audioPath": audio})
    assert response.status_code == 200
    assert test_state.http.calls[0].url.endswith("/fal-ai/sync-lipsync/v3/image-to-video")
    assert "image_url" in (test_state.http.calls[0].json_payload or {})


def test_missing_file(client, test_state):
    test_state.state.app_settings.fal_api_key = "fal-key"
    response = client.post(
        "/api/lipsync",
        json={"videoPath": "/tmp/does-not-exist-lipsync.mp4", "audioPath": "/tmp/also-missing.mp3"},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "LIPSYNC_FILE_NOT_FOUND"


def test_empty_sync_and_runway_keys_do_not_erase(client, test_state):
    test_state.state.app_settings.sync_api_key = "keep-sync"
    test_state.state.app_settings.runway_api_key = "keep-runway"
    response = client.post("/api/settings", json={"syncApiKey": "", "runwayApiKey": ""})
    assert response.status_code == 200
    assert test_state.state.app_settings.sync_api_key == "keep-sync"
    assert test_state.state.app_settings.runway_api_key == "keep-runway"
    listed = client.get("/api/settings")
    assert listed.json()["hasSyncApiKey"] is True
    assert listed.json()["hasRunwayApiKey"] is True
