"""Agent LLM OAuth connect routes — start, poll, complete, cancel, disconnect."""

from __future__ import annotations

from fastapi import APIRouter, Depends

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
from app_handler import AppHandler
from state import get_state_service

router = APIRouter(prefix="/api/agent/llm/oauth", tags=["agent_llm_oauth"])


@router.post("/start", response_model=AgentLlmOAuthStartResponse)
def route_agent_llm_oauth_start(
    req: AgentLlmOAuthStartRequest,
    handler: AppHandler = Depends(get_state_service),
) -> AgentLlmOAuthStartResponse:
    return handler.agent_llm_oauth.start(req)


@router.post("/poll", response_model=AgentLlmOAuthPollResponse)
def route_agent_llm_oauth_poll(
    req: AgentLlmOAuthPollRequest,
    handler: AppHandler = Depends(get_state_service),
) -> AgentLlmOAuthPollResponse:
    return handler.agent_llm_oauth.poll(req)


@router.post("/complete", response_model=AgentLlmOAuthPollResponse)
def route_agent_llm_oauth_complete(
    req: AgentLlmOAuthCompleteRequest,
    handler: AppHandler = Depends(get_state_service),
) -> AgentLlmOAuthPollResponse:
    return handler.agent_llm_oauth.complete(req)


@router.post("/cancel", response_model=AgentLlmOAuthOkResponse)
def route_agent_llm_oauth_cancel(
    req: AgentLlmOAuthCancelRequest,
    handler: AppHandler = Depends(get_state_service),
) -> AgentLlmOAuthOkResponse:
    return handler.agent_llm_oauth.cancel(req)


@router.post("/disconnect", response_model=AgentLlmOAuthOkResponse)
def route_agent_llm_oauth_disconnect(
    req: AgentLlmOAuthDisconnectRequest,
    handler: AppHandler = Depends(get_state_service),
) -> AgentLlmOAuthOkResponse:
    return handler.agent_llm_oauth.disconnect(req)
