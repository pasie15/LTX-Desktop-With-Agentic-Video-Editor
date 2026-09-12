"""Integration tests for POST /api/agent/turn."""

from __future__ import annotations

from services.gemini_text_client import DEFAULT_GEMINI_MODEL
from tests.fakes.services import FakeResponse

_GET_TIMELINE_TOOL = {
    "name": "get_timeline",
    "description": "Read the active timeline",
    "parameters": {"type": "object", "properties": {}},
}
_ASK_USER_TOOL = {
    "name": "ask_user",
    "description": "Ask a blocking production choice",
    "parameters": {
        "type": "object",
        "properties": {
            "questions": {"type": "array"},
        },
        "required": ["questions"],
    },
}


def _turn_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "messages": [{"role": "user", "parts": [{"type": "text", "text": "What's on the timeline?"}]}],
        "projectContext": {
            "project": {"id": "p1", "name": "Demo"},
            "activeTimeline": {"id": "tl1", "name": "Timeline 1", "duration": 8, "clipCount": 2},
        },
        "availableTools": [_GET_TIMELINE_TOOL, _ASK_USER_TOOL],
        "skills": "Answer from the snapshot. Read-only.",
    }
    body.update(overrides)
    return body


def _gemini_text(text: str) -> FakeResponse:
    return FakeResponse(
        status_code=200,
        json_payload={"candidates": [{"content": {"parts": [{"text": text}]}}]},
    )


def _gemini_function_call(name: str, args: dict[str, object], text: str = "") -> FakeResponse:
    parts: list[dict[str, object]] = []
    if text:
        parts.append({"text": text})
    parts.append({"functionCall": {"name": name, "args": args}})
    return FakeResponse(
        status_code=200,
        json_payload={"candidates": [{"content": {"parts": parts}}]},
    )


def test_missing_gemini_key_returns_400(client):
    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 400
    assert response.json()["code"] == "GEMINI_API_KEY_MISSING"


def test_empty_messages_rejected(client, test_state):
    test_state.state.app_settings.gemini_api_key = "key"
    response = client.post("/api/agent/turn", json=_turn_body(messages=[]))
    assert response.status_code == 422


def test_text_turn_uses_snapshot_and_skills(client, test_state):
    test_state.state.app_settings.gemini_api_key = "key"
    test_state.state.app_settings.gemini_model = ""
    test_state.http.queue("post", _gemini_text("Two clips on V1, 8s total."))

    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["text"] == "Two clips on V1, 8s total."
    assert payload["finishReason"] == "stop"
    assert payload["toolCalls"] == []
    assert payload["askUser"] is None

    call = test_state.http.calls[-1]
    assert f"models/{DEFAULT_GEMINI_MODEL}:generateContent" in call.url
    sent = call.json_payload
    assert sent is not None
    system_text = sent["systemInstruction"]["parts"][0]["text"]
    assert "Answer from the snapshot" in system_text
    assert '"name":"Demo"' in system_text
    assert sent["contents"][0]["role"] == "user"
    declarations = sent["tools"][0]["functionDeclarations"]
    assert {item["name"] for item in declarations} == {"get_timeline", "ask_user"}


def test_function_call_turn(client, test_state):
    test_state.state.app_settings.gemini_api_key = "key"
    test_state.http.queue("post", _gemini_function_call("get_timeline", {"start": 0, "end": 12}))

    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["finishReason"] == "tool_calls"
    assert len(payload["toolCalls"]) == 1
    assert payload["toolCalls"][0]["name"] == "get_timeline"
    assert payload["toolCalls"][0]["arguments"] == {"start": 0, "end": 12}
    assert payload["toolCalls"][0]["id"].startswith("call_")


def test_unknown_tool_is_dropped(client, test_state):
    test_state.state.app_settings.gemini_api_key = "key"
    test_state.http.queue("post", _gemini_function_call("delete_clips", {"ids": ["c1"]}))

    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["finishReason"] == "stop"
    assert payload["toolCalls"] == []


def test_ask_user_turn(client, test_state):
    test_state.state.app_settings.gemini_api_key = "key"
    test_state.http.queue(
        "post",
        _gemini_function_call(
            "ask_user",
            {
                "questions": [
                    {
                        "id": "duration",
                        "prompt": "How long should the preview be?",
                        "kind": "choice",
                        "options": ["4s", "8s"],
                    }
                ]
            },
            text="Need a duration.",
        ),
    )

    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["finishReason"] == "ask_user"
    assert payload["text"] == "Need a duration."
    assert payload["toolCalls"] == []
    assert payload["askUser"] == [
        {
            "id": "duration",
            "prompt": "How long should the preview be?",
            "kind": "choice",
            "options": ["4s", "8s"],
            "allowMultiple": False,
        }
    ]


def test_tool_history_is_converted_for_gemini(client, test_state):
    test_state.state.app_settings.gemini_api_key = "key"
    test_state.http.queue("post", _gemini_text("V1 has one clip."))
    body = _turn_body(
        messages=[
            {"role": "user", "parts": [{"type": "text", "text": "What's on V1?"}]},
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool_call",
                        "toolCallId": "call_1",
                        "toolName": "get_timeline",
                        "arguments": {},
                    }
                ],
            },
            {
                "role": "tool",
                "parts": [
                    {
                        "type": "tool_result",
                        "toolCallId": "call_1",
                        "toolName": "get_timeline",
                        "result": {"clipCount": 1},
                    }
                ],
            },
        ]
    )

    response = client.post("/api/agent/turn", json=body)
    assert response.status_code == 200
    sent = test_state.http.calls[-1].json_payload
    assert sent is not None
    assert sent["contents"][1]["role"] == "model"
    assert sent["contents"][1]["parts"][0]["functionCall"]["name"] == "get_timeline"
    assert sent["contents"][2]["role"] == "user"
    assert sent["contents"][2]["parts"][0]["functionResponse"]["response"]["clipCount"] == 1


