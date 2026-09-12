"""Anthropic Messages API with tool use (Anthropic and compatible endpoints)."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast
from uuid import uuid4

from api_types import AgentMessagePayload, AgentToolDeclarationPayload
from _routes._errors import HTTPError
from services.interfaces import HTTPClient, HttpTransportError, JSONValue

if TYPE_CHECKING:
    from services.agent_llm import LlmFunctionCall, LlmTurnResult

_ANTHROPIC_VERSION = "2023-06-01"


def anthropic_messages_url(base_url: str) -> str:
    stripped = base_url.strip().rstrip("/")
    if stripped.endswith("/messages"):
        return stripped
    if stripped.endswith("/v1"):
        return f"{stripped}/messages"
    return f"{stripped}/v1/messages"


def _json_object(value: object) -> dict[str, JSONValue]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, JSONValue] = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            result[key] = cast(JSONValue, item)
    return result


def anthropic_tools_from_declarations(
    declarations: list[AgentToolDeclarationPayload],
) -> list[JSONValue]:
    tools: list[JSONValue] = []
    for item in declarations:
        name = item.name.strip()
        if not name:
            continue
        tools.append(
            {
                "name": name,
                "description": item.description,
                "input_schema": _json_object(item.parameters) or {"type": "object", "properties": {}},
            }
        )
    return tools


def anthropic_messages_from_agent(messages: list[AgentMessagePayload]) -> list[JSONValue]:
    converted: list[JSONValue] = []
    pending_tool_results: list[JSONValue] = []

    def flush_tool_results() -> None:
        if not pending_tool_results:
            return
        converted.append({"role": "user", "content": list(pending_tool_results)})
        pending_tool_results.clear()

    for message in messages:
        if message.role == "assistant":
            flush_tool_results()
            content: list[JSONValue] = []
            for part in message.parts:
                if part.type == "text" and part.text:
                    content.append({"type": "text", "text": part.text})
                elif part.type == "tool_call" and part.toolName:
                    content.append(
                        {
                            "type": "tool_use",
                            "id": (part.toolCallId or "").strip() or f"call_{uuid4().hex[:10]}",
                            "name": part.toolName,
                            "input": _json_object(part.arguments),
                        }
                    )
            if content:
                converted.append({"role": "assistant", "content": content})
            continue

        if message.role == "tool" or any(part.type == "tool_result" for part in message.parts):
            for part in message.parts:
                if part.type != "tool_result":
                    continue
                payload = part.result if part.result is not None else {"ok": True}
                pending_tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": (part.toolCallId or part.toolName or "").strip() or f"call_{uuid4().hex[:10]}",
                        "content": _stringify_result(payload),
                    }
                )
            continue

        flush_tool_results()
        content_parts: list[JSONValue] = []
        for part in message.parts:
            if part.type == "text" and part.text:
                content_parts.append({"type": "text", "text": part.text})
            elif part.type == "inline_image" and part.data and part.mimeType:
                content_parts.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": part.mimeType,
                            "data": part.data,
                        },
                    }
                )
        if content_parts:
            converted.append({"role": "user", "content": content_parts})

    flush_tool_results()
    if not converted:
        raise HTTPError(400, "Agent turn has no usable message parts")
    return converted


def _stringify_result(payload: object) -> str:
    if isinstance(payload, str):
        return payload
    import json

    return json.dumps(payload, ensure_ascii=False)


def parse_anthropic_turn_payload(payload: object) -> LlmTurnResult:
    from services.agent_llm import LlmFunctionCall, LlmTurnResult

    if not isinstance(payload, dict):
        raise HTTPError(500, "AGENT_LLM_PARSE_ERROR")
    content = cast(dict[str, object], payload).get("content")
    if not isinstance(content, list):
        return LlmTurnResult(text="", function_calls=())

    text_chunks: list[str] = []
    calls: list[LlmFunctionCall] = []
    for item in cast(list[object], content):
        if not isinstance(item, dict):
            continue
        fields = cast(dict[str, object], item)
        item_type = fields.get("type")
        if item_type == "text":
            text = fields.get("text")
            if isinstance(text, str) and text:
                text_chunks.append(text)
            continue
        if item_type != "tool_use":
            continue
        name = fields.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        call_id = fields.get("id")
        calls.append(
            LlmFunctionCall(
                name=name.strip(),
                args=_json_object(fields.get("input")),
                call_id=call_id.strip() if isinstance(call_id, str) else "",
            )
        )
    return LlmTurnResult(text="".join(text_chunks).strip(), function_calls=tuple(calls))


def _is_auth_error(status_code: int, payload: object) -> bool:
    if status_code in (401, 403):
        return True
    if not isinstance(payload, dict):
        return False
    error = cast(dict[str, object], payload).get("error")
    if isinstance(error, dict) and cast(dict[str, object], error).get("type") == "authentication_error":
        return True
    return False


def call_anthropic_messages_turn(
    http: HTTPClient,
    *,
    api_key: str,
    model: str,
    base_url: str,
    system_instruction: str,
    messages: list[JSONValue],
    tools: list[JSONValue],
    timeout: int = 60,
) -> LlmTurnResult:
    if not base_url.strip() or not model.strip():
        raise HTTPError(400, "AGENT_LLM_PROVIDER_INVALID")

    payload: dict[str, JSONValue] = {
        "model": model,
        "max_tokens": 2048,
        "system": system_instruction,
        "messages": messages,
        "temperature": 0.4,
    }
    if tools:
        payload["tools"] = tools

    try:
        response = http.post(
            anthropic_messages_url(base_url),
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": _ANTHROPIC_VERSION,
            },
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
    return parse_anthropic_turn_payload(body)
