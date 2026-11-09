/**
 * Default general feedback points ("Allgemein"): topics a coach checks for every camp. Texts live in
 * `feedback.general.<id>.*` (src/locales/de/feedback.json). Pure.
 */
import type { FeedbackItem } from '../types'

export interface GeneralPoint {
  id: string
  /** i18n key of the title. */
  titleKey: string
  /** i18n key of the coach prompt (also the prefilled feedback text). */
  promptKey: string
  /** i18n keys of the check bullets. */
  checks: string[]
  /** Related rules (see domain/rules/packs). */
  ruleIds?: string[]
  /** Related checklist items (checklist.yaml of the rule packs). */
  checklistIds?: string[]
}

function point(id: string, checkCount: number, extra: Pick<GeneralPoint, 'ruleIds' | 'checklistIds'> = {}): GeneralPoint {
  return {
    id,
    titleKey: `feedback.general.${id}.title`,
    promptKey: `feedback.general.${id}.prompt`,
    checks: Array.from({ length: checkCount }, (_, i) => `feedback.general.${id}.check${i + 1}`),
    ...extra,
  }
}

export const GENERAL_POINTS: readonly GeneralPoint[] = [
  point('siko', 4, { ruleIds: ['LST-LAGER-01'] }),
  point('psa', 5, { checklistIds: ['CL-LAGER-07'] }),
  point('notfall', 4, { checklistIds: ['CL-LAGER-03', 'CL-LAGER-04', 'CL-LAGER-13'] }),
  point('rega', 3, { checklistIds: ['CL-JS-05'] }),
  point('krise', 4, { checklistIds: ['CL-LAGER-01', 'CL-LAGER-09'] }),
  point('wetter', 3),
  point('hygiene', 4, { checklistIds: ['CL-LAGER-08'] }),
  point('nachtruhe', 3, { ruleIds: ['LST-LAGER-06'] }),
  point('stufengerecht', 4),
  point('js-admin', 4, { ruleIds: ['JS-DL-01', 'JS-DL-02'], checklistIds: ['CL-JS-01', 'CL-JS-02', 'CL-JS-03'] }),
]

export function generalPointById(id: string): GeneralPoint | undefined {
  return GENERAL_POINTS.find((p) => p.id === id)
}

/** Ids of the default points that already have a feedback item. */
export function usedGeneralPointIds(items: readonly Pick<FeedbackItem, 'generalPointId'>[]): Set<string> {
  const out = new Set<string>()
  for (const i of items) if (i.generalPointId) out.add(i.generalPointId)
  return out
}

/** The default points that are not hidden for a camp (order kept). */
export function visibleGeneralPoints(hiddenIds: readonly string[]): GeneralPoint[] {
  const hidden = new Set(hiddenIds)
  return GENERAL_POINTS.filter((p) => !hidden.has(p.id))
}
