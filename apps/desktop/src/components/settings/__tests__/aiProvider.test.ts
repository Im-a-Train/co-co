import { describe, expect, it } from 'vitest'
import { PRESETS, isAllowedBaseUrl, originOf } from '../aiProvider'

describe('isAllowedBaseUrl', () => {
  it('allows https and loopback http', () => {
    expect(isAllowedBaseUrl('https://api.openai.com/v1')).toBe(true)
    expect(isAllowedBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isAllowedBaseUrl('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isAllowedBaseUrl('http://[::1]:8080/v1')).toBe(true)
    expect(isAllowedBaseUrl('http://llm.localhost/v1')).toBe(true)
  })
  it('rejects remote http, other schemes and junk', () => {
    expect(isAllowedBaseUrl('http://example.com/v1')).toBe(false)
    expect(isAllowedBaseUrl('http://192.168.1.5:11434/v1')).toBe(false)
    expect(isAllowedBaseUrl('ftp://localhost/v1')).toBe(false)
    expect(isAllowedBaseUrl('')).toBe(false)
    expect(isAllowedBaseUrl('not a url')).toBe(false)
  })
  it('rejects userinfo, query and fragment', () => {
    expect(isAllowedBaseUrl('https://u:p@api.openai.com/v1')).toBe(false)
    expect(isAllowedBaseUrl('https://api.openai.com/v1?x=1')).toBe(false)
    expect(isAllowedBaseUrl('https://api.openai.com/v1#a')).toBe(false)
  })
})

describe('originOf / PRESETS', () => {
  it('extracts origin', () => {
    expect(originOf('http://localhost:11434/v1')).toBe('http://localhost:11434')
    expect(originOf('nope')).toBe('')
  })
  it('has all presets with allowed urls', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['ollama', 'lmstudio', 'openai', 'custom'])
    for (const p of PRESETS) if (p.url) expect(isAllowedBaseUrl(p.url)).toBe(true)
  })
})
