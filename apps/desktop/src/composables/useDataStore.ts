/**
 * State of the encrypted local data store (ADR 0009). The key lives in the OS keychain (Rust) and is only
 * released after a verified eCamp session: login -> unlock(), logout -> lock().
 * Composables that cache DB-derived state register a reset via onDataStoreLocked().
 */
import { computed, ref } from 'vue'
import { DecryptError, isUnlocked, lockDb, resetLocalData, unlockDb } from '@/domain/storage/db'
import { commands, errorMessage } from '@/lib/tauri'

export type DataStoreState = 'locked' | 'unlocking' | 'ready' | 'keyLost' | 'error'

const state = ref<DataStoreState>(isUnlocked() ? 'ready' : 'locked')
const error = ref<string | null>(null)
/** True while the first unlock after install runs (legacy plaintext data is migrated into the encrypted store). */
const creating = ref(false)
const lockedCallbacks: Array<() => void> = []
let inflight: Promise<void> | null = null

/** Registers a reset that runs whenever the store is locked (logout). Call at module level. */
export function onDataStoreLocked(cb: () => void): void {
  lockedCallbacks.push(cb)
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function unlock(): Promise<void> {
  if (state.value === 'ready') return Promise.resolve()
  if (inflight) return inflight
  state.value = 'unlocking'
  error.value = null
  inflight = (async () => {
    try {
      const { key, created } = await commands.unlockDataStore()
      creating.value = created
      await unlockDb(decodeBase64(key))
      state.value = 'ready'
    } catch (e) {
      if (e instanceof DecryptError) state.value = 'keyLost'
      else {
        state.value = 'error'
        error.value = errorMessage(e)
      }
    } finally {
      creating.value = false
      inflight = null
    }
  })()
  return inflight
}

async function lock(): Promise<void> {
  // An unlock that is still running must finish first, otherwise it would re-open the store after logout.
  if (inflight) await inflight
  state.value = 'locked'
  error.value = null
  for (const cb of lockedCallbacks) {
    try {
      cb()
    } catch {
      /* a failing reset must not keep the others from running */
    }
  }
  try {
    await lockDb()
  } catch {
    /* already closed */
  }
  try {
    await commands.lockDataStore()
  } catch {
    /* not in Tauri / backend not ready */
  }
}

/** Resolves when no unlock is in progress anymore (router guard). */
async function settled(): Promise<DataStoreState> {
  if (inflight) await inflight
  return state.value
}

/** Key lost: delete the local data (explicit user action only) and start a fresh encrypted store. */
async function resetAndUnlock(): Promise<void> {
  if (inflight) await inflight
  await resetLocalData()
  state.value = 'locked'
  await unlock()
}

export function useDataStore() {
  return {
    state,
    error,
    creating,
    ready: computed(() => state.value === 'ready'),
    unlock,
    lock,
    settled,
    resetAndUnlock,
  }
}
