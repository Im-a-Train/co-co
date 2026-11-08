/**
 * Disabled rules and "don't ask again" marks. Pure logic (persistence in ruleStateStore.ts).
 * campIri === null means "all camps".
 */
import type { Iri, Override } from '../types'

export interface RuleToggle {
  ruleId: string
  campIri: Iri | null
}

/** Activity category excluded from rule checks in one camp (ruleId null = from all rules). */
export interface CategoryExclusion {
  campIri: Iri
  categoryIri: Iri
  ruleId: string | null
}

export interface RuleState {
  disabled: RuleToggle[]
  /** "Nein, danke": do not ask again to disable this rule in this camp. */
  muted: Array<{ ruleId: string; campIri: Iri }>
  /** Activity categories (per camp) skipped by all or single rules. */
  excludedCategories: CategoryExclusion[]
}

export const EMPTY_RULE_STATE: RuleState = { disabled: [], muted: [], excludedCategories: [] }

/** Ignored findings of one rule in one camp (>=) or in several camps trigger the prompt. */
export const IGNORE_THRESHOLD_CAMP = 3
export const IGNORE_THRESHOLD_CAMPS = 2

export function normalizeRuleState(raw: unknown): RuleState {
  const r = (raw ?? {}) as Partial<RuleState>
  return {
    disabled: Array.isArray(r.disabled) ? r.disabled.filter((d) => d && typeof d.ruleId === 'string') : [],
    muted: Array.isArray(r.muted)
      ? r.muted.filter((d) => d && typeof d.ruleId === 'string' && typeof d.campIri === 'string')
      : [],
    excludedCategories: Array.isArray(r.excludedCategories)
      ? r.excludedCategories.filter(
          (e) =>
            e &&
            typeof e.campIri === 'string' &&
            typeof e.categoryIri === 'string' &&
            (e.ruleId === null || typeof e.ruleId === 'string'),
        )
      : [],
  }
}

export function excludeCategory(state: RuleState, campIri: Iri, categoryIri: Iri, ruleId: string | null): RuleState {
  if (state.excludedCategories.some((e) => e.campIri === campIri && e.categoryIri === categoryIri && e.ruleId === ruleId)) return state
  return { ...state, excludedCategories: [...state.excludedCategories, { campIri, categoryIri, ruleId }] }
}

export function includeCategory(state: RuleState, campIri: Iri, categoryIri: Iri, ruleId: string | null): RuleState {
  return {
    ...state,
    excludedCategories: state.excludedCategories.filter(
      (e) => !(e.campIri === campIri && e.categoryIri === categoryIri && e.ruleId === ruleId),
    ),
  }
}

/** True when the category is excluded from all rules or from this rule in this camp. */
export function isCategoryExcluded(state: RuleState, campIri: Iri, categoryIri: Iri, ruleId: string): boolean {
  return state.excludedCategories.some(
    (e) => e.campIri === campIri && e.categoryIri === categoryIri && (e.ruleId === null || e.ruleId === ruleId),
  )
}

export function categoryExclusionsForCamp(state: RuleState, campIri: Iri): CategoryExclusion[] {
  return state.excludedCategories.filter((e) => e.campIri === campIri)
}

export function isRuleDisabled(state: RuleState, ruleId: string, campIri: Iri): boolean {
  return state.disabled.some((d) => d.ruleId === ruleId && (d.campIri === null || d.campIri === campIri))
}

/** Rule ids that must be skipped for a camp (global + camp-specific). */
export function disabledRuleIds(state: RuleState, campIri: Iri): Set<string> {
  return new Set(state.disabled.filter((d) => d.campIri === null || d.campIri === campIri).map((d) => d.ruleId))
}

export function disableRule(state: RuleState, ruleId: string, campIri: Iri | null): RuleState {
  if (state.disabled.some((d) => d.ruleId === ruleId && d.campIri === campIri)) return state
  return { ...state, disabled: [...state.disabled, { ruleId, campIri }] }
}

/** Re-enables a rule: for one scope (campIri or null = global), or everywhere when campIri is undefined. */
export function enableRule(state: RuleState, ruleId: string, campIri?: Iri | null): RuleState {
  return {
    ...state,
    disabled: state.disabled.filter((d) => !(d.ruleId === ruleId && (campIri === undefined || d.campIri === campIri))),
  }
}

export function muteRule(state: RuleState, ruleId: string, campIri: Iri): RuleState {
  if (state.muted.some((m) => m.ruleId === ruleId && m.campIri === campIri)) return state
  return { ...state, muted: [...state.muted, { ruleId, campIri }] }
}

export function campsWithDisabled(state: RuleState, ruleId: string): number {
  return new Set(state.disabled.filter((d) => d.ruleId === ruleId && d.campIri !== null).map((d) => d.campIri)).size
}

export function isGloballyDisabled(state: RuleState, ruleId: string): boolean {
  return state.disabled.some((d) => d.ruleId === ruleId && d.campIri === null)
}

export interface IgnoreStats {
  inCamp: number
  total: number
  camps: number
}

export function ignoreStats(overrides: readonly Override[], ruleId: string, campIri: Iri): IgnoreStats {
  const mine = overrides.filter((o) => o.ruleId === ruleId)
  return {
    inCamp: mine.filter((o) => o.campIri === campIri).length,
    total: mine.length,
    camps: new Set(mine.map((o) => o.campIri)).size,
  }
}

/**
 * Returns the number to show in "schon N-mal ignoriert" when the coach should be asked whether to
 * disable the rule, else null. `overrides` = all overrides over all camps.
 */
export function disablePromptCount(
  overrides: readonly Override[],
  state: RuleState,
  ruleId: string,
  campIri: Iri,
): number | null {
  if (isRuleDisabled(state, ruleId, campIri)) return null
  if (state.muted.some((m) => m.ruleId === ruleId && m.campIri === campIri)) return null
  const s = ignoreStats(overrides, ruleId, campIri)
  if (s.inCamp >= IGNORE_THRESHOLD_CAMP) return s.inCamp
  if (s.camps >= IGNORE_THRESHOLD_CAMPS) return s.total
  return null
}
