import { severityStateColor } from '@/domain/cockpit'
import type { Severity } from '@/domain/types'

/** CSS colour of a finding's left border: colour = state (Muss red, Soll orange), Hinweis neutral. */
export function severityBorderColor(s: Severity): string {
  const c = severityStateColor(s)
  return c ? `rgb(var(--v-theme-${c}))` : 'rgba(var(--v-border-color), var(--v-border-opacity))'
}
