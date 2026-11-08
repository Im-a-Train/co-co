/** Pure edits of a CampRuleConfig used by the coach UI (composables/useCampRuleConfig.ts). */
import type { ActivityTag, CampRuleConfig, Iri, ModuleCoachState, ModuleId, SbApprovalKind } from '../../types'

export const SB_TAGS: readonly ActivityTag[] = ['sb-berg', 'sb-wasser', 'sb-winter']

export const hasSbTag = (tags: readonly ActivityTag[]): boolean => tags.some((t) => SB_TAGS.includes(t))

/** 'auto' removes the entry (auto is the default). */
export function withModuleState(c: CampRuleConfig, id: ModuleId, state: ModuleCoachState): CampRuleConfig {
  const { [id]: _drop, ...rest } = c.modules
  return { ...c, modules: state === 'auto' ? rest : { ...rest, [id]: state } }
}

/**
 * Sets the tags of one activity. An empty list removes the entry; dropping the last `sb-*` tag removes
 * the activity's SB approval.
 */
export function withActivityTags(c: CampRuleConfig, iri: Iri, tags: readonly ActivityTag[]): CampRuleConfig {
  const { [iri]: _t, ...restTags } = c.activityTags
  const next = [...new Set(tags)]
  let sb = c.sbApprovals
  if (!hasSbTag(next) && iri in sb) {
    const { [iri]: _s, ...restSb } = sb
    sb = restSb
  }
  return { ...c, activityTags: next.length ? { ...restTags, [iri]: next } : restTags, sbApprovals: sb }
}

/** `null` removes the approval. Kind `bergfuehrer` needs no date (LST-SB-02) and clears it. */
export function withSbApproval(
  c: CampRuleConfig,
  key: Iri | 'camp',
  value: { approvedOn?: string | null; kind: SbApprovalKind } | null,
): CampRuleConfig {
  const { [key]: _drop, ...rest } = c.sbApprovals
  if (!value) return { ...c, sbApprovals: rest }
  const approvedOn = value.kind === 'bergfuehrer' ? null : (value.approvedOn ?? null)
  return { ...c, sbApprovals: { ...rest, [key]: { approvedOn, kind: value.kind } } }
}

/** Patch of one checklist item; an entry without done and note is removed. */
export function withChecklistItem(
  c: CampRuleConfig,
  id: string,
  patch: { done?: boolean; note?: string },
  now: string = new Date().toISOString(),
): CampRuleConfig {
  const { [id]: prev, ...rest } = c.checklist
  const done = patch.done ?? prev?.done ?? false
  const noteRaw = patch.note !== undefined ? patch.note : prev?.note
  const note = noteRaw?.trim() ? noteRaw : undefined
  if (!done && !note) return { ...c, checklist: rest }
  return { ...c, checklist: { ...rest, [id]: { done, at: patch.done !== undefined ? now : (prev?.at ?? now), ...(note ? { note } : {}) } } }
}
