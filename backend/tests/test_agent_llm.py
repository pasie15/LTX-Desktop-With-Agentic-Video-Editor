"""Unit tests for Agent LLM provider resolution and message adapters."""

from __future__ import annotations

import pytest

from api_types import AgentMessagePayload, AgentToolDeclarationPayload
from _routes._errors import HTTPError
from services.agent_llm import (
    AGENT_LLM_CATALOG,
    bind_agent_tool_call_ids,
    resolve_agent_llm,
    merge_agent_llm_providers,
)
from services.codex_responses_client import responses_input_from_agent
from services.anthropic_messages_client import (
    anthropic_messages_from_agent,
    anthropic_messages_url,
    anthropic_tools_from_declarations,
    parse_anthropic_turn_payload,
)
from services.openai_compatible_chat import (
    openai_chat_completions_url,
    openai_messages_from_agent,
    openai_tools_from_declarations,
    parse_openai_turn_payload,
)
from state.app_settings import (
    AgentLlmProviderSettings,
    AppSettings,
    has_usable_agent_llm_key,
    to_settings_response,
)


def test_catalog_covers_requested_providers() -> None:
    kinds = {entry.kind for entry in AGENT_LLM_CATALOG}
    assert kinds >= {
        "gemini",
        "openai",
        "anthropic",
        "openrouter",
        "zai",
        "minimax",
        "moonshot",
        "xai",
        "custom_openai",
        "custom_anthropic",
    }


def test_builtin_gemini_when_no_provider_selected() -> None:
    settings = AppSettings(gemini_api_key="g-key", gemini_model="gemini-2.0-flash")
    resolved = resolve_agent_llm(settings)
    assert resolved.kind == "gemini"
    assert resolved.api_kind == "gemini"
    assert resolved.api_key == "g-key"
    assert resolved.model == "gemini-2.0-flash"
    assert has_usable_agent_llm_key(settings) is True


def test_oauth_openai_uses_codex_not_api_key() -> None:
    settings = AppSettings(
        agent_llm_provider_id="prov_oai",
        agent_llm_providers=[
            AgentLlmProviderSettings(
                id="prov_oai",
                kind="openai",
                api_key="sk-fallback",
                oauth_access_token="oauth-access",
                oauth_account_id="acct_1",
                auth_mode="oauth",
                model="gpt-4o",
            )
        ],
    )
    resolved = resolve_agent_llm(settings)
    assert resolved.auth_mode == "oauth"
    assert resolved.api_key == "oauth-access"
    assert resolved.oauth_account_id == "acct_1"
    assert resolved.base_url == "https://chatgpt.com/backend-api/codex"
    assert has_usable_agent_llm_key(settings) is True


def test_selected_openai_provider() -> None:
    settings = AppSettings(
        gemini_api_key="g-key",
        agent_llm_provider_id="prov_oai",
        agent_llm_providers=[
            AgentLlmProviderSettings(id="prov_oai", kind="openai", api_key="sk-test", model="gpt-4o"),
        ],
    )
    resolved = resolve_agent_llm(settings)
    assert resolved.kind == "openai"
    assert resolved.api_kind == "openai"
    assert resolved.api_key == "sk-test"
    assert resolved.model == "gpt-4o"
    assert resolved.base_url == "https://api.openai.com/v1"
    assert has_usable_agent_llm_key(settings) is True


def test_gemini_provider_reuses_settings_key() -> None:
    settings = AppSettings(
        gemini_api_key="shared-gemini",
        agent_llm_provider_id="prov_g",
        agent_llm_providers=[AgentLlmProviderSettings(id="prov_g", kind="gemini", model="gemini-2.5-flash")],
    )
    resolved = resolve_agent_llm(settings)
    assert resolved.api_key == "shared-gemini"
    assert resolved.model == "gemini-2.5-flash"


def test_custom_openai_requires_base_and_model() -> None:
    settings = AppSettings(
        agent_llm_provider_id="prov_c",
        agent_llm_providers=[
            AgentLlmProviderSettings(id="prov_c", kind="custom_openai", api_key="k", model="", base_url=""),
        ],
    )
    assert has_usable_agent_llm_key(settings) is False
    with pytest.raises(HTTPError) as exc_info:
        resolve_agent_llm(settings)
    assert exc_info.value.code == "AGENT_LLM_PROVIDER_INVALID"


