/**
 * Model-derived J+S answer of a camp for callers without a Vue context (MCP, deadlines): the same
 * `ctx.js` model that rules, grid, bars, tile and Selbstcheck use. Pure.
 */
import type { JsDayModel, RuleContext, RuleContextInput, RulePack } from '../../types'
import { completeContext } from './context'
import { bwzRequiredMinutes, computeJsDays, reportFromJsModel, thresholdsFromParams, type JsDayReport } from './jsDays'

/** Last date with J+S minutes in the day model (null if none). */
export function lastModelJsDate(model: JsDayModel): string | null {
  for (let i = model.days.length - 1; i >= 0; i--) if (model.days[i].jsMinutes > 0) return model.days[i].date
  return null
}

/** Required number of consecutive J+S days of the camp (`js.minConsecutiveDays`, or the offer-partner value). */
export function jsMinDaysOf(ctx: Pick<RuleContext, 'params' | 'campConfig'>): number {
  const partner = ctx.campConfig.angebot.other4DayCamp === true
  return ctx.params.get<number>(partner ? 'js.minConsecutiveDaysWithOfferPartner' : 'js.minConsecutiveDays')
}

export interface CampJsReport {
  report: JsDayReport
  model: JsDayModel
  lastJsDate: string | null
}

/** J+S report from the context model; null while the model is not usable (no confirmed mapping / no J+S tags). */
export function campJsReport(packs: readonly RulePack[], input: RuleContextInput): CampJsReport | null {
  const ctx = completeContext(packs, input)
  const model = ctx.js
  if (model.status !== 'ok') return null
  const t = thresholdsFromParams(ctx.params)
  const legacy = computeJsDays(input.facts, input.mapping, t)
  return { report: reportFromJsModel(model, legacy, t, ctx.campConfig.sport !== 'lst' ? null : bwzRequiredMinutes(ctx.params)), model, lastJsDate: lastModelJsDate(model) }
}
