"""Canonical app settings schema and patch models."""

from __future__ import annotations

import sys
from typing import Any, Literal, TypeGuard, TypeVar, cast, get_args

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator

from api_types import LTXLocalModelId

AgentLlmProviderKind = Literal[
    "gemini",
    "openai",
    "anthropic",
    "openrouter",
    "zai",
    "minimax",
    "moonshot",
    "xai",
    "groq",
    "deepseek",
    "custom_openai",
    "custom_anthropic",
]

AgentLlmAuthMode = Literal["api_key", "oauth"]

BUILTIN_GEMINI_PROVIDER_ID = "gemini"
CUSTOM_AGENT_LLM_KINDS = ("custom_openai", "custom_anthropic")
OAUTH_AGENT_LLM_KINDS = ("openai", "anthropic", "minimax", "xai", "moonshot")


def _to_camel_case(field_name: str) -> str:
    special_aliases = {
        "prompt_enhancer_enabled_t2v": "promptEnhancerEnabledT2V",
        "prompt_enhancer_enabled_i2v": "promptEnhancerEnabledI2V",
        "has_oauth": "hasOAuth",
        "has_elevenlabs_api_key": "hasElevenLabsApiKey",
        "elevenlabs_api_key": "elevenlabsApiKey",
    }
    if field_name in special_aliases:
        return special_aliases[field_name]

    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _clamp_int(value: Any, minimum: int, maximum: int, default: int) -> int:
    if value is None:
        return default

    parsed = int(value)
    return max(minimum, min(maximum, parsed))


class SettingsBaseModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel_case,
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )


class SettingsPatchModel(SettingsBaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel_case,
        populate_by_name=True,
        validate_assignment=True,
        extra="forbid",
    )