def test_invalid_api_key(client, test_state):
    test_state.state.app_settings.gemini_api_key = "bad"
    test_state.http.queue(
        "post",
        FakeResponse(
            status_code=400,
            json_payload={
                "error": {
                    "code": 400,
                    "message": "API key not valid.",
                    "status": "INVALID_ARGUMENT",
                    "details": [{"reason": "API_KEY_INVALID"}],
                }
            },
        ),
    )
    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 400
    assert response.json()["code"] == "GEMINI_INVALID_API_KEY"


def test_openai_provider_turn(client, test_state):
    from state.app_settings import AgentLlmProviderSettings

    test_state.state.app_settings.gemini_api_key = "unused-gemini"
    test_state.state.app_settings.agent_llm_provider_id = "prov_oai"
    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(id="prov_oai", kind="openai", api_key="sk-test", model="gpt-4o"),
    ]
    test_state.http.queue(
        "post",
        FakeResponse(
            status_code=200,
            json_payload={
                "choices": [
                    {
                        "message": {
                            "content": "Two clips on V1.",
                        }
                    }
                ]
            },
        ),
    )

    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["text"] == "Two clips on V1."
    assert payload["finishReason"] == "stop"

    call = test_state.http.calls[-1]
    assert call.url == "https://api.openai.com/v1/chat/completions"
    assert call.headers is not None
    assert call.headers["Authorization"] == "Bearer sk-test"
    sent = call.json_payload
    assert sent is not None
    assert sent["model"] == "gpt-4o"
    assert sent["messages"][0]["role"] == "system"
    assert "Answer from the snapshot" in sent["messages"][0]["content"]
    assert sent["tools"][0]["function"]["name"] in {"get_timeline", "ask_user"}


def test_anthropic_provider_tool_turn(client, test_state):
    from state.app_settings import AgentLlmProviderSettings

    test_state.state.app_settings.agent_llm_provider_id = "prov_ant"
    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(
            id="prov_ant",
            kind="anthropic",
            api_key="ant-key",
            model="claude-sonnet-4-5",
        ),
    ]
    test_state.http.queue(
        "post",
        FakeResponse(
            status_code=200,
            json_payload={
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_abc",
                        "name": "get_timeline",
                        "input": {"start": 0, "end": 8},
                    }
                ]
            },
        ),
    )

    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["finishReason"] == "tool_calls"
    assert payload["toolCalls"][0]["id"] == "toolu_abc"
    assert payload["toolCalls"][0]["name"] == "get_timeline"
    assert payload["toolCalls"][0]["arguments"] == {"start": 0, "end": 8}

    call = test_state.http.calls[-1]
    assert call.url == "https://api.anthropic.com/v1/messages"
    assert call.headers is not None
    assert call.headers["x-api-key"] == "ant-key"
    sent = call.json_payload
    assert sent is not None
    assert sent["model"] == "claude-sonnet-4-5"
    assert sent["tools"][0]["name"] in {"get_timeline", "ask_user"}


def test_selected_provider_missing_key_returns_400(client, test_state):
    from state.app_settings import AgentLlmProviderSettings

    test_state.state.app_settings.gemini_api_key = "g-key"
    test_state.state.app_settings.agent_llm_provider_id = "prov_oai"
    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(id="prov_oai", kind="openai", api_key="", model="gpt-4o"),
    ]
    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 400
    assert response.json()["code"] == "AGENT_LLM_KEY_MISSING"


def test_openai_invalid_api_key(client, test_state):
    from state.app_settings import AgentLlmProviderSettings

    test_state.state.app_settings.agent_llm_provider_id = "prov_oai"
    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(id="prov_oai", kind="openai", api_key="bad", model="gpt-4o"),
    ]
    test_state.http.queue(
        "post",
        FakeResponse(
            status_code=401,
            json_payload={"error": {"message": "Incorrect API key", "type": "invalid_request_error"}},
        ),
    )
    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 401
    assert response.json()["code"] == "AGENT_LLM_INVALID_API_KEY"


def test_openrouter_uses_catalog_base_url(client, test_state):
    from state.app_settings import AgentLlmProviderSettings

    test_state.state.app_settings.agent_llm_provider_id = "prov_or"
    test_state.state.app_settings.agent_llm_providers = [
        AgentLlmProviderSettings(id="prov_or", kind="openrouter", api_key="or-key", model="openai/gpt-4o"),
    ]
    test_state.http.queue("post", FakeResponse(status_code=200, json_payload={"choices": [{"message": {"content": "ok"}}]}))
    response = client.post("/api/agent/turn", json=_turn_body())
    assert response.status_code == 200
    call = test_state.http.calls[-1]
    assert call.url == "https://openrouter.ai/api/v1/chat/completions"
    assert call.headers is not None
    assert call.headers["X-Title"] == "LTX Desktop"
