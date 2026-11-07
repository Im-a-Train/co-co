import { describe, expect, it } from 'vitest'
import { decodeJwtHpPayload } from '../jwt'

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const header = b64url({ typ: 'JWT', alg: 'RS256' })

describe('decodeJwtHpPayload', () => {
  it('decodes exp, user and roles from header.payload', () => {
    const hp = `${header}.${b64url({ iat: 1, exp: 1762500000, roles: ['ROLE_USER'], user: '/api/users/abc123' })}`
    expect(decodeJwtHpPayload(hp)).toEqual({ exp: 1762500000, user: '/api/users/abc123', roles: ['ROLE_USER'] })
  })

  it('also accepts a full JWT (header.payload.signature)', () => {
    const jwt = `${header}.${b64url({ exp: 5, user: '/api/users/x' })}.c2lnbmF0dXJl`
    expect(decodeJwtHpPayload(jwt)?.user).toBe('/api/users/x')
  })

  it('tolerates padding and url-encoded cookie values', () => {
    const payload = Buffer.from(JSON.stringify({ exp: 42, user: 'ü/äöß?>' })).toString('base64url')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const hp = encodeURIComponent(`${header}.${padded}`)
    expect(decodeJwtHpPayload(hp)).toEqual({ exp: 42, user: 'ü/äöß?>', roles: [] })
  })

  it('handles base64url characters - and _', () => {
    // '>>>' and '???' produce '+' and '/' in standard base64
    const hp = `${header}.${b64url({ exp: 1, user: '>>>???' })}`
    expect(hp).toMatch(/[-_]/)
    expect(decodeJwtHpPayload(hp)?.user).toBe('>>>???')
  })

  it('ignores wrongly typed fields', () => {
    const hp = `${header}.${b64url({ exp: 'soon', user: 7, roles: ['A', 1, null] })}`
    expect(decodeJwtHpPayload(hp)).toEqual({ exp: null, user: null, roles: ['A'] })
  })

  it('returns null for garbage', () => {
    expect(decodeJwtHpPayload('')).toBeNull()
    expect(decodeJwtHpPayload('onlyonepart')).toBeNull()
    expect(decodeJwtHpPayload('a.!!!notbase64')).toBeNull()
    expect(decodeJwtHpPayload(`${header}.${b64url('a string')}`)).toBeNull()
  })
})
