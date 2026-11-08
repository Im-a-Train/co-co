/** Per-camp rule configuration defaults (catalog v2 §3.8). Pure; persistence in ../campRuleConfigStore.ts. */
import type { CampRuleConfig, Iri } from '../../types'

export function defaultCampRuleConfig(campIri: Iri, updatedAt: string = new Date(0).toISOString()): CampRuleConfig {
  return {
    campIri,
    zone: 'green',
    sport: null,
    modules: {},
    activityTags: {},
    sbApprovals: {},
    camp: { region: null, campForm: null, winterSafeAccess: null, abroad: null },
    angebot: { other4DayCamp: null, unternehmungElsewhere: null, efCoveredElsewhere: null, lastActivityDate: null },
    params: {},
    checklist: {},
    updatedAt,
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Fills missing fields of a stored (or imported) record with defaults; unknown fields are dropped. */
export function normalizeCampRuleConfig(raw: unknown, campIri: Iri): CampRuleConfig {
  const base = defaultCampRuleConfig(campIri)
  if (!isRecord(raw)) return base
  const obj = <T extends object>(v: unknown, d: T): T => (isRecord(v) ? ({ ...d, ...v } as T) : d)
  return {
    campIri,
    zone: 'green',
    sport: raw.sport === 'lst' || raw.sport === 'other' ? raw.sport : null,
    modules: obj(raw.modules, base.modules),
    activityTags: obj(raw.activityTags, base.activityTags),
    sbApprovals: obj(raw.sbApprovals, base.sbApprovals),
    camp: obj(raw.camp, base.camp),
    angebot: obj(raw.angebot, base.angebot),
    params: obj(raw.params, base.params),
    checklist: obj(raw.checklist, base.checklist),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
  }
}
