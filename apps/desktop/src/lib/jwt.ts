/**
 * Helpers for the non-HttpOnly lexik "jwt_hp" cookie (header.payload).
 * Only the payload fields exp/user/roles are of interest; the signature never
 * reaches the frontend.
 */
export interface JwtHpPayload {
  exp: number | null
  user: string | null
  roles: string[]
}

function base64UrlDecode(input: string): string {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const pad = b64.length % 4
  if (pad === 1) throw new Error('invalid base64url length')
  if (pad > 0) b64 += '='.repeat(4 - pad)
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Decodes the payload part of a JWT or of a jwt_hp cookie ("header.payload").
 * Returns null when the input is not decodable.
 */
export function decodeJwtHpPayload(token: string): JwtHpPayload | null {
  if (!token) return null
  try {
    const parts = decodeURIComponent(token.trim()).split('.')
    if (parts.length < 2 || !parts[1]) return null
    const json: unknown = JSON.parse(base64UrlDecode(parts[1]))
    if (!json || typeof json !== 'object') return null
    const o = json as Record<string, unknown>
    return {
      exp: typeof o.exp === 'number' && Number.isFinite(o.exp) ? o.exp : null,
      user: typeof o.user === 'string' ? o.user : null,
      roles: Array.isArray(o.roles) ? o.roles.filter((r): r is string => typeof r === 'string') : [],
    }
  } catch {
    return null
  }
}
