"""Integration tests for Agent LLM Connect / OAuth. Tokens come from FakeHTTP only."""

from __future__ import annotations

import base64
import json

from tests.fakes.services import FakeResponse


def _jwt(payload: dict[str, object]) -> str:
    def encode(value: dict[str, object]) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return f"{encode({'alg': 'none', 'typ': 'JWT'})}.{encode(payload)}."


def test_oauth_unsupported_kind(client) -> None:
    response = client.post("/api/agent/llm/oauth/start", json={"kind": "groq"})
    assert response.status_code == 400
    assert response.json()["code"] == "AGENT_LLM_OAUTH_UNSUPPORTED"


def test_openai_device_connect(client, test_state) -> None:
    test_state.http.queue(
        "post",
        FakeResponse(
            json_payload={"device_auth_id": "dev_1", "user_code": "ABCD-EFGH", "interval": 1, "expires_in": 600}
        ),
    )
    start = client.post("/api/agent/llm/oauth/start", json={"kind": "openai"})
    assert start.status_code == 200
    body = start.json()
    assert body["flow"] == "device"
    assert body["authorizeUrl"] == "https://auth.openai.com/codex/device"
    assert body["userCode"] == "ABCD-EFGH"
    assert test_state.http.calls[0].url == "https://auth.openai.com/api/accounts/deviceauth/usercode"

    test_state.http.queue("post", FakeResponse(status_code=403, json_payload={"error": "authorization_pending"}))
    pending = client.post("/api/agent/llm/oauth/poll", json={"sessionId": body["sessionId"]})
    assert pending.status_code == 200
    assert pending.json()["status"] == "pending"

    id_token = _jwt({"email": "user@example.com", "https://api.openai.com/auth": {"chatgpt_account_id": "acct_9"}})
    test_state.http.queue(
        "post",
        FakeResponse(json_payload={"authorization_code": "auth-code", "code_verifier": "verifier-1"}),
        FakeResponse(
            json_payload={
                "access_token": id_token,
                "refresh_token": "rt_1",
                "expires_in": 3600,
                "id_token": id_token,
            }
        ),
    )
    done = client.post("/api/agent/llm/oauth/poll", json={"sessionId": body["sessionId"]})
    assert done.status_code == 200
    payload = done.json()
    assert payload["status"] == "authenticated"
    provider_id = payload["providerId"]
    stored = test_state.state.app_settings.agent_llm_providers[0]
    assert stored.id == provider_id
    assert stored.kind == "openai"
    assert stored.oauth_access_token == id_token
    assert stored.oauth_refresh_token == "rt_1"
    assert stored.oauth_account_id == "acct_9"
    assert stored.auth_mode == "oauth"
    public = client.get("/api/settings").json()
    assert public["hasAgentLlmKey"] is True
    assert public["agentLlmProviders"][0]["hasOAuth"] is True
    assert "rt_1" not in str(public)
    assert public["agentLlmProviders"][0].get("oauthAccessToken") is None


def test_anthropic_code_connect(client, test_state) -> None:
    start = client.post("/api/agent/llm/oauth/start", json={"kind": "anthropic"})
    assert start.status_code == 200
    body = start.json()
    assert body["flow"] == "code"
    assert body["authorizeUrl"].startswith("https://claude.ai/oauth/authorize")
    assert "client_id=" in body["authorizeUrl"]
    pending = test_state.state.agent_llm_oauth_pending
    assert pending is not None

    test_state.http.queue(
        "post",
        FakeResponse(json_payload={"access_token": "sk-ant-oauth", "refresh_token": "rt-ant", "expires_in": 3600}),
    )
    done = client.post(
        "/api/agent/llm/oauth/complete",
        json={"sessionId": body["sessionId"], "code": f"pasted-code#{pending.state}"},
    )
    assert done.status_code == 200
    assert done.json()["status"] == "authenticated"
    stored = test_state.state.app_settings.agent_llm_providers[0]
    assert stored.kind == "anthropic"
    assert stored.oauth_access_token == "sk-ant-oauth"
    exchange = test_state.http.calls[-1]
    assert exchange.url == "https://console.anthropic.com/v1/oauth/token"
    sent = exchange.json_payload
    assert sent is not None
    assert sent["code"] == "pasted-code"
    assert sent["code_verifier"] == pending.state


