/** Shared MiData qualification counting for rule predicates (respects the coach's qualMapping overrides). Pure. */
import type { MidataAggregate, MidataQualKey } from '@/domain/types'
import { MIDATA_QUAL_KEYS_V2 } from '@/domain/types'
import { effectiveKeys } from '@/domain/midata'

type Overrides = Record<string, MidataQualKey[]>

const isV2Key = (key: string): boolean => (MIDATA_QUAL_KEYS_V2 as readonly string[]).includes(key)

/**
 * True when the aggregate can answer v2 questions (sbBerg/…/water*): some qualification kind or some leader
 * carries a v2 key. Aggregates stored before rule set v2 have none, which means «unknown», not «nobody».
 */
export function hasV2Data(md: MidataAggregate, overrides: Overrides = {}): boolean {
  if (md.qualificationKinds?.some((k) => effectiveKeys(k, overrides).some(isV2Key))) return true
  return md.leaders.some((l) => MIDATA_QUAL_KEYS_V2.some((key) => l.qualifications[key] !== undefined))
}

/** Maximum over kinds (one person can hold several kinds, so a sum would double count). */
const maxOverKinds = (md: MidataAggregate, key: MidataQualKey, overrides: Overrides): number =>
  (md.qualificationKinds ?? []).filter((k) => effectiveKeys(k, overrides).includes(key)).reduce((m, k) => Math.max(m, k.validLeaders), 0)

/**
 * Number of DISTINCT leaders with a valid qualification `key`; null = not determinable (no MiData, unreadable
 * qualifications, or - for v2 keys - an aggregate without any v2 data). Counts md.leaders unless the override
 * map changes which kinds carry the key; then it falls back to the kinds (max, never the sum).
 */
export function distinctLeadersWithKey(md: MidataAggregate | null | undefined, key: MidataQualKey, overrides: Overrides = {}): number | null {
  if (!md || md.qualificationsReadable === false) return null
  const kinds = md.qualificationKinds ?? []
  if (isV2Key(key) && !hasV2Data(md, overrides)) return null
  if (kinds.length === 0 && md.leaders.length === 0) return md.qualificationKinds ? 0 : null
  const overridden = kinds.some((k) => effectiveKeys(k, overrides).includes(key) !== k.keys.includes(key))
  if (md.leaders.length > 0 && !overridden) return md.leaders.filter((l) => (l.qualifications as Record<string, boolean | undefined>)[key] === true).length
  if (kinds.length > 0) return maxOverKinds(md, key, overrides)
  return null
}
