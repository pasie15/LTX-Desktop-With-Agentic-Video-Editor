"""ChatGPT Codex Responses transport for OpenAI OAuth (not chat/completions)."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, cast
from uuid import uuid4

from api_types import AgentMessagePayload, AgentToolDeclarationPayload
from _routes._errors import HTTPError
from services.interfaces import HTTPClient, HttpTransportError, JSONValue

if TYPE_CHECKING:
    from services.agent_llm import LlmFunctionCall, LlmTurnResult

CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses"
_CODEX_CLIENT_VERSION = "0.144.6"


def _json_object(value: object) -> dict[str, JSONValue]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, JSONValue] = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            result[key] = cast(JSONValue, item)
    return result


def responses_tools_from_declarations(
    declarations: list[AgentToolDeclarationPayload],
) -> list[JSONValue]:
    tools: list[JSONValue] = []
    for item in declarations:
        name = item.name.strip()
        if not name:
            continue
        tools.append(
            {
                "type": "function",
                "name": name,
                "description": item.description,
                "parameters": _json_object(item.parameters) or {"type": "object", "properties": {}},
            }
        )
    return tools


def responses_input_from_agent(messages: list[AgentMessagePayload]) -> list[JSONValue]:
    items: list[JSONValue] = []
    for message in messages:
        if message.role == "assistant":
            for part in message.parts:
                if part.type == "text" and part.text:
                    items.append(
                        {
                            "type": "message",
                            "role": "assistant",
                            "content": [{"type": "output_text", "text": part.text}],
                        }
                    )
                elif part.type == "tool_call" and part.toolName:
                    items.append(
                        {
                            "type": "function_call",
                            "call_id": (part.toolCallId or "").strip() or f"call_{uuid4().hex[:10]}",
                            "name": part.toolName,
                            "arguments": json.dumps(part.arguments or {}, ensure_ascii=False),
                        }
                    )
            continue

        if message.role == "tool" or any(part.type == "tool_result" for part in message.parts):
            for part in message.parts:
                if part.type != "tool_result":
                    continue
                payload = part.result if part.result is not None else {"ok": True}
                items.append(
                    {
                        "type": "function_call_output",
                        "call_id": (part.toolCallId or part.toolName or "").strip() or f"call_{uuid4().hex[:10]}",
                        "output": json.dumps(payload, ensure_ascii=False),
                    }
                )
            continue

        content: list[JSONValue] = []
        for part in message.parts:
            if part.type == "text" and part.text:
                content.append({"type": "input_text", "text": part.text})
            elif part.type == "inline_image" and part.data and part.mimeType:
                content.append(
                    {
                        "type": "input_image",
                        "image_url": f"data:{part.mimeType};base64,{part.data}",
                    }
                )
        if content:
            items.append({"type": "message", "role": "user", "content": content})
    if not items:
        raise HTTPError(400, "Agent turn has no usable message parts")
    return items


def parse_responses_output(payload: object) -> LlmTurnResult:
    from services.agent_llm import LlmTurnResult

    if not isinstance(payload, dict):
        raise HTTPError(500, "AGENT_LLM_PARSE_ERROR")
    output = cast(dict[str, object], payload).get("output")
    if not isinstance(output, list):
        return LlmTurnResult(text="", function_calls=())
    return _turn_from_output_items(cast(list[object], output))


def parse_responses_sse(text: str) -> LlmTurnResult:
    from services.agent_llm import LlmTurnResult

    text_chunks: list[str] = []
    calls: list[LlmFunctionCall] = []
    completed_output: list[object] | None = None
    buffer = text.replace("\r\n", "\n").replace("\r", "\n")
    for block in buffer.split("\n\n"):
        data_lines: list[str] = []
        for line in block.split("\n"):
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if not data_lines:
            continue
        joined = "\n".join(data_lines)
        if joined == "[DONE]":
            break
        try:
            parsed: object = json.loads(joined)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        fields = cast(dict[str, object], parsed)
        event_type = fields.get("type")
        if event_type == "response.output_text.delta":
            delta = fields.get("delta")
            if isinstance(delta, str) and delta:
                text_chunks.append(delta)
            continue
        if event_type == "response.output_item.done":
            item = fields.get("item")
            _collect_output_item(item, text_chunks, calls)
            continue
        if event_type == "response.completed":
            response = fields.get("response")
            if isinstance(response, dict):
                output = cast(dict[str, object], response).get("output")
                if isinstance(output, list) and output:
                    completed_output = cast(list[object], output)
    if completed_output:
        return _turn_from_output_items(completed_output)
    return LlmTurnResult(text="".join(text_chunks).strip(), function_calls=tuple(calls))


def _turn_from_output_items(items: list[object]) -> LlmTurnResult:
    from services.agent_llm import LlmTurnResult

    text_chunks: list[str] = []
    calls: list[LlmFunctionCall] = []
    for item in items:
        _collect_output_item(item, text_chunks, calls)
    return LlmTurnResult(text="".join(text_chunks).strip(), function_calls=tuple(calls))


def _collect_output_item(item: object, text_chunks: list[str], calls: list[LlmFunctionCall]) -> None:
    from services.agent_llm import LlmFunctionCall

    if not isinstance(item, dict):
        return
    fields = cast(dict[str, object], item)
    item_type = fields.get("type")
    if item_type == "message":
        content = fields.get("content")
        if not isinstance(content, list):
            return
        for part in cast(list[object], content):
            if not isinstance(part, dict):
                continue
            part_fields = cast(dict[str, object], part)
            text = part_fields.get("text")
            if isinstance(text, str) and text:
                text_chunks.append(text)
        return
    if item_type != "function_call":
        return
    name = fields.get("name")
    if not isinstance(name, str) or not name.strip():
        return
    args = fields.get("arguments")
    parsed_args: dict[str, JSONValue] = {}
    if isinstance(args, dict):
        parsed_args = _json_object(cast(dict[str, object], args))
    elif isinstance(args, str) and args.strip():
        try:
            loaded: object = json.loads(args)
        except json.JSONDecodeError:
            loaded = {}
        parsed_args = _json_object(loaded)
    call_id = fields.get("call_id") or fields.get("id")
    calls.append(
        LlmFunctionCall(
            name=name.strip(),
            args=parsed_args,
            call_id=call_id.strip() if isinstance(call_id, str) else "",
        )
    )


def call_codex_responses_turn(
    http: HTTPClient,
    *,
    access_token: str,
    account_id: str,
    model: str,
    messages: list[AgentMessagePayload],
    available_tools: list[AgentToolDeclarationPayload],
    system_instruction: str,
    timeout: int = 60,
) -> LlmTurnResult:
    if not model.strip():
        raise HTTPError(400, "AGENT_LLM_PROVIDER_INVALID")

    payload: dict[str, JSONValue] = {
        "model": model,
        "instructions": system_instruction,
        "input": responses_input_from_agent(messages),
        "store": False,
        "stream": True,
        "parallel_tool_calls": False,
    }
    tools = responses_tools_from_declarations(available_tools)
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "openai-beta": "responses=experimental",
        "originator": "ltx_desktop",
        "session_id": str(uuid4()),
    }
    if account_id.strip():
        headers["chatgpt-account-id"] = account_id.strip()

    url = f"{CODEX_RESPONSES_URL}?client_version={_CODEX_CLIENT_VERSION}"
    try:
        response = http.post(url, headers=headers, json_payload=payload, timeout=timeout)
    except HttpTransportError as exc:
        raise HTTPError(504, "Agent LLM request timed out") from exc

    if response.status_code in (401, 403):
        raise HTTPError(response.status_code, "Provider rejected the OAuth session", code="AGENT_LLM_INVALID_API_KEY")
    if response.status_code != 200:
        raise HTTPError(response.status_code, f"Agent LLM error: {response.text}")

    body_text = response.text
    if "event:" in body_text or "data:" in body_text:
        return parse_responses_sse(body_text)
    try:
        return parse_responses_output(response.json())
    except HTTPError:
        raise
    except Exception as exc:
        raise HTTPError(500, "AGENT_LLM_PARSE_ERROR") from exc
