from tests.fakes.services import FakeResponse


def test_speech_requires_key(client):
    response = client.post("/api/elevenlabs/speech", json={"text": "Hello from the stoop."})
    assert response.status_code == 400
    assert response.json()["code"] == "ELEVENLABS_API_KEY_MISSING"


def test_speech_writes_mp3(client, test_state):
    test_state.state.app_settings.elevenlabs_api_key = "sk_test_eleven"
    test_state.http.queue("post", FakeResponse(status_code=200, content=b"ID3fake-mp3"))
    response = client.post("/api/elevenlabs/speech", json={"text": "The paper boy waits."})
    assert response.status_code == 200
    body = response.json()
    assert body["path"].endswith(".mp3")
    assert test_state.http.calls[0].url.endswith("/21m00Tcm4TlvDq8ikWAM")
    assert (test_state.config.outputs_dir / body["path"].split("\\")[-1].split("/")[-1]).exists()


def test_empty_elevenlabs_key_does_not_erase(client, test_state):
    test_state.state.app_settings.elevenlabs_api_key = "keep-me"
    response = client.post("/api/settings", json={"elevenlabsApiKey": ""})
    assert response.status_code == 200
    assert test_state.state.app_settings.elevenlabs_api_key == "keep-me"
    listed = client.get("/api/settings")
    assert listed.json()["hasElevenLabsApiKey"] is True
