"""Route handler for /api/agent/turn."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api_types import AgentLlmModelsRequest, AgentLlmModelsResponse, AgentTurnRequest, AgentTurnResponse
from state import get_state_service
from app_handler import AppHandler

router = APIRouter(prefix="/api", tags=["agent"])


@router.post("/agent/turn", response_model=AgentTurnResponse)
def route_agent_turn(
    req: AgentTurnRequest,
    handler: AppHandler = Depends(get_state_service),
) -> AgentTurnResponse:
    return handler.agent.run_turn(req)


@router.post("/agent/llm/models", response_model=AgentLlmModelsResponse)
def route_agent_llm_models(
    req: AgentLlmModelsRequest,
    handler: AppHandler = Depends(get_state_service),
) -> AgentLlmModelsResponse:
    return handler.settings.list_agent_llm_models(req)
