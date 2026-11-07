import { reactive, ref } from 'vue'
import { emptyResults, type ResultKey, type ResultStatus, type SpikeLogEntry } from '@/lib/report'
import { onAuthLog, type AuthLogEvent } from '@/lib/tauri'

const MAX_LOG = 500

// Module-level singleton state: one spike protocol per app run.
const logs = ref<SpikeLogEntry[]>([])
const results = reactive(emptyResults())
const campsCount = ref<number | null>(null)
let listening: Promise<void> | null = null

function addLog(source: SpikeLogEntry['source'], step: string, ok: boolean, detail?: string | null): void {
  logs.value.push({ at: Date.now(), source, step, ok, detail: detail ?? null })
  if (logs.value.length > MAX_LOG) logs.value.splice(0, logs.value.length - MAX_LOG)
}

function markResult(key: ResultKey, status: ResultStatus, detail?: string | null): void {
  // A success is never downgraded by a later failure of a different attempt
  // except for refresh/api, where the latest outcome is what matters.
  if (results[key].status === 'ok' && status === 'failed' && (key === 'loginWindowOpened' || key === 'cookiesFound')) {
    return
  }
  results[key] = { status, at: Date.now(), detail: detail ?? null }
}

/** Maps Rust 'auth://log' steps onto the results checklist (best effort, names are free-form). */
export function resultForStep(step: string): ResultKey | null {
  const s = step.toLowerCase()
  // '*-start' steps only announce an attempt; the outcome arrives as a separate step.
  if (s.includes('closed') || s.endsWith('-start')) return null
  if (s.includes('window') && (s.includes('open') || s.includes('created'))) return 'loginWindowOpened'
  if (s.includes('cookie')) return 'cookiesFound'
  if (s.includes('refresh')) return 'refreshOk'
  return null
}

function handleRustLog(e: AuthLogEvent): void {
  addLog('rust', e.step, e.ok, e.detail ?? null)
  const key = resultForStep(e.step)
  if (key) markResult(key, e.ok ? 'ok' : 'failed', e.detail ?? null)
}

function startListening(): Promise<void> {
  listening ??= onAuthLog(handleRustLog).then(() => undefined)
  return listening
}

function reset(): void {
  logs.value = []
  Object.assign(results, emptyResults())
  campsCount.value = null
}

export function useSpikeProtocol() {
  return { logs, results, campsCount, addLog, markResult, startListening, reset }
}
