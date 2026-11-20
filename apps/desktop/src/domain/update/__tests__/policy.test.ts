import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../types'
import { mergeSettings } from '../../storage/settings'
import { parseUpdatePrefs, shouldAutoCheck, shouldPromptAuto, type AppUpdateInfo } from '../policy'

const base = DEFAULT_APP_SETTINGS.update

describe('parseUpdatePrefs (boot copy in localStorage)', () => {
  it('defaults for missing or broken values', () => {
    expect(parseUpdatePrefs(null)).toEqual(base)
    expect(parseUpdatePrefs('{not json')).toEqual(base)
    expect(parseUpdatePrefs('{"autoCheck":"yes","lastCheckAt":5,"skippedVersion":{}}')).toEqual(base)
  })
  it('reads stored values', () => {
    const v = { autoCheck: false, lastCheckAt: '2026-11-20T10:00:00.000Z', skippedVersion: '0.1.0-alpha.20' }
    expect(parseUpdatePrefs(JSON.stringify(v))).toEqual(v)
  })
})
const now = new Date('2026-11-20T12:00:00Z')
const info = (over: Partial<AppUpdateInfo> = {}): AppUpdateInfo => ({
  currentVersion: '0.1.0-alpha.1',
  available: true,
  version: '0.1.0-alpha.2',
  notes: null,
  date: null,
  canInstall: true,
  portable: false,
  releaseUrl: 'x',
  ...over,
})

describe('update policy', () => {
  it('defaults: auto check on, nothing skipped', () => {
    expect(base).toEqual({ autoCheck: true, lastCheckAt: null, skippedVersion: null })
    expect(mergeSettings(undefined).update).toEqual(base)
    expect(mergeSettings({ update: { skippedVersion: '1.0.0' } }).update).toEqual({ ...base, skippedVersion: '1.0.0' })
  })
  it('checks when never checked, not within 24 h', () => {
    expect(shouldAutoCheck(base, true, now)).toBe(true)
    expect(shouldAutoCheck({ ...base, lastCheckAt: '2026-11-20T02:00:00Z' }, true, now)).toBe(false)
    expect(shouldAutoCheck({ ...base, lastCheckAt: '2026-11-19T11:59:00Z' }, true, now)).toBe(true)
  })
  it('respects toggle, build and bad/future timestamps', () => {
    expect(shouldAutoCheck({ ...base, autoCheck: false }, true, now)).toBe(false)
    expect(shouldAutoCheck(base, false, now)).toBe(false)
    expect(shouldAutoCheck({ ...base, lastCheckAt: 'garbage' }, true, now)).toBe(true)
    expect(shouldAutoCheck({ ...base, lastCheckAt: '2030-01-01T00:00:00Z' }, true, now)).toBe(true)
  })
  it('prompts only for available, unskipped versions', () => {
    expect(shouldPromptAuto(info(), null)).toBe(true)
    expect(shouldPromptAuto(info(), '0.1.0-alpha.2')).toBe(false)
    expect(shouldPromptAuto(info({ available: false, version: null }), null)).toBe(false)
  })
})