def test_stale_selected_id_falls_back_to_gemini() -> None:
    settings = AppSettings(
        gemini_api_key="g-key",
        agent_llm_provider_id="missing",
        agent_llm_providers=[],
    )
    resolved = resolve_agent_llm(settings)
    assert resolved.kind == "gemini"
    assert resolved.api_key == "g-key"


def test_settings_response_redacts_provider_keys() -> None:
    settings = AppSettings(
        gemini_api_key="secret-gemini",
        agent_llm_provider_id="prov_oai",
        agent_llm_providers=[
            AgentLlmProviderSettings(id="prov_oai", kind="openai", api_key="sk-secret", model="gpt-4o"),
        ],
    )
    response = to_settings_response(settings)
    assert response.has_gemini_api_key is True
    assert response.has_agent_llm_key is True
    assert response.agent_llm_provider_id == "prov_oai"
    assert len(response.agent_llm_providers) == 1
    public = response.agent_llm_providers[0]
    assert public.has_api_key is True
    assert public.has_oauth is False
    assert public.model == "gpt-4o"
    dumped = response.model_dump()
    assert "api_key" not in dumped
    assert "sk-secret" not in str(dumped)


def test_merge_preserves_existing_keys() -> None:
    existing = [AgentLlmProviderSettings(id="prov_oai", kind="openai", api_key="sk-keep", model="gpt-4o")]
    merged = merge_agent_llm_providers(
        existing,
        [{"id": "prov_oai", "kind": "openai", "label": "Work", "api_key": "", "model": "gpt-4.1"}],
    )
    assert merged == [
        {
            "id": "prov_oai",
            "kind": "openai",
            "label": "Work",
            "api_key": "sk-keep",
            "model": "gpt-4.1",
            "base_url": "",
            "auth_mode": "api_key",
            "oauth_access_token": "",
            "oauth_refresh_token": "",
            "oauth_expires_at": 0.0,
            "oauth_account_id": "",
            "oauth_account_label": "",
        }
    ]


def test_merge_preserves_oauth_tokens() -> None:
    existing = [
        AgentLlmProviderSettings(
            id="prov_oai",
            kind="openai",
            api_key="sk-keep",
            oauth_access_token="tok",
            oauth_refresh_token="ref",
            oauth_expires_at=99.0,
            oauth_account_id="acct",
            auth_mode="oauth",
        )
    ]
    merged = merge_agent_llm_providers(
        existing,
        [{"id": "prov_oai", "kind": "openai", "label": "Work", "api_key": "", "model": "gpt-4.1"}],
    )
    assert merged[0]["oauth_access_token"] == "tok"
    assert merged[0]["oauth_refresh_token"] == "ref"
    assert merged[0]["auth_mode"] == "oauth"


def test_openai_url_and_messages() -> None:
    assert openai_chat_completions_url("https://api.openai.com/v1/") == "https://api.openai.com/v1/chat/completions"
    assert openai_chat_completions_url("https://host/v1/chat/completions") == "https://host/v1/chat/completions"
    messages = openai_messages_from_agent(
        [
            AgentMessagePayload.model_validate({"role": "user", "parts": [{"type": "text", "text": "Hi"}]}),
            AgentMessagePayload.model_validate(
                {
                    "role": "assistant",
                    "parts": [
                        {
                            "type": "tool_call",
                            "toolCallId": "call_1",
                            "toolName": "get_timeline",
                            "arguments": {"start": 0},
                        }
                    ],
                }
            ),
            AgentMessagePayload.model_validate(
                {
                    "role": "tool",
                    "parts": [
                        {
                            "type": "tool_result",
                            "toolCallId": "call_1",
                            "toolName": "get_timeline",
                            "result": {"clipCount": 2},
                        }
                    ],
                }
            ),
        ],
        "Be brief.",
    )
    assert messages[0] == {"role": "system", "content": "Be brief."}
    assert messages[1]["role"] == "user"
    assert messages[2]["role"] == "assistant"
    assert messages[3]["role"] == "tool"
    tools = openai_tools_from_declarations(
        [AgentToolDeclarationPayload(name="get_timeline", description="Read", parameters={"type": "object"})]
    )
    assert tools[0]["type"] == "function"


