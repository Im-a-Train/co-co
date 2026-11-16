import { describe, expect, it } from 'vitest'
import { severityBorderColor } from '../severityStyle'

describe('severityBorderColor', () => {
  it('colours by state: Muss red, Soll orange', () => {
    expect(severityBorderColor('must')).toBe('rgb(var(--v-theme-error))')
    expect(severityBorderColor('should')).toBe('rgb(var(--v-theme-warning))')
  })

  it('keeps Hinweis neutral (no info blue)', () => {
    const hint = severityBorderColor('hint')
    expect(hint).not.toContain('info')
    expect(hint).toBe('rgba(var(--v-border-color), var(--v-border-opacity))')
  })
})
