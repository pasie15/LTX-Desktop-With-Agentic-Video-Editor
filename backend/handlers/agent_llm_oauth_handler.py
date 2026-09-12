"""Start / poll / complete Agent LLM provider OAuth without inventing tokens."""

from __future__ import annotations

from threading import RLock
from typing import TYPE_CHECKING, cast

from api_types import (
    AgentLlmOAuthCancelRequest,
    AgentLlmOAuthCompleteRequest,
    AgentLlmOAuthDisconnectRequest,
    AgentLlmOAuthOkResponse,
    AgentLlmOAuthPollRequest,
    AgentLlmOAuthPollResponse,
    AgentLlmOAuthStartRequest,
    AgentLlmOAuthStartResponse,
)
from _routes._errors import HTTPError
from handlers.base import StateHandlerBase
from handlers.settings_handler import SettingsHandler
from services.agent_llm import catalog_entry
from services.agent_llm_oauth import (
    apply_oauth_tokens,
    clear_oauth_tokens,
    complete_oauth_code,
    new_oauth_provider,
    poll_oauth,
    refresh_oauth_tokens,
    start_oauth,
    supports_oauth,
)
from state.app_state_types import AgentLlmOAuthPending
from services.interfaces import HTTPClient
from state.app_settings import AgentLlmProviderKind, AgentLlmProviderSettings
from state.app_state_types import AppState

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

_KIND_VALUES: tuple[str, ...] = (
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
)


class AgentLlmOAuthHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        config: RuntimeConfig,
        http: HTTPClient,
        settings_handler: SettingsHandler,
    ) -> None:
        super().__init__(state, lock, config)
        self._http = http
        self._settings = settings_handler

    def start(self, req: AgentLlmOAuthStartRequest) -> AgentLlmOAuthStartResponse:
        kind = req.kind.strip()
        if kind not in _KIND_VALUES or not supports_oauth(kind):
            raise HTTPError(400, "AGENT_LLM_OAUTH_UNSUPPORTED")
        typed_kind = cast(AgentLlmProviderKind, kind)
        provider_id = req.providerId.strip()
        with self.lock:
            if provider_id:
                provider = self._provider(provider_id)
                if provider is None or provider.kind != typed_kind:
                    raise HTTPError(400, "AGENT_LLM_PROVIDER_INVALID")
        started = start_oauth(self._http, kind=typed_kind, provider_id=provider_id)
        with self.lock:
            self.state.agent_llm_oauth_pending = started.pending
        entry = catalog_entry(typed_kind)
        if started.flow == "code":
            message = f"Sign in to {entry.label}, then paste the code from the browser."
        elif started.user_code:
            message = f"Open the page and approve {entry.label} (code {started.user_code})."
        else:
            message = f"Complete {entry.label} sign-in in the browser."
        return AgentLlmOAuthStartResponse(
            sessionId=started.session_id,
            kind=started.kind,
            flow=started.flow,
            authorizeUrl=started.authorize_url,
            userCode=started.user_code,
            expiresIn=started.expires_in,
            message=message,
        )

    def poll(self, req: AgentLlmOAuthPollRequest) -> AgentLlmOAuthPollResponse:
        pending = self._require_pending(req.sessionId)
        if pending.flow == "code":
            return AgentLlmOAuthPollResponse(status="pending")
        status, tokens, next_pending = poll_oauth(self._http, pending)
        with self.lock:
            current = self.state.agent_llm_oauth_pending
            if current is None or current.session_id != pending.session_id:
                raise HTTPError(400, "AGENT_LLM_OAUTH_EXPIRED")
            if status == "authenticated" and tokens is not None:
                provider_id = self._persist_tokens(current, tokens)
                self.state.agent_llm_oauth_pending = None
                return AgentLlmOAuthPollResponse(status="authenticated", providerId=provider_id)
            if status == "pending":
                self.state.agent_llm_oauth_pending = next_pending
                return AgentLlmOAuthPollResponse(status="pending")
            self.state.agent_llm_oauth_pending = None
            return AgentLlmOAuthPollResponse(status=status, error="Sign-in was not completed.")

    def complete(self, req: AgentLlmOAuthCompleteRequest) -> AgentLlmOAuthPollResponse:
        pending = self._require_pending(req.sessionId)
        tokens = complete_oauth_code(self._http, pending, req.code)
        with self.lock:
            current = self.state.agent_llm_oauth_pending
            if current is None or current.session_id != pending.session_id:
                raise HTTPError(400, "AGENT_LLM_OAUTH_EXPIRED")
            provider_id = self._persist_tokens(current, tokens)
            self.state.agent_llm_oauth_pending = None
        return AgentLlmOAuthPollResponse(status="authenticated", providerId=provider_id)

    def cancel(self, req: AgentLlmOAuthCancelRequest) -> AgentLlmOAuthOkResponse:
        with self.lock:
            pending = self.state.agent_llm_oauth_pending
            if pending is not None and (not req.sessionId or req.sessionId == pending.session_id):
                self.state.agent_llm_oauth_pending = None
        return AgentLlmOAuthOkResponse()

    def disconnect(self, req: AgentLlmOAuthDisconnectRequest) -> AgentLlmOAuthOkResponse:
        provider_id = req.providerId.strip()
        with self.lock:
            providers = list(self.state.app_settings.agent_llm_providers)
            updated: list[AgentLlmProviderSettings] = []
            found = False
            for provider in providers:
                if provider.id == provider_id:
                    updated.append(clear_oauth_tokens(provider))
                    found = True
                else:
                    updated.append(provider)
            if not found:
                raise HTTPError(400, "AGENT_LLM_PROVIDER_INVALID")
            self.state.app_settings.agent_llm_providers = updated
            self._settings.save_settings()
        return AgentLlmOAuthOkResponse()

    def refresh_provider_if_needed(self, provider: AgentLlmProviderSettings) -> AgentLlmProviderSettings:
        tokens = refresh_oauth_tokens(self._http, provider)
        if tokens is None:
            return provider
        refreshed = apply_oauth_tokens(provider, tokens)
        with self.lock:
            self.state.app_settings.agent_llm_providers = [
                refreshed if item.id == provider.id else item
                for item in self.state.app_settings.agent_llm_providers
            ]
            self._settings.save_settings()
        return refreshed

    def _require_pending(self, session_id: str) -> AgentLlmOAuthPending:
        with self.lock:
            pending = self.state.agent_llm_oauth_pending
        if pending is None or pending.session_id != session_id.strip():
            raise HTTPError(400, "AGENT_LLM_OAUTH_EXPIRED")
        return pending

    def _provider(self, provider_id: str) -> AgentLlmProviderSettings | None:
        for provider in self.state.app_settings.agent_llm_providers:
            if provider.id == provider_id:
                return provider
        return None

    def _persist_tokens(self, pending: AgentLlmOAuthPending, tokens: object) -> str:
        from services.agent_llm_oauth import OAuthTokens

        assert isinstance(tokens, OAuthTokens)
        providers = list(self.state.app_settings.agent_llm_providers)
        if pending.provider_id:
            next_providers: list[AgentLlmProviderSettings] = []
            found = False
            for provider in providers:
                if provider.id == pending.provider_id:
                    next_providers.append(apply_oauth_tokens(provider, tokens))
                    found = True
                else:
                    next_providers.append(provider)
            if not found:
                created = new_oauth_provider(cast(AgentLlmProviderKind, pending.kind), tokens)
                created = created.model_copy(update={"id": pending.provider_id})
                next_providers.append(created)
            provider_id = pending.provider_id
            self.state.app_settings.agent_llm_providers = next_providers
        else:
            created = new_oauth_provider(cast(AgentLlmProviderKind, pending.kind), tokens)
            providers.append(created)
            self.state.app_settings.agent_llm_providers = providers
            self.state.app_settings.agent_llm_provider_id = created.id
            provider_id = created.id
        self._settings.save_settings()
        return provider_id
