/**
 * AES-256-GCM envelope for rows of the local store (ADR 0009).
 * - The key is imported as a NON-extractable CryptoKey; the raw bytes are zeroed right after import.
 * - Envelope `{ v: 1, iv, ct }`: fresh random 96-bit IV per write; AAD = table + '\0' + primary key, so a row
 *   copied under another table or key fails to decrypt.
 */
import { DecryptError } from './errors'

export interface Envelope {
  v: 1
  iv: Uint8Array
  ct: Uint8Array
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export const KEY_BYTES = 32
const IV_BYTES = 12

/** Imports raw key bytes as a non-extractable AES-GCM key and zeroes `bytes`. */
export async function importDataKey(bytes: Uint8Array): Promise<CryptoKey> {
  if (bytes.length !== KEY_BYTES) throw new Error(`Data key must be ${KEY_BYTES} bytes`)
  try {
    return await crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
  } finally {
    bytes.fill(0)
  }
}

/** Stable text form of a primary key (strings, numbers, compound keys). */
export function stableKey(pk: unknown): string {
  if (pk === undefined || pk === null) return ''
  if (typeof pk === 'string') return pk
  if (Array.isArray(pk)) return JSON.stringify(pk.map((p) => (typeof p === 'string' ? p : String(p))))
  if (pk instanceof Date) return pk.toISOString()
  return String(pk)
}

export function makeAad(table: string, primaryKey: unknown): Uint8Array {
  return enc.encode(table + '\0' + stableKey(primaryKey))
}

export async function encryptJson(key: CryptoKey, value: unknown, aad: Uint8Array): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plain = enc.encode(JSON.stringify(value))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad as BufferSource }, key, plain))
  return { v: 1, iv, ct }
}

export async function decryptJson(key: CryptoKey, envelope: unknown, aad: Uint8Array): Promise<unknown> {
  const e = envelope as Partial<Envelope> | null | undefined
  if (!e || e.v !== 1 || !(e.iv instanceof Uint8Array) || !(e.ct instanceof Uint8Array)) throw new DecryptError('Missing or unknown envelope')
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.iv as BufferSource, additionalData: aad as BufferSource }, key, e.ct as BufferSource)
    return JSON.parse(dec.decode(plain))
  } catch {
    throw new DecryptError()
  }
}
