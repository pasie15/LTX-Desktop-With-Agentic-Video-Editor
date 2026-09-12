"""Agent turn handler. Tools execute in the renderer; the model is the selected Settings provider."""

from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from typing import TYPE_CHECKING, cast
from uuid import uuid4

from pydantic import JsonValue

from api_types import (
    AgentAskUserQuestionPayload,
    AgentToolCallPayload,
    AgentTurnRequest,
    AgentTurnResponse,
)
from _routes._errors import HTTPError
from handlers.base import StateHandlerBase
from services.agent_llm import LlmFunctionCall, missing_key_code, resolve_agent_llm, run_agent_llm_turn
from services.interfaces import HTTPClient, JSONValue
from state.app_state_types import AppState

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

_INSTRUCTIONS_PATH = Path(__file__).with_name("agent_instructions.md")
_FALLBACK_INSTRUCTIONS = (
    "You are the LTX Desktop video editor agent. Answer from the project snapshot. "
    "Edit the timeline and generate with the provided tools. Time is seconds. Confirm before generate."
)
_ASK_USER_TOOL = "ask_user"


def load_default_agent_instructions() -> str:
    try:
        return _INSTRUCTIONS_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return _FALLBACK_INSTRUCTIONS


def parse_ask_user_questions(args: dict[str, JSONValue]) -> list[AgentAskUserQuestionPayload] | None:
    raw_questions = args.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        return None
    questions: list[AgentAskUserQuestionPayload] = []
    for index, item in enumerate(raw_questions):
        if not isinstance(item, dict):
            continue
        fields = cast(dict[str, object], item)
        prompt = fields.get("prompt")
        kind = fields.get("kind")
        if not isinstance(prompt, str) or not prompt.strip():
            continue
        if kind not in ("choice", "text"):
            continue
        question_id = fields.get("id")
        options_raw = fields.get("options")
        options: list[str] | None = None
        if isinstance(options_raw, list):
            options = [
                option
                for option in cast(list[object], options_raw)
                if isinstance(option, str) and option.strip()
            ]
        questions.append(
            AgentAskUserQuestionPayload(
                id=question_id.strip() if isinstance(question_id, str) and question_id.strip() else f"q{index + 1}",
                prompt=prompt.strip(),
                kind=kind,
                options=options,
                allowMultiple=fields.get("allowMultiple") is True,
            )
        )
    return questions or None


def _system_instruction(skills: str | None, project_context: dict[str, object]) -> str:
    instructions = (skills or "").strip() or load_default_agent_instructions()
    snapshot = json.dumps(project_context, ensure_ascii=False, separators=(",", ":"))
    return (
        f"{instructions}\n\n"
        "## Current project snapshot\n"
        "Trust this snapshot for this user send. Re-read with tools if something looks stale.\n"
        f"```json\n{snapshot}\n```"
    )


class AgentHandler(StateHandlerBase):
    def __init__(self, state: AppState, lock: RLock, config: RuntimeConfig, http: HTTPClient) -> None:
        super().__init__(state, lock, config)
        self._http = http

    def run_turn(self, req: AgentTurnRequest) -> AgentTurnResponse:
        with self.lock:
            settings = self.state.app_settings.model_copy(deep=True)
        resolved = resolve_agent_llm(settings, req.model)
        if not resolved.api_key:
            raise HTTPError(400, missing_key_code(resolved))

        allowed_names = {item.name.strip() for item in req.availableTools if item.name.strip()}
        system_instruction = _system_instruction(req.skills, dict(req.projectContext))

        try:
            result = run_agent_llm_turn(
                self._http,
                resolved,
                messages=req.messages,
                available_tools=req.availableTools,
                system_instruction=system_instruction,
            )
        except HTTPError:
            raise
        except Exception as exc:
            raise HTTPError(500, str(exc)) from exc

        ask_user = _collect_ask_user(result.function_calls, allowed_names)
        if ask_user:
            return AgentTurnResponse(
                text=result.text,
                askUser=ask_user,
                finishReason="ask_user",
            )

        tool_calls = [
            AgentToolCallPayload(
                id=call.call_id or f"call_{uuid4().hex[:10]}",
                name=call.name,
                arguments=cast(dict[str, JsonValue], call.args),
            )
            for call in result.function_calls
            if call.name in allowed_names and call.name != _ASK_USER_TOOL
        ]
        if tool_calls:
            return AgentTurnResponse(
                text=result.text,
                toolCalls=tool_calls,
                finishReason="tool_calls",
            )
        return AgentTurnResponse(text=result.text, finishReason="stop")


def _collect_ask_user(
    function_calls: tuple[LlmFunctionCall, ...],
    allowed_names: set[str],
) -> list[AgentAskUserQuestionPayload] | None:
    if _ASK_USER_TOOL not in allowed_names:
        return None
    questions: list[AgentAskUserQuestionPayload] = []
    for call in function_calls:
        if call.name != _ASK_USER_TOOL:
            continue
        parsed = parse_ask_user_questions(call.args)
        if parsed:
            questions.extend(parsed)
    return questions or None