def test_parse_openai_tool_call() -> None:
    result = parse_openai_turn_payload(
        {
            "choices": [
                {
                    "message": {
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_abc",
                                "type": "function",
                                "function": {"name": "get_timeline", "arguments": '{"start": 1}'},
                            }
                        ],
                    }
                }
            ]
        }
    )
    assert result.text == ""
    assert result.function_calls[0].name == "get_timeline"
    assert result.function_calls[0].args == {"start": 1}
    assert result.function_calls[0].call_id == "call_abc"


def test_anthropic_url_and_messages() -> None:
    assert anthropic_messages_url("https://api.anthropic.com") == "https://api.anthropic.com/v1/messages"
    assert anthropic_messages_url("https://host/v1") == "https://host/v1/messages"
    messages = anthropic_messages_from_agent(
        [
            AgentMessagePayload.model_validate({"role": "user", "parts": [{"type": "text", "text": "Hi"}]}),
            AgentMessagePayload.model_validate(
                {
                    "role": "assistant",
                    "parts": [
                        {
                            "type": "tool_call",
                            "toolCallId": "toolu_1",
                            "toolName": "get_timeline",
                            "arguments": {},
                        }
                    ],
                }
            ),
            AgentMessagePayload.model_validate(
                {
                    "role": "tool",
                    "parts": [
                        {
                            "type": "tool_result",
                            "toolCallId": "toolu_1",
                            "toolName": "get_timeline",
                            "result": {"ok": True},
                        }
                    ],
                }
            ),
        ]
    )
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"
    assert messages[2]["role"] == "user"
    content = messages[2]["content"]
    assert isinstance(content, list)
    assert content[0]["type"] == "tool_result"
    tools = anthropic_tools_from_declarations(
        [AgentToolDeclarationPayload(name="ask_user", description="Ask", parameters={"type": "object"})]
    )
    assert tools[0]["name"] == "ask_user"
    assert "input_schema" in tools[0]


def test_parse_anthropic_tool_use() -> None:
    result = parse_anthropic_turn_payload(
        {
            "content": [
                {"type": "text", "text": "Need a duration."},
                {
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "ask_user",
                    "input": {"questions": [{"id": "d", "prompt": "How long?", "kind": "choice"}]},
                },
            ]
        }
    )
    assert result.text == "Need a duration."
    assert result.function_calls[0].name == "ask_user"
    assert result.function_calls[0].call_id == "toolu_1"


def test_ui_aliases_and_bind_keep_codex_call_ids_paired() -> None:
    messages = bind_agent_tool_call_ids(
        [
            AgentMessagePayload.model_validate({"role": "user", "parts": [{"type": "text", "text": "Make a short film."}]}),
            AgentMessagePayload.model_validate(
                {
                    "role": "assistant",
                    "parts": [{"type": "tool_call", "id": "call_timeline_1", "name": "get_timeline", "arguments": {}}],
                }
            ),
            AgentMessagePayload.model_validate(
                {
                    "role": "tool",
                    "parts": [{"type": "tool_result", "id": "call_timeline_1", "name": "get_timeline", "result": {"clipCount": 0}}],
                }
            ),
        ]
    )
    items = responses_input_from_agent(messages)
    calls = [item for item in items if item.get("type") == "function_call"]
    outputs = [item for item in items if item.get("type") == "function_call_output"]
    assert len(calls) == 1
    assert len(outputs) == 1
    assert calls[0]["call_id"] == "call_timeline_1"
    assert outputs[0]["call_id"] == "call_timeline_1"


def test_bind_drops_orphan_tool_results() -> None:
    messages = bind_agent_tool_call_ids(
        [
            AgentMessagePayload.model_validate(
                {
                    "role": "tool",
                    "parts": [{"type": "tool_result", "id": "call_missing", "name": "get_timeline", "result": {"ok": False}}],
                }
            )
        ]
    )
    assert messages == []
    assert responses_input_from_agent(
        [AgentMessagePayload.model_validate({"role": "user", "parts": [{"type": "text", "text": "Hi"}]} )]
    )[0]["type"] == "message"
