"""List Agent LLM chat models from the provider, with a latest-first catalog fallback."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, cast

from api_types import AgentLlmModelOptionPayload, AgentLlmModelsResponse
from _routes._errors import HTTPError
from services.agent_llm import AgentLlmApiKind, catalog_entry
from services.gemini_text_client import list_gemini_generate_content_models
from services.interfaces import HTTPClient, HttpTransportError, JSONValue
from state.app_settings import AgentLlmAuthMode, AgentLlmProviderKind

_ANTHROPIC_VERSION = "2023-06-01"
PUBLIC_FETCH_KINDS: frozenset[AgentLlmProviderKind] = frozenset({"openrouter"})

CATALOG_MODELS: dict[AgentLlmProviderKind, tuple[tuple[str, str], ...]] = {
    "gemini": (
        ("gemini-3.8-flash", "Gemini 3.8 Flash"),
        ("gemini-3.7-flash", "Gemini 3.7 Flash"),
        ("gemini-3.6-flash", "Gemini 3.6 Flash"),
        ("gemini-3.5-flash", "Gemini 3.5 Flash"),
        ("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"),
        ("gemini-3.1-pro-preview", "Gemini 3.1 Pro"),
        ("gemini-3-pro-preview", "Gemini 3 Pro"),
        ("gemini-2.5-pro", "Gemini 2.5 Pro"),
        ("gemini-2.5-flash", "Gemini 2.5 Flash"),
        ("gemini-2.0-flash", "Gemini 2.0 Flash"),
    ),
    "openai": (
        ("gpt-6-astra", "GPT-6 Astra"),
        ("gpt-5.6-sol", "GPT-5.6 Sol"),
        ("gpt-5.6-terra", "GPT-5.6 Terra"),
        ("gpt-5.6-luna", "GPT-5.6 Luna"),
        ("gpt-5.5", "GPT-5.5"),
        ("gpt-5.4", "GPT-5.4"),
        ("gpt-5.3", "GPT-5.3"),
        ("gpt-5.2", "GPT-5.2"),
        ("gpt-5.1", "GPT-5.1"),
        ("gpt-5", "GPT-5"),
        ("gpt-5-mini", "GPT-5 mini"),
        ("gpt-5-nano", "GPT-5 nano"),
        ("gpt-4.1", "GPT-4.1"),
        ("gpt-4.1-mini", "GPT-4.1 mini"),
        ("gpt-4o", "GPT-4o"),
        ("gpt-4o-mini", "GPT-4o mini"),
        ("o3", "o3"),
        ("o4-mini", "o4-mini"),
        ("o1", "o1"),
    ),
    "anthropic": (
        ("claude-fable-5-1", "Claude Fable 5.1"),
        ("claude-opus-5", "Claude Opus 5"),
        ("claude-sonnet-5", "Claude Sonnet 5"),
        ("claude-haiku-4-5", "Claude Haiku 4.5"),
        ("claude-opus-4-8", "Claude Opus 4.8"),
        ("claude-opus-4-7", "Claude Opus 4.7"),
        ("claude-opus-4-6", "Claude Opus 4.6"),
        ("claude-sonnet-4-6", "Claude Sonnet 4.6"),
        ("claude-opus-4-5", "Claude Opus 4.5"),
        ("claude-sonnet-4-5", "Claude Sonnet 4.5"),
        ("claude-haiku-4-5-20251001", "Claude Haiku 4.5 (20251001)"),
        ("claude-opus-4-1", "Claude Opus 4.1"),
        ("claude-sonnet-4", "Claude Sonnet 4"),
    ),
    "openrouter": (
        ("openai/gpt-6-astra", "OpenAI: GPT-6 Astra"),
        ("openai/gpt-5.6-sol", "OpenAI: GPT-5.6 Sol"),
        ("openai/gpt-5.6-terra", "OpenAI: GPT-5.6 Terra"),
        ("anthropic/claude-fable-5.1", "Anthropic: Claude Fable 5.1"),
        ("anthropic/claude-opus-5", "Anthropic: Claude Opus 5"),
        ("anthropic/claude-sonnet-5", "Anthropic: Claude Sonnet 5"),
        ("google/gemini-3.8-flash", "Google: Gemini 3.8 Flash"),
        ("x-ai/grok-4.6", "xAI: Grok 4.6"),
        ("moonshotai/kimi-k3", "Moonshot: Kimi K3"),
        ("minimax/minimax-m3", "MiniMax: M3"),
        ("deepseek/deepseek-v4-pro", "DeepSeek: V4 Pro"),
        ("deepseek/deepseek-chat", "DeepSeek: Chat"),
        ("openai/gpt-4o", "OpenAI: GPT-4o"),
        ("anthropic/claude-sonnet-4.5", "Anthropic: Claude Sonnet 4.5"),
        ("google/gemini-2.5-pro", "Google: Gemini 2.5 Pro"),
    ),
    "zai": (
        ("glm-5", "GLM-5"),
        ("glm-4.7", "GLM-4.7"),
        ("glm-4.6", "GLM-4.6"),
        ("glm-4.5", "GLM-4.5"),
        ("glm-4.5-air", "GLM-4.5 Air"),
        ("glm-4-flash", "GLM-4 Flash"),
    ),
    "minimax": (
        ("MiniMax-M3", "MiniMax M3"),
        ("MiniMax-M2.7", "MiniMax M2.7"),
        ("MiniMax-M2.7-highspeed", "MiniMax M2.7 Highspeed"),
        ("MiniMax-M2.5", "MiniMax M2.5"),
        ("MiniMax-M2.5-highspeed", "MiniMax M2.5 Highspeed"),
        ("MiniMax-M2.1", "MiniMax M2.1"),
        ("MiniMax-M2.1-highspeed", "MiniMax M2.1 Highspeed"),
        ("MiniMax-M2", "MiniMax M2"),
    ),
    "moonshot": (
        ("kimi-k3", "Kimi K3"),
        ("kimi-k2.5", "Kimi K2.5"),
        ("kimi-k2-0905-preview", "Kimi K2 0905"),
        ("kimi-k2-turbo-preview", "Kimi K2 Turbo"),
        ("moonshot-v1-128k", "Moonshot v1 128k"),
        ("moonshot-v1-32k", "Moonshot v1 32k"),
        ("moonshot-v1-8k", "Moonshot v1 8k"),
    ),
    "xai": (
        ("grok-4.6", "Grok 4.6"),
        ("grok-4.5", "Grok 4.5"),
        ("grok-4", "Grok 4"),
        ("grok-3", "Grok 3"),
        ("grok-3-mini", "Grok 3 Mini"),
        ("grok-3-fast", "Grok 3 Fast"),
        ("grok-2", "Grok 2"),
        ("grok-2-vision-1212", "Grok 2 Vision"),
    ),
    "groq": (
        ("openai/gpt-oss-120b", "GPT-OSS 120B"),
        ("openai/gpt-oss-20b", "GPT-OSS 20B"),
        ("qwen/qwen3.8-27b", "Qwen 3.8 27B"),
        ("qwen/qwen3.6-27b", "Qwen 3.6 27B"),
        ("qwen/qwen3-32b", "Qwen 3 32B"),
        ("moonshotai/kimi-k2-instruct-0905", "Kimi K2 Instruct"),
        ("meta-llama/llama-4-maverick-17b-128e-instruct", "Llama 4 Maverick"),
        ("meta-llama/llama-4-scout-17b-16e-instruct", "Llama 4 Scout"),
        ("llama-3.3-70b-versatile", "Llama 3.3 70B"),
        ("llama-3.1-8b-instant", "Llama 3.1 8B Instant"),
        ("groq/compound", "Groq Compound"),
    ),
    "deepseek": (
        ("deepseek-v4-pro", "DeepSeek V4 Pro"),
        ("deepseek-v4-flash", "DeepSeek V4 Flash"),
        ("deepseek-chat", "DeepSeek Chat"),
        ("deepseek-reasoner", "DeepSeek Reasoner"),
    ),
    "custom_openai": (
        ("gpt-5.6-sol", "GPT-5.6 Sol"),
        ("gpt-4o", "GPT-4o"),
        ("claude-sonnet-5", "Claude Sonnet 5"),
        ("gemini-3.8-flash", "Gemini 3.8 Flash"),
    ),
    "custom_anthropic": (
        ("claude-fable-5-1", "Claude Fable 5.1"),
        ("claude-opus-5", "Claude Opus 5"),
        ("claude-sonnet-5", "Claude Sonnet 5"),
        ("claude-haiku-4-5", "Claude Haiku 4.5"),
        ("MiniMax-M3", "MiniMax M3"),
    ),
}


def catalog_model_options(kind: AgentLlmProviderKind) -> list[AgentLlmModelOptionPayload]:
    return [
        AgentLlmModelOptionPayload(id=model_id, displayName=label, description="")
        for model_id, label in CATALOG_MODELS.get(kind, ())
    ]


def openai_models_url(base_url: str) -> str:
    stripped = base_url.strip().rstrip("/")
    if stripped.endswith("/models"):
        return stripped
    if stripped.endswith("/chat/completions"):
        stripped = stripped[: -len("/chat/completions")]
    return f"{stripped}/models"


def anthropic_models_url(base_url: str) -> str:
    stripped = base_url.strip().rstrip("/")
    if stripped.endswith("/models"):
        return stripped
    if stripped.endswith("/messages"):
        stripped = stripped[: -len("/messages")]
    if stripped.endswith("/v1"):
        return f"{stripped}/models"
    return f"{stripped}/v1/models"


def merge_model_options(
    fetched: list[AgentLlmModelOptionPayload],
    catalog: list[AgentLlmModelOptionPayload],
    include_id: str,
) -> list[AgentLlmModelOptionPayload]:
    ordered: list[AgentLlmModelOptionPayload] = []
    seen: set[str] = set()
    for model in [*fetched, *catalog]:
        model_id = model.id.strip()
        if not model_id or model_id in seen:
            continue
        ordered.append(model)
        seen.add(model_id)
    included = include_id.strip()
    if included and included not in seen:
        ordered.append(AgentLlmModelOptionPayload(id=included, displayName=included, description=""))
    return ordered


def list_agent_llm_models(
    http: HTTPClient,
    *,
    kind: AgentLlmProviderKind,
    api_key: str,
    base_url: str,
    include_id: str,
    auth_mode: AgentLlmAuthMode = "api_key",
    oauth_account_id: str = "",
) -> AgentLlmModelsResponse:
    entry = catalog_entry(kind)
    use_oauth = auth_mode == "oauth"
    api_kind: AgentLlmApiKind = (
        entry.oauth_api_kind if use_oauth and entry.oauth_api_kind else entry.api_kind
    )
    resolved_base = base_url.strip() or (
        (entry.oauth_base_url if use_oauth else "") or entry.default_base_url
    )
    catalog = catalog_model_options(kind)
    resolved = (include_id or entry.default_model).strip()
    fetched: list[AgentLlmModelOptionPayload] = []
    error = ""
    source: Literal["provider", "catalog"] = "catalog"
    should_fetch = bool(api_key.strip()) or kind in PUBLIC_FETCH_KINDS or (
        kind.startswith("custom") and bool(resolved_base)
    )

    if should_fetch:
        try:
            fetched = _fetch_provider_models(
                http,
                kind=kind,
                api_kind=api_kind,
                api_key=api_key.strip(),
                base_url=resolved_base,
                include_id=resolved,
                use_oauth=use_oauth,
                oauth_account_id=oauth_account_id,
            )
            if fetched:
                source = "provider"
        except HTTPError as exc:
            error = exc.detail
        except Exception:
            error = "Could not list models from the provider."

    models = merge_model_options(fetched, catalog, resolved)
    if not resolved and models:
        resolved = models[0].id
    return AgentLlmModelsResponse(
        models=models,
        resolvedModel=resolved,
        source=source,
        error=error,
    )


def _fetch_provider_models(
    http: HTTPClient,
    *,
    kind: AgentLlmProviderKind,
    api_kind: AgentLlmApiKind,
    api_key: str,
    base_url: str,
    include_id: str,
    use_oauth: bool,
    oauth_account_id: str = "",
) -> list[AgentLlmModelOptionPayload]:
    if api_kind == "gemini":
        return [
            AgentLlmModelOptionPayload(
                id=model.id,
                displayName=model.displayName,
                description=model.description,
            )
            for model in list_gemini_generate_content_models(
                http,
                api_key=api_key,
                include_id=include_id or None,
            )
        ]
    if api_kind == "anthropic":
        return _list_openai_or_anthropic_models(
            http,
            url=anthropic_models_url(base_url),
            headers=_anthropic_headers(api_key, use_oauth=use_oauth),
            kind=kind,
        )
    urls = _openai_model_urls(kind, base_url, use_oauth=use_oauth)
    last_error: HTTPError | None = None
    for url in urls:
        try:
            fetched = _list_openai_or_anthropic_models(
                http,
                url=url,
                headers=_openai_headers(kind, api_key, use_oauth=use_oauth, account_id=oauth_account_id),
                kind=kind,
            )
        except HTTPError as exc:
            last_error = exc
            continue
        if fetched:
            return fetched
    if last_error is not None:
        raise last_error
    return []


def _openai_model_urls(kind: AgentLlmProviderKind, base_url: str, *, use_oauth: bool = False) -> list[str]:
    urls: list[str] = []
    if base_url.strip() and "chatgpt.com" not in base_url:
        urls.append(openai_models_url(base_url))
    if kind == "openai":
        # chatgpt.com/backend-api/codex/models is the ChatGPT Connect catalog — OAuth only.
        # A project API key must not be sent there.
        if use_oauth:
            urls.append("https://chatgpt.com/backend-api/codex/models")
        urls.append("https://api.openai.com/v1/models")
    unique: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url not in seen:
            unique.append(url)
            seen.add(url)
    return unique


def _openai_headers(
    kind: AgentLlmProviderKind,
    api_key: str,
    *,
    use_oauth: bool = False,
    account_id: str = "",
) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if kind == "openrouter":
        headers["HTTP-Referer"] = "https://ltx.studio"
        headers["X-Title"] = "LTX Desktop"
    if kind == "openai" and use_oauth:
        headers["originator"] = "ltx_desktop"
        headers["openai-beta"] = "responses=experimental"
        if account_id.strip():
            headers["chatgpt-account-id"] = account_id.strip()
    return headers


def _anthropic_headers(api_key: str, *, use_oauth: bool) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "anthropic-version": _ANTHROPIC_VERSION,
    }
    if use_oauth:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["anthropic-beta"] = "oauth-2025-04-20"
    else:
        headers["x-api-key"] = api_key
    return headers


def _list_openai_or_anthropic_models(
    http: HTTPClient,
    *,
    url: str,
    headers: dict[str, str],
    kind: AgentLlmProviderKind,
) -> list[AgentLlmModelOptionPayload]:
    try:
        response = http.get(url, headers=headers, timeout=30)
    except HttpTransportError as exc:
        raise HTTPError(504, "Agent LLM models request timed out") from exc
    if response.status_code != 200:
        raise HTTPError(response.status_code, f"Agent LLM models error: {response.text}")
    try:
        payload: object = response.json()
    except Exception as exc:
        raise HTTPError(500, "AGENT_LLM_MODELS_PARSE_ERROR") from exc

    scored: list[tuple[int, AgentLlmModelOptionPayload]] = []
    for index, record in enumerate(_iter_model_records(payload)):
        model_id = _model_id(record)
        if not model_id or not _keep_model(kind, model_id):
            continue
        scored.append(
            (
                _created_sort_value(record),
                AgentLlmModelOptionPayload(
                    id=model_id,
                    displayName=_model_display_name(record, model_id),
                    description=_model_description(record),
                ),
            )
        )
    scored.sort(key=lambda item: (-item[0], item[1].id))
    return [model for _, model in scored]


def _iter_model_records(payload: object) -> list[dict[str, JSONValue]]:
    if isinstance(payload, list):
        return [cast(dict[str, JSONValue], item) for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("data", "models", "items"):
        value = payload.get(key)
        if isinstance(value, list):
            return [cast(dict[str, JSONValue], item) for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = value.get("data") or value.get("models")
            if isinstance(nested, list):
                return [cast(dict[str, JSONValue], item) for item in nested if isinstance(item, dict)]
    return []


def _model_id(record: dict[str, JSONValue]) -> str:
    # OpenAI Connect / Codex lists the usable chat id in `slug`; `id` is often an internal row.
    for key in ("slug", "id", "model", "name"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _model_display_name(record: dict[str, JSONValue], model_id: str) -> str:
    for key in ("display_name", "displayName", "name"):
        value = record.get(key)
        if isinstance(value, str) and value.strip() and value.strip() != model_id:
            return value.strip()
    return model_id


def _model_description(record: dict[str, JSONValue]) -> str:
    for key in ("description", "owned_by"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _created_sort_value(record: dict[str, JSONValue]) -> int:
    created = record.get("created")
    if isinstance(created, bool):
        return 0
    if isinstance(created, (int, float)):
        return int(created)
    created_at = record.get("created_at")
    if isinstance(created_at, str) and created_at.strip():
        try:
            return int(datetime.fromisoformat(created_at.replace("Z", "+00:00")).timestamp())
        except ValueError:
            return 0
    return 0


def _keep_model(kind: AgentLlmProviderKind, model_id: str) -> bool:
    lowered = model_id.lower()
    skip_markers = ("whisper", "tts", "dall-e", "dalle", "embedding", "embed", "moderation", "realtime")
    if any(marker in lowered for marker in skip_markers):
        return False
    if kind == "openai":
        prefixes = ("gpt", "o1", "o3", "o4", "chatgpt", "codex")
        return lowered.startswith(prefixes) or "/gpt" in lowered
    if kind == "anthropic":
        return "claude" in lowered or "minimax" in lowered
    if kind == "groq":
        return not any(marker in lowered for marker in ("orpheus", "prompt-guard", "safeguard"))
    return True
