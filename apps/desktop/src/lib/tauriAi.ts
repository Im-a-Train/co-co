/**
 * AI completion command wrapper.
 *
 * ONLY src/domain/zones/aiGateway.ts may import this module
 * (enforced by src/__tests__/contracts/aiGuard.test.ts). Everything else goes through aiGateway.send().
 */
import { invoke } from '@tauri-apps/api/core'
import { isTauri, NotInTauriError } from './tauri'

export interface AiCompleteRequest {
  model: string
  system: string
  prompt: string
  maxTokens: number
}

export interface AiCompleteResponse {
  text: string
  inputTokens: number
  outputTokens: number
}

/** Rust: Anthropic Messages API with the key from the OS keychain. */
export async function aiComplete(request: AiCompleteRequest): Promise<AiCompleteResponse> {
  if (!isTauri()) throw new NotInTauriError()
  return invoke<AiCompleteResponse>('ai_complete', { request })
}
