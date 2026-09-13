import type { EditorState } from '../editor-state.ts'
import { asString, toolErrorResult, validateUnknownKeys } from './agent-tool-utils.ts'
import { isAgentRefRole, type AgentRefStore } from './agent-refs.ts'
import { REF_TOOL_ALLOWED_KEYS, type AgentRefToolName } from './tool-definitions.ts'

export interface AgentRefsActionHost {
  getState: () => EditorState
  refs?: AgentRefStore
}

function errorResult(message: string): Record<string, unknown> {
  return toolErrorResult(message)
}

export function executeRefTool(
  host: AgentRefsActionHost,
  name: AgentRefToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const unknown = validateUnknownKeys(args, REF_TOOL_ALLOWED_KEYS[name])
  if (unknown) return errorResult(unknown)
  const store = host.refs
  if (!store) return errorResult('Reference library is not available')

  if (name === 'list_refs') {
    return { ok: true, refs: store.list() }
  }

  if (name === 'register_ref') {
    const assetId = asString(args.assetId)
    const nameValue = asString(args.name)
    if (!assetId) return errorResult('Missing assetId')
    if (!nameValue) return errorResult('Missing name')
    const asset = host.getState().editorModel.assets.find(item => item.id === assetId)
    if (!asset) return errorResult(`Asset not found: ${assetId}`)
    if (asset.type !== 'image') return errorResult('Refs must point at an image asset for shot continuity')
    const ref = store.register({
      name: nameValue,
      assetId,
      ...(isAgentRefRole(args.role) ? { role: args.role } : {}),
      ...(asString(args.id) ? { id: asString(args.id)! } : {}),
    })
    return { ok: true, ref }
  }

  const id = asString(args.id) ?? asString(args.refId)
  if (!id) return errorResult('Missing id')
  if (!store.forget(id)) return errorResult(`Ref not found: ${id}`)
  return { ok: true, forgotten: id }
}