class AgentLlmProviderSettings(SettingsBaseModel):
    id: str
    kind: AgentLlmProviderKind
    label: str = ""
    api_key: str = ""
    model: str = ""
    base_url: str = ""
    auth_mode: AgentLlmAuthMode = "api_key"
    oauth_access_token: str = ""
    oauth_refresh_token: str = ""
    oauth_expires_at: float = 0
    oauth_account_id: str = ""
    oauth_account_label: str = ""

    @field_validator(
        "id",
        "label",
        "api_key",
        "model",
        "base_url",
        "oauth_access_token",
        "oauth_refresh_token",
        "oauth_account_id",
        "oauth_account_label",
        mode="before",
    )
    @classmethod
    def _strip_strings(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class AgentLlmProviderPublic(SettingsBaseModel):
    id: str
    kind: AgentLlmProviderKind
    label: str = ""
    has_api_key: bool = False
    has_oauth: bool = False
    auth_mode: AgentLlmAuthMode = "api_key"
    model: str = ""
    base_url: str = ""


class AppSettings(SettingsBaseModel):
    use_torch_compile: bool = False
    diffusion_stage_cache_enabled: bool = False
    ltx_api_key: str = ""
    user_prefers_ltx_api_video_generations: bool = False
    fal_api_key: str = ""
    user_prefers_fal_api_image_generations: bool = False
    elevenlabs_api_key: str = ""
    use_local_text_encoder: bool = False
    prompt_cache_size: int = 100
    prompt_enhancer_enabled_t2v: bool = True
    prompt_enhancer_enabled_i2v: bool = False
    # The user's explicit choice, persisted so it survives restarts. None means no active choice
    # has been made yet — the UI defaults to whichever provider is available, preferring local,
    # without writing that default back here. Only an explicit user pick (not an automatic
    # fallback when the preferred provider is temporarily unavailable) ever sets this.
    prompt_enhancer_provider_preference: Literal["local", "api"] | None = None
    gemini_api_key: str = ""
    # Empty string means "use DEFAULT_GEMINI_MODEL at generate time" — unlike API keys, an
    # empty patch is persisted so the user can reset to the default without a tombstone value.
    gemini_model: str = ""
    # Selected Agent chat provider. Empty or "gemini" uses the built-in Gemini key/model
    # already stored above. Other ids must match an entry in agent_llm_providers.
    agent_llm_provider_id: str = ""
    agent_llm_providers: list[AgentLlmProviderSettings] = Field(
        default_factory=list[AgentLlmProviderSettings]
    )
    seed_locked: bool = False
    locked_seed: int = 42
    models_dir: str = ""
    active_ltx_model_id: LTXLocalModelId | None = None
    # None = platform default (Mac on, CUDA/Linux off). An explicit bool is a user override.
    use_conv_vae: bool | None = None

    @field_validator("prompt_cache_size", mode="before")
    @classmethod
    def _clamp_prompt_cache_size(cls, value: Any) -> int:
        return _clamp_int(value, minimum=0, maximum=1000, default=100)

    @field_validator("locked_seed", mode="before")
    @classmethod
    def _clamp_locked_seed(cls, value: Any) -> int:
        return _clamp_int(value, minimum=0, maximum=2_147_483_647, default=42)


SettingsModelT = TypeVar("SettingsModelT", bound=SettingsBaseModel)
_PARTIAL_MODEL_CACHE: dict[type[SettingsBaseModel], type[SettingsPatchModel]] = {}


def _wrap_optional(annotation: Any) -> Any:
    if type(None) in get_args(annotation):
        return annotation
    return annotation | None


def _to_partial_annotation(annotation: Any) -> Any:
    if _is_settings_model_annotation(annotation):
        return make_partial_model(annotation)
    return annotation


def make_partial_model(model: type[SettingsModelT]) -> type[SettingsPatchModel]:
    cached = _PARTIAL_MODEL_CACHE.get(model)
    if cached is not None:
        return cached

    fields: dict[str, tuple[Any, Any]] = {}
    for field_name, field_info in model.model_fields.items():
        partial_annotation = _wrap_optional(_to_partial_annotation(field_info.annotation))
        fields[field_name] = (partial_annotation, Field(default=None))

    partial_model = create_model(
        f"{model.__name__}Patch",
        __base__=SettingsPatchModel,
        **cast(Any, fields),
    )

    _PARTIAL_MODEL_CACHE[model] = partial_model
    return partial_model


def _is_settings_model_annotation(annotation: object) -> TypeGuard[type[SettingsBaseModel]]:
    return isinstance(annotation, type) and issubclass(annotation, SettingsBaseModel)


AppSettingsPatch = make_partial_model(AppSettings)
UpdateSettingsRequest = AppSettingsPatch


class SettingsResponse(SettingsBaseModel):
    use_torch_compile: bool = False
    diffusion_stage_cache_enabled: bool = False
    has_ltx_api_key: bool = False
    user_prefers_ltx_api_video_generations: bool = False
    has_fal_api_key: bool = False
    has_elevenlabs_api_key: bool = False
    user_prefers_fal_api_image_generations: bool = False
    use_local_text_encoder: bool = False
    prompt_cache_size: int = 100
    prompt_enhancer_enabled_t2v: bool = True
    prompt_enhancer_enabled_i2v: bool = False
    prompt_enhancer_provider_preference: Literal["local", "api"] | None = None
    has_gemini_api_key: bool = False
    gemini_model: str = ""
    has_agent_llm_key: bool = False
    agent_llm_provider_id: str = ""
    agent_llm_providers: list[AgentLlmProviderPublic] = Field(
        default_factory=list[AgentLlmProviderPublic]
    )
    seed_locked: bool = False
    locked_seed: int = 42
    models_dir: str = ""
    active_ltx_model_id: LTXLocalModelId | None = None
    use_conv_vae: bool = False


def resolved_use_conv_vae(settings: AppSettings) -> bool:
    """Effective Fast decode setting: user override, else Mac on / CUDA off."""
    if settings.use_conv_vae is not None:
        return settings.use_conv_vae
    return sys.platform == "darwin"


def selected_agent_llm_provider(settings: AppSettings) -> AgentLlmProviderSettings | None:
    selected = settings.agent_llm_provider_id.strip()
    if not selected:
        return None
    for provider in settings.agent_llm_providers:
        if provider.id == selected:
            return provider
    return None


def provider_has_oauth(provider: AgentLlmProviderSettings) -> bool:
    return bool(provider.oauth_access_token.strip())


def provider_has_credential(provider: AgentLlmProviderSettings) -> bool:
    return provider_has_oauth(provider) or bool(provider.api_key.strip())


def has_usable_agent_llm_key(settings: AppSettings) -> bool:
    provider = selected_agent_llm_provider(settings)
    if provider is None:
        return bool(settings.gemini_api_key.strip())
    if provider.kind == "gemini":
        return bool(provider.api_key.strip() or settings.gemini_api_key.strip())
    if provider.kind in CUSTOM_AGENT_LLM_KINDS:
        return bool(provider.api_key.strip() and provider.base_url.strip() and provider.model.strip())
    return provider_has_credential(provider)


def to_settings_response(settings: AppSettings) -> SettingsResponse:
    data = settings.model_dump(by_alias=False)
    ltx_key = data.pop("ltx_api_key", "")
    fal_key = data.pop("fal_api_key", "")
    elevenlabs_key = data.pop("elevenlabs_api_key", "")
    gemini_key = data.pop("gemini_api_key", "")
    providers = data.pop("agent_llm_providers", [])
    data["has_ltx_api_key"] = bool(ltx_key)
    data["has_fal_api_key"] = bool(fal_key)
    data["has_elevenlabs_api_key"] = bool(elevenlabs_key)
    data["has_gemini_api_key"] = bool(gemini_key)
    data["has_agent_llm_key"] = has_usable_agent_llm_key(settings)
    data["use_conv_vae"] = resolved_use_conv_vae(settings)
    public_providers: list[dict[str, object]] = []
    if isinstance(providers, list):
        for item in cast(list[object], providers):
            if not isinstance(item, dict):
                continue
            fields = cast(dict[str, object], item)
            public_providers.append(
                {
                    "id": fields.get("id", ""),
                    "kind": fields.get("kind", "openai"),
                    "label": fields.get("label", ""),
                    "has_api_key": bool(fields.get("api_key")),
                    "has_oauth": bool(fields.get("oauth_access_token")),
                    "auth_mode": fields.get("auth_mode") or "api_key",
                    "model": fields.get("model", ""),
                    "base_url": fields.get("base_url", ""),
                }
            )
    data["agent_llm_providers"] = public_providers
    return SettingsResponse.model_validate(data)


def should_video_generate_with_ltx_api(*, force_api_generations: bool, settings: AppSettings) -> bool:
    has_ltx_api_key = bool(settings.ltx_api_key.strip())
    return force_api_generations or (
        settings.user_prefers_ltx_api_video_generations and has_ltx_api_key
    )


def should_image_generate_with_fal_api(*, force_api_generations: bool, settings: AppSettings) -> bool:
    has_fal_api_key = bool(settings.fal_api_key.strip())
    return force_api_generations or (
        settings.user_prefers_fal_api_image_generations and has_fal_api_key
    )
