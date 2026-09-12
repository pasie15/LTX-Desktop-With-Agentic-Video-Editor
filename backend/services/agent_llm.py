"""Resolve the selected Agent LLM provider and run one tool-calling turn."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, cast
from uuid import uuid4

from api_types import AgentMessagePayload, AgentToolDeclarationPayload
from _routes._errors import HTTPError
from services.anthropic_messages_client import (
    anthropic_messages_from_agent,
    anthropic_tools_from_declarations,
    call_anthropic_messages_turn,
)
from services.gemini_text_client import (
    apply_gemini_thinking_config,
    call_gemini_generate_content_turn,
    resolve_gemini_model,
)
from services.interfaces import HTTPClient, JSONValue
from services.openai_compatible_chat import (
    call_openai_compatible_turn,
    openai_messages_from_agent,
    openai_tools_from_declarations,
)
from state.app_settings import (
    BUILTIN_GEMINI_PROVIDER_ID,
    CUSTOM_AGENT_LLM_KINDS,
    AgentLlmAuthMode,
    AgentLlmProviderKind,
    AgentLlmProviderSettings,
    AppSettings,
    provider_has_oauth,
    selected_agent_llm_provider,
)

AgentLlmApiKind = Literal["gemini", "openai", "anthropic"]


@dataclass(frozen=True, slots=True)
class AgentLlmCatalogEntry:
    kind: AgentLlmProviderKind
    label: str
    api_kind: AgentLlmApiKind
    default_model: str
    default_base_url: str
    key_url: str
    supports_oauth: bool = False
    oauth_api_kind: AgentLlmApiKind | None = None
    oauth_base_url: str = ""


AGENT_LLM_CATALOG: tuple[AgentLlmCatalogEntry, ...] = (
    AgentLlmCatalogEntry(
        kind="gemini",
        label="Gemini",
        api_kind="gemini",
        default_model="",
        default_base_url="https://generativelanguage.googleapis.com/v1beta",
        key_url="https://aistudio.google.com/app/apikey",
    ),
    AgentLlmCatalogEntry(
        kind="openai",
        label="OpenAI (ChatGPT)",
        api_kind="openai",
        default_model="gpt-4o",
        default_base_url="https://api.openai.com/v1",
        key_url="https://platform.openai.com/api-keys",
        supports_oauth=True,
        oauth_api_kind="openai",
        oauth_base_url="https://chatgpt.com/backend-api/codex",
    ),
    AgentLlmCatalogEntry(
        kind="anthropic",
        label="Anthropic",
        api_kind="anthropic",
        default_model="claude-sonnet-4-5",
        default_base_url="https://api.anthropic.com",
        key_url="https://console.anthropic.com/settings/keys",
        supports_oauth=True,
    ),
    AgentLlmCatalogEntry(
        kind="openrouter",
        label="OpenRouter",
        api_kind="openai",
        default_model="openai/gpt-4o",
        default_base_url="https://openrouter.ai/api/v1",
        key_url="https://openrouter.ai/keys",
    ),
    AgentLlmCatalogEntry(
        kind="zai",
        label="Z.ai",
        api_kind="openai",
        default_model="glm-4.5",
        default_base_url="https://api.z.ai/api/paas/v4",
        key_url="https://z.ai/manage-apikey/apikeys",
    ),
    AgentLlmCatalogEntry(
        kind="minimax",
        label="MiniMax",
        api_kind="openai",
        default_model="MiniMax-M2",
        default_base_url="https://api.minimax.io/v1",
        key_url="https://platform.minimax.io/user-center/basic-information/interface-key",
        supports_oauth=True,
        oauth_api_kind="anthropic",
        oauth_base_url="https://api.minimax.io/anthropic",
    ),
    AgentLlmCatalogEntry(
        kind="moonshot",
        label="Moonshot / Kimi",
        api_kind="openai",
        default_model="kimi-k2-0905-preview",
        default_base_url="https://api.moonshot.ai/v1",
        key_url="https://platform.moonshot.ai/console/api-keys",
        supports_oauth=True,
        oauth_base_url="https://api.kimi.com/coding/v1",
    ),
    AgentLlmCatalogEntry(
        kind="xai",
        label="xAI (Grok)",
        api_kind="openai",
        default_model="grok-4",
        default_base_url="https://api.x.ai/v1",
        key_url="https://console.x.ai/team/default/api-keys",
        supports_oauth=True,
    ),
    AgentLlmCatalogEntry(
        kind="groq",
        label="Groq",
        api_kind="openai",
        default_model="llama-3.3-70b-versatile",
        default_base_url="https://api.groq.com/openai/v1",
        key_url="https://console.groq.com/keys",
    ),
    AgentLlmCatalogEntry(
        kind="deepseek",
        label="DeepSeek",
        api_kind="openai",
        default_model="deepseek-chat",
        default_base_url="https://api.deepseek.com",
        key_url="https://platform.deepseek.com/api_keys",
    ),
    AgentLlmCatalogEntry(
        kind="custom_openai",
        label="Custom (OpenAI-compatible)",
        api_kind="openai",
        default_model="",
        default_base_url="",
        key_url="",
    ),
    AgentLlmCatalogEntry(
        kind="custom_anthropic",
        label="Custom (Anthropic-compatible)",
        api_kind="anthropic",
        default_model="",
        default_base_url="",
        key_url="",
    ),
)

_CATALOG_BY_KIND = {entry.kind: entry for entry in AGENT_LLM_CATALOG}


@dataclass(frozen=True, slots=True)
class LlmFunctionCall:
    name: str
    args: dict[str, JSONValue]
    call_id: str = ""


@dataclass(frozen=True, slots=True)
class LlmTurnResult:
    text: str
    function_calls: tuple[LlmFunctionCall, ...]


@dataclass(frozen=True, slots=True)
class ResolvedAgentLlm:
    provider_id: str
    kind: AgentLlmProviderKind
    api_kind: AgentLlmApiKind
    label: str
    api_key: str
    model: str
    base_url: str
    auth_mode: AgentLlmAuthMode = "api_key"
    oauth_account_id: str = ""
    oauth_refresh_token: str = ""
    oauth_expires_at: float = 0.0


def catalog_entry(kind: AgentLlmProviderKind) -> AgentLlmCatalogEntry:
    return _CATALOG_BY_KIND[kind]


def _json_object(value: object) -> dict[str, JSONValue]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, JSONValue] = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            result[key] = cast(JSONValue, item)
    return result


def contents_from_messages(messages: list[AgentMessagePayload]) -> list[JSONValue]:
    contents: list[JSONValue] = []
    for message in messages:
        parts: list[JSONValue] = []
        if message.role == "assistant":
            for part in message.parts:
                if part.type == "text" and part.text:
                    parts.append({"text": part.text})
                elif part.type == "tool_call" and part.toolName:
                    parts.append(
                        {
                            "functionCall": {
                                "name": part.toolName,
                                "args": _json_object(part.arguments),
                            }
                        }
                    )
            if parts:
                contents.append({"role": "model", "parts": parts})
            continue

        for part in message.parts:
            if part.type == "text" and part.text:
                parts.append({"text": part.text})
            elif part.type == "inline_image" and part.data and part.mimeType:
                parts.append({"inlineData": {"mimeType": part.mimeType, "data": part.data}})
            elif part.type == "tool_result" and part.toolName:
                response_payload = part.result if part.result is not None else {"ok": True}
                parts.append(
                    {
                        "functionResponse": {
                            "name": part.toolName,
                            "response": _json_object(response_payload),
                        }
                    }
                )
        if parts:
            contents.append({"role": "user", "parts": parts})
    if not contents:
        raise HTTPError(400, "Agent turn has no usable message parts")
    return contents


def resolve_agent_llm(settings: AppSettings, model_override: str | None = None) -> ResolvedAgentLlm:
    override = (model_override or "").strip()
    provider = selected_agent_llm_provider(settings)
    if provider is None:
        return _resolve_builtin_gemini(settings, override)

    entry = catalog_entry(provider.kind)
    use_oauth = provider_has_oauth(provider)
    api_key = provider.oauth_access_token if use_oauth else provider.api_key
    if provider.kind == "gemini" and not api_key:
        api_key = settings.gemini_api_key
    model = override or provider.model or entry.default_model
    if provider.kind == "gemini" and not model:
        model = settings.gemini_model
    api_kind = entry.oauth_api_kind if use_oauth and entry.oauth_api_kind else entry.api_kind
    base_url = provider.base_url or ((entry.oauth_base_url if use_oauth else "") or entry.default_base_url)
    if provider.kind in CUSTOM_AGENT_LLM_KINDS and (not base_url or not (override or provider.model)):
        raise HTTPError(400, "AGENT_LLM_PROVIDER_INVALID")
    return ResolvedAgentLlm(
        provider_id=provider.id,
        kind=provider.kind,
        api_kind=api_kind,
        label=provider.label or entry.label,
        api_key=api_key,
        model=model,
        base_url=base_url,
        auth_mode="oauth" if use_oauth else "api_key",
        oauth_account_id=provider.oauth_account_id,
        oauth_refresh_token=provider.oauth_refresh_token,
        oauth_expires_at=provider.oauth_expires_at,
    )


def _resolve_builtin_gemini(settings: AppSettings, model_override: str) -> ResolvedAgentLlm:
    entry = catalog_entry("gemini")
    return ResolvedAgentLlm(
        provider_id=BUILTIN_GEMINI_PROVIDER_ID,
        kind="gemini",
        api_kind="gemini",
        label=entry.label,
        api_key=settings.gemini_api_key,
        model=model_override or settings.gemini_model,
        base_url=entry.default_base_url,
    )


def missing_key_code(resolved: ResolvedAgentLlm) -> str:
    if resolved.kind == "gemini":
        return "GEMINI_API_KEY_MISSING"
    return "AGENT_LLM_KEY_MISSING"


def run_agent_llm_turn(
    http: HTTPClient,
    resolved: ResolvedAgentLlm,
    *,
    messages: list[AgentMessagePayload],
    available_tools: list[AgentToolDeclarationPayload],
    system_instruction: str,
) -> LlmTurnResult:
    if not resolved.api_key:
        raise HTTPError(400, missing_key_code(resolved))

    if resolved.api_kind == "gemini":
        gemini_model = resolve_gemini_model(resolved.model)
        result = call_gemini_generate_content_turn(
            http,
            api_key=resolved.api_key,
            model=gemini_model,
            contents=contents_from_messages(messages),
            system_instruction=system_instruction,
            tools=_gemini_tools(available_tools),
            generation_config=apply_gemini_thinking_config(
                gemini_model,
                {"temperature": 0.4, "maxOutputTokens": 2048},
            ),
            timeout=60,
        )
        return LlmTurnResult(
            text=result.text,
            function_calls=tuple(
                LlmFunctionCall(name=call.name, args=call.args, call_id=f"call_{uuid4().hex[:10]}")
                for call in result.function_calls
            ),
        )

    if resolved.kind == "openai" and resolved.auth_mode == "oauth":
        from services.codex_responses_client import call_codex_responses_turn

        return call_codex_responses_turn(
            http,
            access_token=resolved.api_key,
            account_id=resolved.oauth_account_id,
            model=resolved.model,
            messages=messages,
            available_tools=available_tools,
            system_instruction=system_instruction,
            timeout=60,
        )

    if resolved.api_kind == "openai":
        return call_openai_compatible_turn(
            http,
            api_key=resolved.api_key,
            model=resolved.model,
            base_url=resolved.base_url,
            messages=openai_messages_from_agent(messages, system_instruction),
            tools=openai_tools_from_declarations(available_tools),
            extra_headers=_openai_extra_headers(resolved.kind),
            timeout=60,
        )

    return call_anthropic_messages_turn(
        http,
        api_key=resolved.api_key,
        model=resolved.model,
        base_url=resolved.base_url,
        system_instruction=system_instruction,
        messages=anthropic_messages_from_agent(messages),
        tools=anthropic_tools_from_declarations(available_tools),
        use_oauth_bearer=resolved.auth_mode == "oauth",
        timeout=60,
    )


def _gemini_tools(declarations: list[AgentToolDeclarationPayload]) -> list[JSONValue] | None:
    if not declarations:
        return None
    function_declarations: list[JSONValue] = []
    for item in declarations:
        name = item.name.strip()
        if not name:
            continue
        function_declarations.append(
            {
                "name": name,
                "description": item.description,
                "parameters": _json_object(item.parameters) or {"type": "object", "properties": {}},
            }
        )
    if not function_declarations:
        return None
    return [{"functionDeclarations": function_declarations}]


def _openai_extra_headers(kind: AgentLlmProviderKind) -> dict[str, str] | None:
    if kind != "openrouter":
        return None
    return {
        "HTTP-Referer": "https://ltx.studio",
        "X-Title": "LTX Desktop",
    }


def merge_agent_llm_providers(
    existing: list[AgentLlmProviderSettings],
    incoming: list[object],
) -> list[JSONValue]:
    existing_by_id = {provider.id: provider for provider in existing}
    merged: list[JSONValue] = []
    seen_ids: set[str] = set()
    for item in incoming:
        if not isinstance(item, dict):
            continue
        fields = cast(dict[str, object], item)
        provider_id = str(fields.get("id") or "").strip()
        kind = fields.get("kind")
        if not provider_id or not isinstance(kind, str) or kind not in _CATALOG_BY_KIND:
            continue
        if provider_id in seen_ids:
            continue
        seen_ids.add(provider_id)
        previous = existing_by_id.get(provider_id)
        api_key = str(fields.get("api_key") or "").strip()
        if not api_key and previous is not None:
            api_key = previous.api_key
        oauth_access = str(fields.get("oauth_access_token") or "").strip()
        oauth_refresh = str(fields.get("oauth_refresh_token") or "").strip()
        oauth_account_id = str(fields.get("oauth_account_id") or "").strip()
        oauth_account_label = str(fields.get("oauth_account_label") or "").strip()
        raw_expires = fields.get("oauth_expires_at")
        oauth_expires_at = float(raw_expires) if isinstance(raw_expires, (int, float)) else 0.0
        auth_mode = fields.get("auth_mode")
        if auth_mode not in ("api_key", "oauth"):
            auth_mode = previous.auth_mode if previous is not None else "api_key"
        if previous is not None:
            if not oauth_access:
                oauth_access = previous.oauth_access_token
            if not oauth_refresh:
                oauth_refresh = previous.oauth_refresh_token
            if oauth_expires_at <= 0:
                oauth_expires_at = previous.oauth_expires_at
            if not oauth_account_id:
                oauth_account_id = previous.oauth_account_id
            if not oauth_account_label:
                oauth_account_label = previous.oauth_account_label
        if oauth_access and auth_mode != "api_key":
            auth_mode = "oauth"
        merged.append(
            {
                "id": provider_id,
                "kind": kind,
                "label": str(fields.get("label") or "").strip(),
                "api_key": api_key,
                "model": str(fields.get("model") or "").strip(),
                "base_url": str(fields.get("base_url") or "").strip(),
                "auth_mode": auth_mode,
                "oauth_access_token": oauth_access,
                "oauth_refresh_token": oauth_refresh,
                "oauth_expires_at": oauth_expires_at,
                "oauth_account_id": oauth_account_id,
                "oauth_account_label": oauth_account_label,
            }
        )
    return merged
