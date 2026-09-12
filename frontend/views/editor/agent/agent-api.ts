import { ApiClient } from '../../../lib/api-client.ts'
import { AgentTurnError } from './agent-loop.ts'
import type { AgentTurnRequest, AgentTurnResponse } from './agent-types.ts'

export async function requestAgentTurn(
  request: AgentTurnRequest,
  signal: AbortSignal,
): Promise<AgentTurnResponse> {
  const result = await ApiClient.agentTurn(request, { signal })
  if (result.ok) {
    return {
      status: 'success',
      text: result.data.text ?? '',
      toolCalls: (result.data.toolCalls ?? []).map(call => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments ?? {},
      })),
      askUser: result.data.askUser?.map(question => ({
        id: question.id,
        prompt: question.prompt,
        kind: question.kind,
        options: question.options ?? undefined,
        allowMultiple: question.allowMultiple,
      })) ?? null,
      finishReason: result.data.finishReason ?? 'stop',
    }
  }
  throw new AgentTurnError(result.error.message || 'Agent turn failed', {
    code: result.error.code,
    status: result.status === '4XX' || result.status === '5XX' || result.status === 'default'
      ? 500
      : result.status,
  })
}
