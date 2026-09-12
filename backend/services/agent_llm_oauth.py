"""Real OAuth / device-connect flows for Agent LLM providers.

Tokens come only from the provider token endpoint. Nothing here invents a
credential. API keys remain a fallback on the same Settings provider row.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Literal, cast
from urllib.parse import urlencode, urlparse, urlunparse
from uuid import uuid4

from _routes._errors import HTTPError
from services.agent_llm import catalog_entry
from services.interfaces import HTTPClient, HttpTransportError, JSONValue
from state.app_settings import AgentLlmProviderKind, AgentLlmProviderSettings, OAUTH_AGENT_LLM_KINDS
from state.app_state_types import AgentLlmOAuthPending

OAuthFlow = Literal["device", "code"]

OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
OPENAI_DEVICE_USERCODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode"
OPENAI_DEVICE_POLL_URL = "https://auth.openai.com/api/accounts/deviceauth/token"
OPENAI_DEVICE_VERIFY_URL = "https://auth.openai.com/codex/device"
OPENAI_DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback"
OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token"
OPENAI_OAUTH_SCOPE = "openid profile email offline_access"

ANTHROPIC_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
ANTHROPIC_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
ANTHROPIC_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
ANTHROPIC_OAUTH_SCOPE = "org:create_api_key user:profile user:inference"

MINIMAX_OAUTH_CODE_URL = "https://api.minimax.io/oauth/code"
MINIMAX_OAUTH_TOKEN_URL = "https://api.minimax.io/oauth/token"
MINIMAX_OAUTH_SCOPE = "group_id profile model.completion"
MINIMAX_OAUTH_GRANT = "urn:ietf:params:oauth:grant-type:user_code"

XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
XAI_DEVICE_URL = "https://auth.x.ai/oauth2/device/code"
XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token"
XAI_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access"

KIMI_OAUTH_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098"
KIMI_DEVICE_URL = "https://auth.kimi.com/api/oauth/device_authorization"
KIMI_TOKEN_URL = "https://auth.kimi.com/api/oauth/token"
KIMI_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"

_REFRESH_MARGIN_SECONDS = 120
_DEFAULT_DEVICE_INTERVAL = 5
_DEFAULT_DEVICE_EXPIRES = 900


@dataclass(frozen=True, slots=True)
class OAuthStartResult:
    session_id: str
    kind: AgentLlmProviderKind
    flow: OAuthFlow
    authorize_url: str
    user_code: str
    expires_in: int
    pending: AgentLlmOAuthPending


@dataclass(frozen=True, slots=True)
class OAuthTokens:
    access_token: str
    refresh_token: str = ""
    expires_at: float = 0.0
    account_id: str = ""
    account_label: str = ""


def supports_oauth(kind: str) -> bool:
    return kind in OAUTH_AGENT_LLM_KINDS


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    return verifier, challenge


def _b64url_json(segment: str) -> dict[str, object]:
    padding = "=" * (-len(segment) % 4)
    try:
        raw = base64.urlsafe_b64decode(segment + padding)
        parsed: object = json.loads(raw.decode("utf-8"))
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return cast(dict[str, object], parsed)


def openai_account_id_from_token(token: str) -> str:
    parts = token.split(".")
    if len(parts) < 2:
        return ""
    payload = _b64url_json(parts[1])
    auth = payload.get("https://api.openai.com/auth")
    if isinstance(auth, dict):
        account_id = cast(dict[str, object], auth).get("chatgpt_account_id")
        if isinstance(account_id, str):
            return account_id
    return ""


def openai_email_from_token(token: str) -> str:
    parts = token.split(".")
    if len(parts) < 2:
        return ""
    payload = _b64url_json(parts[1])
    email = payload.get("email")
    return email if isinstance(email, str) else ""


def _as_int(value: object, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return default


def _json_object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    return cast(dict[str, object], value)


def _response_payload(response: object) -> dict[str, object]:
    json_fn = getattr(response, "json", None)
    if callable(json_fn):
        try:
            return _json_object(json_fn())
        except Exception:
            return {}
    return {}


def _rewrite_minimax_verification_uri(uri: str) -> str:
    parsed = urlparse(uri)
    host = parsed.netloc.lower()
    if host == "www.minimax.io":
        return urlunparse(parsed._replace(netloc="platform.minimax.io"))
    if host == "www.minimaxi.com":
        return urlunparse(parsed._replace(netloc="platform.minimaxi.com"))
    return uri


def _post_json(http: HTTPClient, url: str, payload: dict[str, JSONValue], timeout: int = 30) -> tuple[int, dict[str, object]]:
    try:
        response = http.post(url, headers={"Content-Type": "application/json"}, json_payload=payload, timeout=timeout)
    except HttpTransportError as exc:
        raise HTTPError(504, "AGENT_LLM_OAUTH_FAILED") from exc
    return response.status_code, _response_payload(response)


def _post_form(http: HTTPClient, url: str, payload: dict[str, str], timeout: int = 30) -> tuple[int, dict[str, object]]:
    try:
        response = http.post(
            url,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=payload,
            timeout=timeout,
        )
    except HttpTransportError as exc:
        raise HTTPError(504, "AGENT_LLM_OAUTH_FAILED") from exc
    return response.status_code, _response_payload(response)


def start_oauth(
    http: HTTPClient,
    *,
    kind: AgentLlmProviderKind,
    provider_id: str,
    now: float | None = None,
) -> OAuthStartResult:
    if not supports_oauth(kind):
        raise HTTPError(400, "AGENT_LLM_OAUTH_UNSUPPORTED")
    started = now if now is not None else time.time()
    if kind == "openai":
        return _start_openai(http, provider_id, started)
    if kind == "anthropic":
        return _start_anthropic(provider_id, started)
    if kind == "minimax":
        return _start_minimax(http, provider_id, started)
    if kind == "xai":
        return _start_xai(http, provider_id, started)
    return _start_kimi(http, provider_id, started)


def _start_openai(http: HTTPClient, provider_id: str, started: float) -> OAuthStartResult:
    status, body = _post_json(http, OPENAI_DEVICE_USERCODE_URL, {"client_id": OPENAI_OAUTH_CLIENT_ID})
    if status != 200:
        raise HTTPError(502, "AGENT_LLM_OAUTH_FAILED")
    device_auth_id = str(body.get("device_auth_id") or "")
    user_code = str(body.get("user_code") or body.get("usercode") or "")
    if not device_auth_id or not user_code:
        raise HTTPError(502, "AGENT_LLM_OAUTH_FAILED")
    interval = _as_int(body.get("interval"), _DEFAULT_DEVICE_INTERVAL)
    expires_in = _as_int(body.get("expires_in"), _DEFAULT_DEVICE_EXPIRES)
    session_id = f"oauth_{uuid4().hex}"
    pending = AgentLlmOAuthPending(
        session_id=session_id,
        kind="openai",
        provider_id=provider_id,
        flow="device",
        created_at=started,
        expires_at=started + expires_in,
        poll_after=started + max(interval, 1),
        code_verifier="",
        state="",
        device_code=device_auth_id,
        user_code=user_code,
        redirect_uri=OPENAI_DEVICE_REDIRECT_URI,
    )
    return OAuthStartResult(
        session_id=session_id,
        kind="openai",
        flow="device",
        authorize_url=OPENAI_DEVICE_VERIFY_URL,
        user_code=user_code,
        expires_in=expires_in,
        pending=pending,
    )


def _start_anthropic(provider_id: str, started: float) -> OAuthStartResult:
    verifier, challenge = _pkce_pair()
    # Claude Code requires state == verifier.
    params = urlencode(
        {
            "code": "true",
            "client_id": ANTHROPIC_OAUTH_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": ANTHROPIC_REDIRECT_URI,
            "scope": ANTHROPIC_OAUTH_SCOPE,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": verifier,
        }
    )
    session_id = f"oauth_{uuid4().hex}"
    pending = AgentLlmOAuthPending(
        session_id=session_id,
        kind="anthropic",
        provider_id=provider_id,
        flow="code",
        created_at=started,
        expires_at=started + _DEFAULT_DEVICE_EXPIRES,
        poll_after=started,
        code_verifier=verifier,
        state=verifier,
        device_code="",
        user_code="",
        redirect_uri=ANTHROPIC_REDIRECT_URI,
    )
    return OAuthStartResult(
        session_id=session_id,
        kind="anthropic",
        flow="code",
        authorize_url=f"{ANTHROPIC_AUTHORIZE_URL}?{params}",
        user_code="",
        expires_in=_DEFAULT_DEVICE_EXPIRES,
        pending=pending,
    )


def _start_minimax(http: HTTPClient, provider_id: str, started: float) -> OAuthStartResult:
    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(32)
    status, body = _post_form(
        http,
        MINIMAX_OAUTH_CODE_URL,
        {
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
            "scope": MINIMAX_OAUTH_SCOPE,
            "grant_type": MINIMAX_OAUTH_GRANT,
        },
    )
    if status != 200:
        raise HTTPError(502, "AGENT_LLM_OAUTH_FAILED")
    user_code = str(body.get("user_code") or "")
    verification = str(body.get("verification_uri") or body.get("verification_uri_complete") or "")
    if not user_code or not verification:
        raise HTTPError(502, "AGENT_LLM_OAUTH_FAILED")
    verification = _rewrite_minimax_verification_uri(verification)
    expires_in = _as_int(body.get("expires_in"), _DEFAULT_DEVICE_EXPIRES)
    interval = _as_int(body.get("interval"), _DEFAULT_DEVICE_INTERVAL)
    session_id = f"oauth_{uuid4().hex}"
    pending = AgentLlmOAuthPending(
        session_id=session_id,
        kind="minimax",
        provider_id=provider_id,
        flow="device",
        created_at=started,
        expires_at=started + expires_in,
        poll_after=started + max(interval, 1),
        code_verifier=verifier,
        state=state,
        device_code=user_code,
        user_code=user_code,
        redirect_uri="",
    )
    return OAuthStartResult(
        session_id=session_id,
        kind="minimax",
        flow="device",
        authorize_url=verification,
        user_code=user_code,
        expires_in=expires_in,
        pending=pending,
    )


def _start_xai(http: HTTPClient, provider_id: str, started: float) -> OAuthStartResult:
    status, body = _post_form(
        http,
        XAI_DEVICE_URL,
        {"client_id": XAI_OAUTH_CLIENT_ID, "scope": XAI_OAUTH_SCOPE},
    )
    if status != 200:
        raise HTTPError(502, "AGENT_LLM_OAUTH_FAILED")
    device_code = str(body.get("device_code") or "")
    user_code = str(body.get("user_code") or "")
    verification = str(body.get("verification_uri_complete") or body.get("verification_uri") or "")
    if not device_code or not verification:
        raise HTTPError(502, "AGENT_LLM_OAUTH_FAILED")
    expires_in = _as_int(body.get("expires_in"), _DEFAULT_DEVICE_EXPIRES)
    interval = _as_int(body.get("interval"), _DEFAULT_DEVICE_INTERVAL)
    session_id = f"oauth_{uuid4().hex}"
    pending = AgentLlmOAuthPending(
        session_id=session_id,
        kind="xai",
        provider_id=provider_id,
        flow="device",
        created_at=started,
        expires_at=started + expires_in,
        poll_after=started + max(interval, 1),
        code_verifier="",
        state="",
        device_code=device_code,
        user_code=user_code,
        redirect_uri="",
    )
    return OAuthStartResult(
        session_id=session_id,
        kind="xai",
        flow="device",
        authorize_url=verification,
        user_code=user_code,
        expires_in=expires_in,
        pending=pending,
    )


def _start_kimi(http: HTTPClient, provider_id: str, started: float) -> OAuthStartResult:
    status, body = _post_form(http, KIMI_DEVICE_URL, {"client_id": KIMI_OAUTH_CLIENT_ID})
    if status != 200:
        raise HTTPError(502, "AGENT_LLM_OAUTH_FAILED")
    device_code = str(body.get("device_code") or "")
    user_code = str(body.get("user_code") or "")
    verification = str(body.get("verification_uri_complete") or body.get("verification_uri") or "")
    if not device_code or not verification:
        raise HTTPError(502, "AGENT_LLM_OAUTH_FAILED")
    expires_in = _as_int(body.get("expires_in"), _DEFAULT_DEVICE_EXPIRES)
    interval = _as_int(body.get("interval"), _DEFAULT_DEVICE_INTERVAL)
    session_id = f"oauth_{uuid4().hex}"
    pending = AgentLlmOAuthPending(
        session_id=session_id,
        kind="moonshot",
        provider_id=provider_id,
        flow="device",
        created_at=started,
        expires_at=started + expires_in,
        poll_after=started + max(interval, 1),
        code_verifier="",
        state="",
        device_code=device_code,
        user_code=user_code,
        redirect_uri="",
    )
    return OAuthStartResult(
        session_id=session_id,
        kind="moonshot",
        flow="device",
        authorize_url=verification,
        user_code=user_code,
        expires_in=expires_in,
        pending=pending,
    )


def poll_oauth(
    http: HTTPClient,
    pending: AgentLlmOAuthPending,
    *,
    now: float | None = None,
) -> tuple[Literal["pending", "authenticated", "expired", "error"], OAuthTokens | None, AgentLlmOAuthPending]:
    current = now if now is not None else time.time()
    if current > pending.expires_at:
        return "expired", None, pending
    if pending.kind == "openai":
        return _poll_openai(http, pending, current)
    if pending.kind == "minimax":
        return _poll_minimax(http, pending, current)
    if pending.kind == "xai":
        return _poll_xai(http, pending, current)
    if pending.kind == "moonshot":
        return _poll_kimi(http, pending, current)
    return "pending", None, pending


def complete_oauth_code(
    http: HTTPClient,
    pending: AgentLlmOAuthPending,
    pasted: str,
    *,
    now: float | None = None,
) -> OAuthTokens:
    current = now if now is not None else time.time()
    if pending.flow != "code" or pending.kind != "anthropic":
        raise HTTPError(400, "AGENT_LLM_OAUTH_FAILED")
    if current > pending.expires_at:
        raise HTTPError(400, "AGENT_LLM_OAUTH_EXPIRED")
    raw = pasted.strip()
    code, _, returned_state = raw.partition("#")
    code = code.strip()
    returned_state = returned_state.strip()
    if not code:
        raise HTTPError(400, "AGENT_LLM_OAUTH_FAILED")
    if returned_state and not hmac.compare_digest(returned_state, pending.state):
        raise HTTPError(400, "AGENT_LLM_OAUTH_FAILED")
    status, body = _post_json(
        http,
        ANTHROPIC_TOKEN_URL,
        {
            "grant_type": "authorization_code",
            "client_id": ANTHROPIC_OAUTH_CLIENT_ID,
            "code": code,
            "code_verifier": pending.code_verifier,
            "redirect_uri": pending.redirect_uri,
            "state": pending.state,
        },
    )
    if status != 200:
        raise HTTPError(502, "AGENT_LLM_OAUTH_FAILED")
    return _tokens_from_body(body, current)


def refresh_oauth_tokens(
    http: HTTPClient,
    provider: AgentLlmProviderSettings,
    *,
    now: float | None = None,
) -> OAuthTokens | None:
    if not provider.oauth_refresh_token.strip():
        return None
    current = now if now is not None else time.time()
    if provider.oauth_expires_at > 0 and provider.oauth_expires_at - current > _REFRESH_MARGIN_SECONDS:
        return None
    if provider.kind == "openai":
        status, body = _post_form(
            http,
            OPENAI_TOKEN_URL,
            {
                "grant_type": "refresh_token",
                "client_id": OPENAI_OAUTH_CLIENT_ID,
                "refresh_token": provider.oauth_refresh_token,
                "scope": OPENAI_OAUTH_SCOPE,
            },
        )
    elif provider.kind == "anthropic":
        status, body = _post_json(
            http,
            ANTHROPIC_TOKEN_URL,
            {
                "grant_type": "refresh_token",
                "client_id": ANTHROPIC_OAUTH_CLIENT_ID,
                "refresh_token": provider.oauth_refresh_token,
            },
        )
    elif provider.kind == "minimax":
        status, body = _post_form(
            http,
            MINIMAX_OAUTH_TOKEN_URL,
            {"grant_type": "refresh_token", "refresh_token": provider.oauth_refresh_token},
        )
    elif provider.kind == "xai":
        status, body = _post_form(
            http,
            XAI_TOKEN_URL,
            {
                "grant_type": "refresh_token",
                "client_id": XAI_OAUTH_CLIENT_ID,
                "refresh_token": provider.oauth_refresh_token,
            },
        )
    elif provider.kind == "moonshot":
        status, body = _post_form(
            http,
            KIMI_TOKEN_URL,
            {
                "client_id": KIMI_OAUTH_CLIENT_ID,
                "grant_type": "refresh_token",
                "refresh_token": provider.oauth_refresh_token,
            },
        )
    else:
        return None
    if status != 200:
        raise HTTPError(401, "AGENT_LLM_OAUTH_FAILED")
    tokens = _tokens_from_body(body, current, fallback_refresh=provider.oauth_refresh_token)
    if provider.kind == "openai" and not tokens.account_id:
        tokens = OAuthTokens(
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            expires_at=tokens.expires_at,
            account_id=provider.oauth_account_id,
            account_label=tokens.account_label or provider.oauth_account_label,
        )
    return tokens


def apply_oauth_tokens(provider: AgentLlmProviderSettings, tokens: OAuthTokens) -> AgentLlmProviderSettings:
    entry = catalog_entry(provider.kind)
    return provider.model_copy(
        update={
            "auth_mode": "oauth",
            "oauth_access_token": tokens.access_token,
            "oauth_refresh_token": tokens.refresh_token or provider.oauth_refresh_token,
            "oauth_expires_at": tokens.expires_at,
            "oauth_account_id": tokens.account_id or provider.oauth_account_id,
            "oauth_account_label": tokens.account_label or provider.oauth_account_label,
            "label": provider.label or tokens.account_label or entry.label,
        }
    )


def clear_oauth_tokens(provider: AgentLlmProviderSettings) -> AgentLlmProviderSettings:
    return provider.model_copy(
        update={
            "auth_mode": "api_key",
            "oauth_access_token": "",
            "oauth_refresh_token": "",
            "oauth_expires_at": 0.0,
            "oauth_account_id": "",
            "oauth_account_label": "",
        }
    )


def new_oauth_provider(kind: AgentLlmProviderKind, tokens: OAuthTokens) -> AgentLlmProviderSettings:
    entry = catalog_entry(kind)
    return AgentLlmProviderSettings(
        id=f"prov_{uuid4()}",
        kind=kind,
        label=tokens.account_label or entry.label,
        model=entry.default_model,
        base_url="",
        auth_mode="oauth",
        oauth_access_token=tokens.access_token,
        oauth_refresh_token=tokens.refresh_token,
        oauth_expires_at=tokens.expires_at,
        oauth_account_id=tokens.account_id,
        oauth_account_label=tokens.account_label,
    )


def _poll_openai(
    http: HTTPClient,
    pending: AgentLlmOAuthPending,
    current: float,
) -> tuple[Literal["pending", "authenticated", "expired", "error"], OAuthTokens | None, AgentLlmOAuthPending]:
    status, body = _post_json(
        http,
        OPENAI_DEVICE_POLL_URL,
        {"device_auth_id": pending.device_code, "user_code": pending.user_code},
    )
    error = str(body.get("error") or "")
    if error == "slow_down" or status in (403, 404) or error == "authorization_pending":
        extra = 5 if error == "slow_down" else 0
        return "pending", None, _bump_poll(pending, current, extra)
    if error in ("access_denied", "expired_token"):
        return "error" if error == "access_denied" else "expired", None, pending
    auth_code = str(body.get("authorization_code") or body.get("code") or "")
    verifier = str(body.get("code_verifier") or "")
    if status != 200 or not auth_code or not verifier:
        return "pending", None, _bump_poll(pending, current, 0)
    token_status, token_body = _post_form(
        http,
        OPENAI_TOKEN_URL,
        {
            "grant_type": "authorization_code",
            "client_id": OPENAI_OAUTH_CLIENT_ID,
            "code": auth_code,
            "code_verifier": verifier,
            "redirect_uri": pending.redirect_uri,
        },
    )
    if token_status != 200:
        return "error", None, pending
    return "authenticated", _tokens_from_openai_body(token_body, current), pending


def _poll_minimax(
    http: HTTPClient,
    pending: AgentLlmOAuthPending,
    current: float,
) -> tuple[Literal["pending", "authenticated", "expired", "error"], OAuthTokens | None, AgentLlmOAuthPending]:
    status, body = _post_form(
        http,
        MINIMAX_OAUTH_TOKEN_URL,
        {
            "grant_type": MINIMAX_OAUTH_GRANT,
            "user_code": pending.user_code,
            "code_verifier": pending.code_verifier,
            "state": pending.state,
        },
    )
    return _device_poll_result(status, body, pending, current)


def _poll_xai(
    http: HTTPClient,
    pending: AgentLlmOAuthPending,
    current: float,
) -> tuple[Literal["pending", "authenticated", "expired", "error"], OAuthTokens | None, AgentLlmOAuthPending]:
    status, body = _post_form(
        http,
        XAI_TOKEN_URL,
        {
            "grant_type": KIMI_DEVICE_GRANT,
            "client_id": XAI_OAUTH_CLIENT_ID,
            "device_code": pending.device_code,
        },
    )
    return _device_poll_result(status, body, pending, current)


def _poll_kimi(
    http: HTTPClient,
    pending: AgentLlmOAuthPending,
    current: float,
) -> tuple[Literal["pending", "authenticated", "expired", "error"], OAuthTokens | None, AgentLlmOAuthPending]:
    status, body = _post_form(
        http,
        KIMI_TOKEN_URL,
        {
            "client_id": KIMI_OAUTH_CLIENT_ID,
            "device_code": pending.device_code,
            "grant_type": KIMI_DEVICE_GRANT,
        },
    )
    return _device_poll_result(status, body, pending, current)


def _device_poll_result(
    status: int,
    body: dict[str, object],
    pending: AgentLlmOAuthPending,
    current: float,
) -> tuple[Literal["pending", "authenticated", "expired", "error"], OAuthTokens | None, AgentLlmOAuthPending]:
    error = str(body.get("error") or "")
    if error == "authorization_pending" or status in (400, 403, 404):
        extra = 5 if error == "slow_down" else 0
        if error in ("access_denied", "authorization_denied"):
            return "error", None, pending
        if error == "expired_token":
            return "expired", None, pending
        return "pending", None, _bump_poll(pending, current, extra)
    if error == "slow_down":
        return "pending", None, _bump_poll(pending, current, 5)
    if error in ("access_denied", "authorization_denied"):
        return "error", None, pending
    if error == "expired_token":
        return "expired", None, pending
    if status != 200 or not str(body.get("access_token") or ""):
        return "pending", None, _bump_poll(pending, current, 0)
    return "authenticated", _tokens_from_body(body, current), pending


def _bump_poll(pending: AgentLlmOAuthPending, current: float, extra: int) -> AgentLlmOAuthPending:
    return AgentLlmOAuthPending(
        session_id=pending.session_id,
        kind=pending.kind,
        provider_id=pending.provider_id,
        flow=pending.flow,
        created_at=pending.created_at,
        expires_at=pending.expires_at,
        poll_after=current + _DEFAULT_DEVICE_INTERVAL + extra,
        code_verifier=pending.code_verifier,
        state=pending.state,
        device_code=pending.device_code,
        user_code=pending.user_code,
        redirect_uri=pending.redirect_uri,
    )


def _tokens_from_body(
    body: dict[str, object],
    current: float,
    *,
    fallback_refresh: str = "",
) -> OAuthTokens:
    access = str(body.get("access_token") or "").strip()
    if not access:
        raise HTTPError(502, "AGENT_LLM_OAUTH_FAILED")
    refresh = str(body.get("refresh_token") or "").strip() or fallback_refresh
    expires_in = body.get("expires_in")
    expires_at = current + (float(expires_in) if isinstance(expires_in, (int, float)) else 3600)
    account_id = str(body.get("account_id") or "")
    account_label = str(body.get("email") or body.get("username") or "")
    return OAuthTokens(
        access_token=access,
        refresh_token=refresh,
        expires_at=expires_at,
        account_id=account_id,
        account_label=account_label,
    )


def _tokens_from_openai_body(body: dict[str, object], current: float) -> OAuthTokens:
    tokens = _tokens_from_body(body, current)
    id_token = str(body.get("id_token") or "")
    source = id_token or tokens.access_token
    return OAuthTokens(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_at=tokens.expires_at,
        account_id=openai_account_id_from_token(source),
        account_label=openai_email_from_token(source),
    )
