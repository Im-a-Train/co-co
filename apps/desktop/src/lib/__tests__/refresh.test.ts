import { describe, expect, it } from 'vitest'
import {
  computeRefreshDelayMs,
  formatDuration,
  MAX_REFRESH_DELAY_MS,
  MIN_REFRESH_DELAY_MS,
  normalizeEpochMs,
  remainingSeconds,
} from '../refresh'

const MIN = 60 * 1000
const now = 1_762_500_000_000 // ms
const nowS = now / 1000

describe('computeRefreshDelayMs', () => {
  it('uses half the remaining lifetime', () => {
    expect(computeRefreshDelayMs(nowS + 20 * 60, now)).toBe(10 * MIN)
  })

  it('clamps to at most 30 minutes', () => {
    expect(computeRefreshDelayMs(nowS + 24 * 60 * 60, now)).toBe(MAX_REFRESH_DELAY_MS)
    expect(MAX_REFRESH_DELAY_MS).toBe(30 * MIN)
  })

  it('clamps to at least 2 minutes', () => {
    expect(computeRefreshDelayMs(nowS + 60, now)).toBe(MIN_REFRESH_DELAY_MS)
    expect(MIN_REFRESH_DELAY_MS).toBe(2 * MIN)
  })

  it('returns the minimum for expired or unknown tokens', () => {
    expect(computeRefreshDelayMs(nowS - 3600, now)).toBe(2 * MIN)
    expect(computeRefreshDelayMs(null, now)).toBe(2 * MIN)
    expect(computeRefreshDelayMs(undefined, now)).toBe(2 * MIN)
  })

  it('hits the boundaries exactly', () => {
    expect(computeRefreshDelayMs(nowS + 4 * 60, now)).toBe(2 * MIN)
    expect(computeRefreshDelayMs(nowS + 60 * 60, now)).toBe(30 * MIN)
  })
})

describe('remainingSeconds / formatDuration / normalizeEpochMs', () => {
  it('computes remaining seconds, never negative', () => {
    expect(remainingSeconds(nowS + 90, now)).toBe(90)
    expect(remainingSeconds(nowS - 5, now)).toBe(0)
    expect(remainingSeconds(null, now)).toBe(0)
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(3600 + 2 * 60 + 3)).toBe('1:02:03')
    expect(formatDuration(-3)).toBe('00:00')
  })

  it('normalizes seconds and milliseconds', () => {
    expect(normalizeEpochMs(nowS)).toBe(now)
    expect(normalizeEpochMs(now)).toBe(now)
  })
})
