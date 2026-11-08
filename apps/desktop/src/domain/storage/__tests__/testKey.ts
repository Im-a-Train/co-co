/**
 * Test helper: unlock the encrypted store with a fixed test key (needs `import 'fake-indexeddb/auto'` in the test).
 * unlockDb zeroes the byte array, so every call gets a fresh one.
 */
import { unlockDb, type UnlockOptions } from '../db'

export const testKeyBytes = (fill = 7): Uint8Array => new Uint8Array(32).fill(fill)

export function unlockTestDb(options: UnlockOptions = {}, fill = 7) {
  return unlockDb(testKeyBytes(fill), options)
}