def test_minimax_xai_kimi_device_connect(client, test_state) -> None:
    test_state.http.queue(
        "post",
        FakeResponse(
            json_payload={
                "user_code": "123456",
                "verification_uri": "https://www.minimax.io/oauth-authorize?user_code=123456",
                "expires_in": 600,
            }
        ),
    )
    start = client.post("/api/agent/llm/oauth/start", json={"kind": "minimax"})
    assert start.status_code == 200
    assert start.json()["authorizeUrl"].startswith("https://platform.minimax.io/oauth-authorize")

    test_state.http.queue(
        "post",
        FakeResponse(json_payload={"access_token": "mm-token", "refresh_token": "mm-ref", "expires_in": 3600}),
    )
    done = client.post("/api/agent/llm/oauth/poll", json={"sessionId": start.json()["sessionId"]})
    assert done.status_code == 200
    assert done.json()["status"] == "authenticated"
    assert test_state.state.app_settings.agent_llm_providers[-1].kind == "minimax"

    test_state.http.queue(
        "post",
        FakeResponse(
            json_payload={
                "device_code": "x-dev",
                "user_code": "XAI-1",
                "verification_uri_complete": "https://auth.x.ai/activate?code=XAI-1",
                "expires_in": 600,
            }
        ),
        FakeResponse(json_payload={"access_token": "xai-token", "refresh_token": "xai-ref", "expires_in": 3600}),
    )
    xai = client.post("/api/agent/llm/oauth/start", json={"kind": "xai"})
    assert xai.status_code == 200
    assert xai.json()["authorizeUrl"] == "https://auth.x.ai/activate?code=XAI-1"
    xai_done = client.post("/api/agent/llm/oauth/poll", json={"sessionId": xai.json()["sessionId"]})
    assert xai_done.status_code == 200
    assert xai_done.json()["status"] == "authenticated"

    test_state.http.queue(
        "post",
        FakeResponse(
            json_payload={
                "device_code": "k-dev",
                "user_code": "KIMI-1",
                "verification_uri_complete": "https://auth.kimi.com/device?code=KIMI-1",
                "expires_in": 600,
            }
        ),
        FakeResponse(json_payload={"access_token": "kimi-token", "refresh_token": "kimi-ref", "expires_in": 900}),
    )
    kimi = client.post("/api/agent/llm/oauth/start", json={"kind": "moonshot"})
    assert kimi.status_code == 200
    kimi_done = client.post("/api/agent/llm/oauth/poll", json={"sessionId": kimi.json()["sessionId"]})
    assert kimi_done.status_code == 200
    kinds = {provider.kind for provider in test_state.state.app_settings.agent_llm_providers}
    assert kinds >= {"minimax", "xai", "moonshot"}


def test_oauth_cancel_and_disconnect(client, test_state) -> None:
    start = client.post("/api/agent/llm/oauth/start", json={"kind": "anthropic"})
    assert start.status_code == 200
    cancel = client.post("/api/agent/llm/oauth/cancel", json={"sessionId": start.json()["sessionId"]})
    assert cancel.status_code == 200
    assert test_state.state.agent_llm_oauth_pending is None

    from state.app_settings import AgentLlmProviderSettings

    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(
            id="prov_oai",
            kind="openai",
            oauth_access_token="tok",
            oauth_refresh_token="ref",
            auth_mode="oauth",
        )
    ]
    gone = client.post("/api/agent/llm/oauth/disconnect", json={"providerId": "prov_oai"})
    assert gone.status_code == 200
    stored = test_state.state.app_settings.agent_llm_providers[0]
    assert stored.oauth_access_token == ""
    assert stored.auth_mode == "api_key"


def test_openai_oauth_turn_uses_codex_responses(client, test_state) -> None:
    from state.app_settings import AgentLlmProviderSettings

    test_state.state.app_settings.agent_llm_provider_id = "prov_oai"
    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(
            id="prov_oai",
            kind="openai",
            oauth_access_token="oauth-tok",
            oauth_account_id="acct_1",
            auth_mode="oauth",
            model="gpt-4o",
        )
    ]
    test_state.http.queue(
        "post",
        FakeResponse(
            status_code=200,
            text=(
                "event: response.output_text.delta\n"
                'data: {"type":"response.output_text.delta","delta":"Connected."}\n\n'
                "event: response.completed\n"
                'data: {"type":"response.completed"}\n\n'
            ),
        ),
    )
    response = client.post(
        "/api/agent/turn",
        json={
            "messages": [{"role": "user", "parts": [{"type": "text", "text": "Hi"}]}],
            "projectContext": {"name": "Demo"},
            "availableTools": [],
        },
    )
    assert response.status_code == 200
    assert response.json()["text"] == "Connected."
    call = test_state.http.calls[-1]
    assert call.url.startswith("https://chatgpt.com/backend-api/codex/responses")
    assert call.headers is not None
    assert call.headers["Authorization"] == "Bearer oauth-tok"
    assert call.headers["chatgpt-account-id"] == "acct_1"
    sent = call.json_payload
    assert sent is not None
    assert sent["stream"] is True
    assert sent["store"] is False


def test_anthropic_oauth_turn_uses_bearer(client, test_state) -> None:
    from state.app_settings import AgentLlmProviderSettings

    test_state.state.app_settings.agent_llm_provider_id = "prov_ant"
    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(
            id="prov_ant",
            kind="anthropic",
            oauth_access_token="oauth-ant",
            auth_mode="oauth",
            model="claude-sonnet-4-5",
        )
    ]
    test_state.http.queue(
        "post",
        FakeResponse(json_payload={"content": [{"type": "text", "text": "Hello from Claude."}]}),
    )
    response = client.post(
        "/api/agent/turn",
        json={
            "messages": [{"role": "user", "parts": [{"type": "text", "text": "Hi"}]}],
            "projectContext": {},
            "availableTools": [],
        },
    )
    assert response.status_code == 200
    assert response.json()["text"] == "Hello from Claude."
    call = test_state.http.calls[-1]
    assert call.headers is not None
    assert call.headers["Authorization"] == "Bearer oauth-ant"
    assert call.headers["anthropic-beta"] == "oauth-2025-04-20"
    assert "x-api-key" not in call.headers
