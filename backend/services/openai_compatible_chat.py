"""OpenAI-compatible chat completions with tool calls (OpenAI, OpenRouter, Z.ai, …)."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, cast
from uuid import uuid4

from api_types import AgentMessagePayload, AgentToolDeclarationPayload
from _routes._errors import HTTPError
from services.interfaces import HTTPClient, HttpTransportError, JSONValue

if TYPE_CHECKING:
    from services.agent_llm import LlmFunctionCall, LlmTurnResult


def openai_chat_completions_url(base_url: str) -> str:
    stripped = base_url.strip().rstrip("/")
    if stripped.endswith("/chat/completions"):
        return stripped
    return f"{stripped}/chat/completions"


def _json_object(value: object) -> dict[str, JSONValue]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, JSONValue] = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            result[key] = cast(JSONValue, item)
    return result


def openai_tools_from_declarations(
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
                "function": {
                    "name": name,
                    "description": item.description,
                    "parameters": _json_object(item.parameters) or {"type": "object", "properties": {}},
                },
            }
        )
    return tools


def openai_messages_from_agent(
    messages: list[AgentMessagePayload],
    system_instruction: str,
) -> list[JSONValue]:
    converted: list[JSONValue] = [{"role": "system", "content": system_instruction}]
    for message in messages:
        if message.role == "assistant":
            text_chunks: list[str] = []
            tool_calls: list[JSONValue] = []
            for part in message.parts:
                if part.type == "text" and part.text:
                    text_chunks.append(part.text)
                elif part.type == "tool_call" and part.toolName:
                    call_id = (part.toolCallId or "").strip() or f"call_{uuid4().hex[:10]}"
                    tool_calls.append(
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": part.toolName,
                                "arguments": json.dumps(part.arguments or {}, ensure_ascii=False),
                            },
                        }
                    )
            if not text_chunks and not tool_calls:
                continue
            assistant: dict[str, JSONValue] = {"role": "assistant"}
            if text_chunks:
                assistant["content"] = "".join(text_chunks)
            if tool_calls:
                assistant["tool_calls"] = tool_calls
            converted.append(assistant)
            continue

        if message.role == "tool" or any(part.type == "tool_result" for part in message.parts):
            for part in message.parts:
                if part.type != "tool_result":
                    continue
                payload = part.result if part.result is not None else {"ok": True}
                converted.append(
                    {
                        "role": "tool",
                        "tool_call_id": (part.toolCallId or part.toolName or "").strip() or f"call_{uuid4().hex[:10]}",
                        "content": json.dumps(payload, ensure_ascii=False),
                    }
                )
            continue

        content_parts: list[JSONValue] = []
        for part in message.parts:
            if part.type == "text" and part.text:
                content_parts.append({"type": "text", "text": part.text})
            elif part.type == "inline_image" and part.data and part.mimeType:
                content_parts.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{part.mimeType};base64,{part.data}"},
                    }
                )
        if content_parts:
            converted.append({"role": "user", "content": content_parts})

    if len(converted) < 2:
        raise HTTPError(400, "Agent turn has no usable message parts")
    return converted


def parse_openai_turn_payload(payload: object) -> LlmTurnResult:
    from services.agent_llm import LlmFunctionCall, LlmTurnResult

    if not isinstance(payload, dict):
        raise HTTPError(500, "AGENT_LLM_PARSE_ERROR")
    choices = cast(dict[str, object], payload).get("choices")
    if not isinstance(choices, list) or not choices:
        raise HTTPError(500, "AGENT_LLM_PARSE_ERROR")
    first = cast(list[object], choices)[0]
    if not isinstance(first, dict):
        raise HTTPError(500, "AGENT_LLM_PARSE_ERROR")
    message = cast(dict[str, object], first).get("message")
    if not isinstance(message, dict):
        return LlmTurnResult(text="", function_calls=())

    message_fields = cast(dict[str, object], message)
    raw_content = message_fields.get("content")
    text = raw_content.strip() if isinstance(raw_content, str) else ""
    calls: list[LlmFunctionCall] = []
    raw_calls = message_fields.get("tool_calls")
    if isinstance(raw_calls, list):
        for item in cast(list[object], raw_calls):
            if not isinstance(item, dict):
                continue
            call_fields = cast(dict[str, object], item)
            function = call_fields.get("function")
            if not isinstance(function, dict):
                continue
            function_fields = cast(dict[str, object], function)
            name = function_fields.get("name")
            if not isinstance(name, str) or not name.strip():
                continue
            args = _parse_tool_arguments(function_fields.get("arguments"))
            call_id = call_fields.get("id")
            calls.append(
                LlmFunctionCall(
                    name=name.strip(),
                    args=args,
                    call_id=call_id.strip() if isinstance(call_id, str) else "",
                )
            )
    return LlmTurnResult(text=text, function_calls=tuple(calls))


def _parse_tool_arguments(value: object) -> dict[str, JSONValue]:
    if isinstance(value, dict):
        return _json_object(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return _json_object(parsed)
    return {}


def _is_auth_error(status_code: int, payload: object) -> bool:
    if status_code in (401, 403):
        return True
    if not isinstance(payload, dict):
        return False
    error = cast(dict[str, object], payload).get("error")
    if isinstance(error, dict):
        code = cast(dict[str, object], error).get("code")
        error_type = cast(dict[str, object], error).get("type")
        if code in ("invalid_api_key", "invalid_api_key_error") or error_type == "authentication_error":
            return True
    return False


def call_openai_compatible_turn(
    http: HTTPClient,
    *,
    api_key: str,
    model: str,
    base_url: str,
    messages: list[JSONValue],
    tools: list[JSONValue],
    extra_headers: dict[str, str] | None = None,
    timeout: int = 60,
) -> LlmTurnResult:
    if not base_url.strip() or not model.strip():
        raise HTTPError(400, "AGENT_LLM_PROVIDER_INVALID")

    payload: dict[str, JSONValue] = {
        "model": model,
        "messages": messages,
        "temperature": 0.4,
    }
    if tools:
        payload["tools"] = tools

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    if extra_headers:
        headers.update(extra_headers)

    try:
        response = http.post(
            openai_chat_completions_url(base_url),
            headers=headers,
            json_payload=payload,
            timeout=timeout,
        )
    except HttpTransportError as exc:
        raise HTTPError(504, "Agent LLM request timed out") from exc

    body: object
    try:
        body = response.json()
    except Exception:
        body = None

    if response.status_code != 200:
        if _is_auth_error(response.status_code, body):
            raise HTTPError(
                response.status_code,
                "Provider rejected the configured API key",
                code="AGENT_LLM_INVALID_API_KEY",
            )
        raise HTTPError(response.status_code, f"Agent LLM error: {response.text}")
    return parse_openai_turn_payload(body)
