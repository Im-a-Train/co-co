/** Pure edits of a CampRuleConfig used by the coach UI (composables/useCampRuleConfig.ts). */
import type { ActivityTag, CampRuleConfig, CustomChecklistItem, Iri, IsoDate, ModuleCoachState, ModuleId, SbApprovalKind } from '../../types'

export const SB_TAGS: readonly ActivityTag[] = ['sb-berg', 'sb-wasser', 'sb-winter']

export const hasSbTag = (tags: readonly ActivityTag[]): boolean => tags.some((t) => SB_TAGS.includes(t))

/** 'auto' removes the entry (auto is the default). */
export function withModuleState(c: CampRuleConfig, id: ModuleId, state: ModuleCoachState): CampRuleConfig {
  const { [id]: _drop, ...rest } = c.modules
  return { ...c, modules: state === 'auto' ? rest : { ...rest, [id]: state } }
}

/**
 * Definition of the tag groups shared by the coach UI (ActivityTagEditor) and the resolver below.
 * - `single`: at most one tag of the group (an exclusive choice; no tag = «Automatisch»).
 * - `multi`: tags of the group combine (sb-berg + sb-wasser); `none` is the explicit «keiner» tag that excludes them.
 * - `switch`: one independent on/off tag.
 */
export interface TagGroup {
  id: 'unternehmung' | 'js' | 'sb' | 'wasser' | 'ebb' | 'ef' | 'gesichert' | 'aufsicht'
  mode: 'single' | 'multi' | 'switch'
  tags: readonly ActivityTag[]
  /** Explicit «keiner» tag of a multi group (contradicts all `tags`). */
  none?: ActivityTag
  /** The group is only offered while one of these tags is set (a tag of the group itself keeps it visible). */
  visibleWith?: readonly ActivityTag[]
}

export const TAG_GROUPS: readonly TagGroup[] = [
  { id: 'unternehmung', mode: 'single', tags: ['unternehmung', 'keine-unternehmung'] },
  { id: 'js', mode: 'single', tags: ['js-aktivitaet', 'keine-js-aktivitaet'] },
  { id: 'sb', mode: 'multi', tags: SB_TAGS, none: 'kein-sb' },
  { id: 'wasser', mode: 'single', tags: ['wasser-bad-beaufsichtigt', 'wasser-pool', 'wasser-see', 'wasser-fluss'], visibleWith: ['sb-wasser'] },
  { id: 'ebb', mode: 'single', tags: ['ebb-a', 'ebb-b', 'kein-ebb'] },
  { id: 'ef', mode: 'multi', tags: ['ef1', 'ef2', 'ef3', 'ef4', 'ef5', 'ef6'] },
  { id: 'gesichert', mode: 'switch', tags: ['gesicherter-bereich'] },
  { id: 'aufsicht', mode: 'switch', tags: ['externe-wasseraufsicht'] },
]

/** Every tag appears in exactly one group (guarded by a test). */
export const groupOfTag = (tag: ActivityTag): TagGroup | undefined =>
  TAG_GROUPS.find((g) => g.tags.includes(tag) || g.none === tag)

/** Whether the group's row is shown for these tags. */
export function isGroupVisible(g: TagGroup, tags: readonly ActivityTag[]): boolean {
  if (!g.visibleWith) return true
  return g.tags.some((t) => tags.includes(t)) || g.visibleWith.some((t) => tags.includes(t))
}

/** Tags of one group that are currently set (including its `none` tag). */
export const tagsInGroup = (g: TagGroup, tags: readonly ActivityTag[]): ActivityTag[] =>
  tags.filter((t) => g.tags.includes(t) || g.none === t)

/** Exclusive choice: replaces the group's tags by `tag` (null = «Automatisch»: removes them). */
export function withGroupChoice(tags: readonly ActivityTag[], g: TagGroup, tag: ActivityTag | null): ActivityTag[] {
  const rest = tags.filter((t) => !g.tags.includes(t) && g.none !== t)
  return tag ? [...rest, tag] : rest
}

/** Combinable group / switch: toggles one tag (the resolver drops contradicting ones such as `kein-sb`). */
export function withTagToggled(tags: readonly ActivityTag[], tag: ActivityTag): ActivityTag[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
}

/**
 * Mutually exclusive tag groups: each group lists «classes»; only one class may be present at a time (several
 * tags of the same class may combine, e.g. sb-berg + sb-wasser). The newly added tag wins.
 * Derived from TAG_GROUPS: `single` groups make every tag its own class, a `multi` group with `none` has two classes.
 */
const EXCLUSIVE_GROUPS: readonly (readonly (readonly ActivityTag[])[])[] = TAG_GROUPS.flatMap((g) => {
  if (g.mode === 'single') return [g.tags.map((t) => [t] as readonly ActivityTag[])]
  if (g.mode === 'multi' && g.none) return [[g.tags, [g.none]] as readonly (readonly ActivityTag[])[]]
  return []
})

/** Removes contradicting tags; among conflicting classes the one holding a newly added tag (else the last listed) wins. */
function resolveExclusive(tags: ActivityTag[], previous: readonly ActivityTag[]): ActivityTag[] {
  let out = tags
  for (const classes of EXCLUSIVE_GROUPS) {
    const present = classes.filter((cls) => out.some((t) => cls.includes(t)))
    if (present.length <= 1) continue
    const fresh = present.filter((cls) => out.some((t) => cls.includes(t) && !previous.includes(t)))
    const pool = fresh.length ? fresh : present
    const winner = pool.reduce((best, cls) => {
      const pos = (c: readonly ActivityTag[]) => Math.max(...c.map((t) => out.lastIndexOf(t)))
      return pos(cls) > pos(best) ? cls : best
    })
    out = out.filter((t) => !classes.some((cls) => cls !== winner && cls.includes(t)))
  }
  return out
}

/**
 * Sets the tags of one activity. An empty list removes the entry; dropping the last `sb-*` tag removes
 * the activity's SB approval. Contradicting tags are resolved: the newly added tag wins.
 */
export function withActivityTags(c: CampRuleConfig, iri: Iri, tags: readonly ActivityTag[]): CampRuleConfig {
  const { [iri]: previous, ...restTags } = c.activityTags
  const next = resolveExclusive([...new Set(tags)], previous ?? [])
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

/** Adds a coach-written checklist point (text trimmed; empty text is ignored). `due` is optional. */
export function withCustomChecklistItem(
  c: CampRuleConfig,
  item: { id: string; text: string; due?: IsoDate | null },
  now: string = new Date().toISOString(),
): CampRuleConfig {
  const text = item.text.trim()
  if (!text) return c
  const entry: CustomChecklistItem = { id: item.id, text, ...(item.due ? { due: item.due } : {}), createdAt: now }
  return { ...c, customChecklist: [...(c.customChecklist ?? []).filter((i) => i.id !== item.id), entry] }
}

/** Removes a custom point together with its done state. */
export function withoutCustomChecklistItem(c: CampRuleConfig, id: string): CampRuleConfig {
  const { [id]: _drop, ...checklist } = c.checklist
  return { ...c, customChecklist: (c.customChecklist ?? []).filter((i) => i.id !== id), checklist }
}

/** Hides (true) or restores (false) a bundled checklist item id or deadline key for this camp. */
export function withChecklistHidden(c: CampRuleConfig, id: string, hidden: boolean): CampRuleConfig {
  const rest = (c.hiddenChecklist ?? []).filter((x) => x !== id)
  return { ...c, hiddenChecklist: hidden ? [...rest, id] : rest }
}
