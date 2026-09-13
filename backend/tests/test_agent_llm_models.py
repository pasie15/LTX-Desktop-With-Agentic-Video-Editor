"""Agent LLM Settings model list: provider fetch plus catalog fallback."""

from __future__ import annotations

from api_types import AgentLlmModelOptionPayload
from services.agent_llm_models import catalog_model_options, merge_model_options
from state.app_settings import AgentLlmProviderSettings
from tests.fakes.services import FakeResponse


def test_catalog_lists_latest_first() -> None:
    openai = [model.id for model in catalog_model_options("openai")]
    anthropic = [model.id for model in catalog_model_options("anthropic")]
    assert openai[0] == "gpt-6-astra"
    assert "gpt-5.6-sol" in openai
    assert "gpt-4o" in openai
    assert anthropic[0] == "claude-fable-5-1"
    assert "claude-sonnet-5" in anthropic
    assert "claude-sonnet-4-5" in anthropic


def test_merge_keeps_fetched_ahead_of_catalog_and_includes_current() -> None:
    merged = merge_model_options(
        [AgentLlmModelOptionPayload(id="gpt-5.4", displayName="GPT-5.4")],
        catalog_model_options("openai"),
        "my-fine-tune",
    )
    ids = [model.id for model in merged]
    assert ids[0] == "gpt-5.4"
    assert ids.count("gpt-5.4") == 1
    assert ids[-1] == "my-fine-tune"


def test_catalog_without_key(client) -> None:
    response = client.post("/api/agent/llm/models", json={"kind": "openai"})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "catalog"
    assert body["models"][0]["id"] == "gpt-6-astra"
    assert body["resolvedModel"] == "gpt-5.6-sol"


def test_openai_fetch_uses_key_and_sorts_newest_first(client, test_state) -> None:
    test_state.http.queue(
        "get",
        FakeResponse(
            json_payload={
                "data": [
                    {"id": "gpt-4o", "created": 100},
                    {"id": "gpt-5.4", "created": 200},
                    {"id": "whisper-1", "created": 300},
                ]
            }
        ),
    )
    response = client.post(
        "/api/agent/llm/models",
        json={"kind": "openai", "apiKey": "sk-test", "model": "gpt-4o"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "provider"
    ids = [model["id"] for model in body["models"]]
    assert ids[:2] == ["gpt-5.4", "gpt-4o"]
    assert "whisper-1" not in ids
    assert [call.url for call in test_state.http.calls] == ["https://api.openai.com/v1/models"]
    assert test_state.http.calls[0].headers["Authorization"] == "Bearer sk-test"
    assert "chatgpt.com" not in test_state.http.calls[0].url


def test_saved_oauth_provider_uses_access_token(client, test_state) -> None:
    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(
            id="prov_ant",
            kind="anthropic",
            oauth_access_token="oauth-token",
            auth_mode="oauth",
            model="claude-sonnet-4-5",
        )
    ]
    test_state.http.queue(
        "get",
        FakeResponse(
            json_payload={
                "data": [
                    {
                        "id": "claude-opus-4-6",
                        "display_name": "Claude Opus 4.6",
                        "created_at": "2026-09-01T00:00:00Z",
                    },
                    {
                        "id": "claude-sonnet-4-5",
                        "display_name": "Claude Sonnet 4.5",
                        "created_at": "2025-09-01T00:00:00Z",
                    },
                ]
            }
        ),
    )
    response = client.post("/api/agent/llm/models", json={"providerId": "prov_ant"})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "provider"
    assert body["resolvedModel"] == "claude-sonnet-4-5"
    assert body["models"][0]["id"] == "claude-opus-4-6"
    assert test_state.http.calls[0].url == "https://api.anthropic.com/v1/models"
    assert test_state.http.calls[0].headers["Authorization"] == "Bearer oauth-token"


def test_provider_error_falls_back_to_catalog(client, test_state) -> None:
    test_state.http.queue("get", FakeResponse(status_code=401, text="nope"))
    response = client.post(
        "/api/agent/llm/models",
        json={"kind": "groq", "apiKey": "gsk-bad"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "catalog"
    assert body["error"]
    assert body["models"][0]["id"] == "openai/gpt-oss-120b"


def test_openai_oauth_sends_account_header(client, test_state) -> None:
    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(
            id="prov_oai",
            kind="openai",
            oauth_access_token="oauth-access",
            oauth_account_id="acct_9",
            auth_mode="oauth",
            model="gpt-4o",
        )
    ]
    test_state.http.queue(
        "get",
        FakeResponse(status_code=404, text="nope"),
        FakeResponse(json_payload={"data": [{"id": "gpt-5.4", "created": 200}, {"id": "gpt-4o", "created": 100}]}),
    )
    response = client.post("/api/agent/llm/models", json={"providerId": "prov_oai"})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "provider"
    assert body["models"][0]["id"] == "gpt-5.4"
    assert test_state.http.calls[0].url == "https://chatgpt.com/backend-api/codex/models"
    assert test_state.http.calls[1].url == "https://api.openai.com/v1/models"
    assert test_state.http.calls[1].headers["chatgpt-account-id"] == "acct_9"


def test_openrouter_fetches_public_catalog_without_key(client, test_state) -> None:
    test_state.http.queue(
        "get",
        FakeResponse(
            json_payload={
                "data": [
                    {"id": "openai/gpt-6-astra", "name": "GPT-6 Astra", "created": 300},
                    {"id": "anthropic/claude-sonnet-5", "name": "Claude Sonnet 5", "created": 200},
                ]
            }
        ),
    )
    response = client.post("/api/agent/llm/models", json={"kind": "openrouter"})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "provider"
    assert body["models"][0]["id"] == "openai/gpt-6-astra"
    assert test_state.http.calls[0].url == "https://openrouter.ai/api/v1/models"


def test_openai_connect_parses_slug(client, test_state) -> None:
    from services.agent_llm_models import _model_id

    assert _model_id({"id": "internal-row-1", "slug": "gpt-5.4"}) == "gpt-5.4"

    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(
            id="prov_oai",
            kind="openai",
            oauth_access_token="oauth-access",
            oauth_account_id="acct_9",
            auth_mode="oauth",
            model="gpt-5.4",
        )
    ]
    test_state.http.queue(
        "get",
        FakeResponse(
            json_payload={
                "data": [
                    {
                        "id": "internal-row-1",
                        "slug": "gpt-5.4",
                        "display_name": "GPT-5.4",
                        "created": 200,
                    },
                    {
                        "id": "internal-row-2",
                        "slug": "gpt-4o",
                        "name": "GPT-4o",
                        "created": 100,
                    },
                ]
            }
        ),
    )
    response = client.post("/api/agent/llm/models", json={"providerId": "prov_oai"})
    assert response.status_code == 200
    ids = [model["id"] for model in response.json()["models"]]
    assert ids[0] == "gpt-5.4"
    assert "gpt-4o" in ids
    assert "internal-row-1" not in ids
    assert test_state.http.calls[0].url == "https://chatgpt.com/backend-api/codex/models"


def test_unknown_provider_id(client) -> None:
    response = client.post("/api/agent/llm/models", json={"providerId": "missing"})
    assert response.status_code == 400
    assert response.json()["code"] == "AGENT_LLM_PROVIDER_INVALID"
