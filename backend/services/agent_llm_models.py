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

CATALOG_MODELS: dict[AgentLlmProviderKind, tuple[tuple[str, str], ...]] = {
    "gemini": (
        ("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"),
        ("gemini-3.5-flash", "Gemini 3.5 Flash"),
        ("gemini-3-pro-preview", "Gemini 3 Pro"),
        ("gemini-2.5-flash", "Gemini 2.5 Flash"),
        ("gemini-2.5-pro", "Gemini 2.5 Pro"),
        ("gemini-2.0-flash", "Gemini 2.0 Flash"),
    ),
    "openai": (
        ("gpt-5.4", "GPT-5.4"),
        ("gpt-5.3", "GPT-5.3"),
        ("gpt-5.2", "GPT-5.2"),
        ("gpt-5.1", "GPT-5.1"),
        ("gpt-5", "GPT-5"),
        ("gpt-4.1", "GPT-4.1"),
        ("gpt-4o", "GPT-4o"),
        ("gpt-4o-mini", "GPT-4o mini"),
        ("o3", "o3"),
        ("o4-mini", "o4-mini"),
    ),
    "anthropic": (
        ("claude-opus-4-6", "Claude Opus 4.6"),
        ("claude-sonnet-4-6", "Claude Sonnet 4.6"),
        ("claude-opus-4-5", "Claude Opus 4.5"),
        ("claude-sonnet-4-5", "Claude Sonnet 4.5"),
        ("claude-haiku-4-5", "Claude Haiku 4.5"),
        ("claude-opus-4-1", "Claude Opus 4.1"),
        ("claude-sonnet-4", "Claude Sonnet 4"),
    ),
    "openrouter": (
        ("openai/gpt-5", "OpenAI: GPT-5"),
        ("anthropic/claude-sonnet-4.5", "Anthropic: Claude Sonnet 4.5"),
        ("google/gemini-2.5-pro", "Google: Gemini 2.5 Pro"),
        ("openai/gpt-4o", "OpenAI: GPT-4o"),
        ("anthropic/claude-sonnet-4", "Anthropic: Claude Sonnet 4"),
    ),
    "zai": (
        ("glm-4.6", "GLM-4.6"),
        ("glm-4.5", "GLM-4.5"),
        ("glm-4.5-air", "GLM-4.5 Air"),
    ),
    "minimax": (
        ("MiniMax-M2.5", "MiniMax M2.5"),
        ("MiniMax-M2", "MiniMax M2"),
        ("MiniMax-M1", "MiniMax M1"),
    ),
    "moonshot": (
        ("kimi-k2.5", "Kimi K2.5"),
        ("kimi-k2-0905-preview", "Kimi K2 0905"),
        ("kimi-k2-turbo-preview", "Kimi K2 Turbo"),
        ("moonshot-v1-128k", "Moonshot v1 128k"),
    ),
    "xai": (
        ("grok-4", "Grok 4"),
        ("grok-3", "Grok 3"),
        ("grok-3-mini", "Grok 3 Mini"),
        ("grok-2", "Grok 2"),
    ),
    "groq": (
        ("llama-3.3-70b-versatile", "Llama 3.3 70B"),
        ("openai/gpt-oss-120b", "GPT-OSS 120B"),
        ("meta-llama/llama-4-maverick-17b-128e-instruct", "Llama 4 Maverick"),
        ("qwen/qwen3-32b", "Qwen 3 32B"),
    ),
    "deepseek": (
        ("deepseek-chat", "DeepSeek Chat"),
        ("deepseek-reasoner", "DeepSeek Reasoner"),
    ),
    "custom_openai": (),
    "custom_anthropic": (),
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

    if api_key.strip():
        try:
            fetched = _fetch_provider_models(
                http,
                kind=kind,
                api_kind=api_kind,
                api_key=api_key.strip(),
                base_url=resolved_base,
                include_id=resolved,
                use_oauth=use_oauth,
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
    urls = _openai_model_urls(kind, base_url)
    last_error: HTTPError | None = None
    for url in urls:
        try:
            fetched = _list_openai_or_anthropic_models(
                http,
                url=url,
                headers=_openai_headers(kind, api_key),
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


def _openai_model_urls(kind: AgentLlmProviderKind, base_url: str) -> list[str]:
    urls: list[str] = []
    if base_url.strip() and "chatgpt.com" not in base_url:
        urls.append(openai_models_url(base_url))
    if kind == "openai":
        urls.append("https://api.openai.com/v1/models")
    unique: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url not in seen:
            unique.append(url)
            seen.add(url)
    return unique


def _openai_headers(kind: AgentLlmProviderKind, api_key: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if kind == "openrouter":
        headers["HTTP-Referer"] = "https://ltx.studio"
        headers["X-Title"] = "LTX Desktop"
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
    for key in ("id", "model", "name"):
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
    if kind == "openai":
        prefixes = ("gpt", "o1", "o3", "o4", "chatgpt", "codex")
        return lowered.startswith(prefixes) or "/gpt" in lowered
    if kind == "anthropic":
        return "claude" in lowered
    return True
