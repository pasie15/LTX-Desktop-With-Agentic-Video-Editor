"""Agent turn handler (Gemini function calling). Tools execute in the renderer."""

from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from typing import TYPE_CHECKING, cast
from uuid import uuid4

from pydantic import JsonValue

from api_types import (
    AgentAskUserQuestionPayload,
    AgentMessagePayload,
    AgentToolCallPayload,
    AgentToolDeclarationPayload,
    AgentTurnRequest,
    AgentTurnResponse,
)
from _routes._errors import HTTPError
from handlers.base import StateHandlerBase
from services.gemini_text_client import (
    GeminiFunctionCall,
    apply_gemini_thinking_config,
    call_gemini_generate_content_turn,
    resolve_gemini_model,
)
from services.interfaces import HTTPClient, JSONValue
from state.app_state_types import AppState

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

_INSTRUCTIONS_PATH = Path(__file__).with_name("agent_instructions.md")
_FALLBACK_INSTRUCTIONS = (
    "You are the LTX Desktop video editor agent. Answer from the project snapshot. "
    "Edit the timeline with the provided tools. Time is seconds. Generate is not enabled yet."
)
_ASK_USER_TOOL = "ask_user"


def load_default_agent_instructions() -> str:
    try:
        return _INSTRUCTIONS_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return _FALLBACK_INSTRUCTIONS


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


def gemini_tools_from_declarations(
    declarations: list[AgentToolDeclarationPayload],
) -> list[JSONValue] | None:
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
            api_key = self.state.app_settings.gemini_api_key
            stored_model = req.model or self.state.app_settings.gemini_model
        if not api_key:
            raise HTTPError(400, "GEMINI_API_KEY_MISSING")

        contents = contents_from_messages(req.messages)
        allowed_names = {item.name.strip() for item in req.availableTools if item.name.strip()}
        tools = gemini_tools_from_declarations(req.availableTools)
        resolved_model = resolve_gemini_model(stored_model)
        system_instruction = _system_instruction(req.skills, dict(req.projectContext))

        try:
            result = call_gemini_generate_content_turn(
                self._http,
                api_key=api_key,
                model=resolved_model,
                contents=contents,
                system_instruction=system_instruction,
                tools=tools,
                generation_config=apply_gemini_thinking_config(
                    resolved_model,
                    {"temperature": 0.4, "maxOutputTokens": 2048},
                ),
                timeout=60,
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
                id=f"call_{uuid4().hex[:10]}",
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
    function_calls: tuple[GeminiFunctionCall, ...],
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
