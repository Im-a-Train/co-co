/**
 * AI completion command wrapper.
 *
 * ONLY src/domain/zones/aiGateway.ts may import this module
 * (enforced by src/__tests__/contracts/aiGuard.test.ts). Everything else goes through aiGateway.send().
 */
import { invoke } from '@tauri-apps/api/core'
import { isTauri, NotInTauriError } from './tauri'

export interface AiCompleteRequest {
  /** ADR 0012. Omitted = 'anthropic'. */
  provider?: 'anthropic' | 'openai'
  /** Required for 'openai': e.g. 'http://localhost:11434/v1' (https, http only for loopback). */
  baseUrl?: string
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

/** Rust: Anthropic Messages API or an OpenAI-compatible Chat Completions server, key from the OS keychain. */
export async function aiComplete(request: AiCompleteRequest): Promise<AiCompleteResponse> {
  if (!isTauri()) throw new NotInTauriError()
  return invoke<AiCompleteResponse>('ai_complete', { request })
}
