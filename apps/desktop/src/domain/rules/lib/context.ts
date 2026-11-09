/**
 * Completes a RuleContextInput to a RuleContext (catalog v2 §3.7): params reader, keyword matcher,
 * resolved camp rule config with module states, and the lazily built J+S day model. Pure.
 */
import type {
  ActivityTag,
  CampRuleConfig,
  Iri,
  IsoDate,
  JsDayModel,
  KeywordSetDef,
  ParamDef,
  ParamValue,
  ResolvedCampRuleConfig,
  RuleContext,
  RuleContextInput,
  RulePack,
} from '../../types'
import { defaultCampRuleConfig, normalizeCampRuleConfig } from './campRuleConfig'
import { buildJsDayModel } from './jsDays'
import { compileKeywordSets, createKeywordMatcher, type CompiledSet } from './keywords'
import { resolveModuleStates } from './moduleState'
import { createParamReader } from './params'

/** Camp start (fallback: evaluation day) – the date params and validity are resolved for. */
export function contextDate(input: Pick<RuleContextInput, 'facts' | 'now'>): IsoDate {
  return input.facts.camp.start ?? input.now.toISOString().slice(0, 10)
}

// Compiled keyword sets are cached for the last seen combination of pack keyword lists.
let lastSets: { refs: (KeywordSetDef[] | undefined)[]; compiled: Map<string, CompiledSet> } | null = null

export function compiledSetsOf(packs: readonly RulePack[]): Map<string, CompiledSet> {
  const refs = packs.map((p) => p.keywordSets)
  if (lastSets && lastSets.refs.length === refs.length && lastSets.refs.every((r, i) => r === refs[i])) return lastSets.compiled
  const compiled = compileKeywordSets(packs.flatMap((p) => p.keywordSets ?? []))
  lastSets = { refs, compiled }
  return compiled
}

export function paramDefsOf(packs: readonly RulePack[]): ParamDef[] {
  return packs.flatMap((p) => p.params ?? [])
}

const isResolved = (c: CampRuleConfig | ResolvedCampRuleConfig): c is ResolvedCampRuleConfig =>
  'moduleStates' in c && typeof (c as ResolvedCampRuleConfig).tagsOf === 'function'

const coversDate = (v: { validFrom?: IsoDate; validTo?: IsoDate }, date: IsoDate): boolean =>
  (!v.validFrom || date.slice(0, 10) >= v.validFrom.slice(0, 10)) && (!v.validTo || date.slice(0, 10) <= v.validTo.slice(0, 10))

export function completeContext(packs: readonly RulePack[], input: RuleContextInput): RuleContext {
  const date = contextDate(input)
  const stored = input.campConfig ?? null
  const resolvedIn = stored && isResolved(stored) ? stored : null
  const record: CampRuleConfig = resolvedIn
    ? { ...resolvedIn, sport: resolvedIn.sport }
    : stored
      ? normalizeCampRuleConfig(stored, input.facts.camp.iri)
      : defaultCampRuleConfig(input.facts.camp.iri)

  const params =
    input.params ??
    createParamReader({
      defs: paramDefsOf(packs),
      date,
      adminParams: input.settings.ruleParams ?? null,
      campParams: record.params as Record<string, ParamValue>,
    })
  const keywords = input.keywords ?? createKeywordMatcher(compiledSetsOf(packs))

  let campConfig: ResolvedCampRuleConfig
  if (resolvedIn) campConfig = resolvedIn
  else {
    const tagsOf = (iri: Iri): ActivityTag[] => record.activityTags[iri] ?? []
    const base = { ...record, sport: record.sport ?? 'lst', isDefault: !stored, tagsOf } as const
    campConfig = {
      ...base,
      // Only packs that cover the camp date contribute modules (no covering pack → no module states, no findings).
      moduleStates: resolveModuleStates({
        modules: packs.filter((p) => coversDate(p, date)).flatMap((p) => p.modules ?? []),
        facts: input.facts,
        coachInputs: input.coachInputs,
        documents: input.documents,
        config: base,
        keywords,
        params,
      }),
    }
  }

  const ctx = { ...input, campConfig, params, keywords } as Omit<RuleContext, 'js'> & { js?: JsDayModel }
  if (input.js) ctx.js = input.js
  else {
    let model: JsDayModel | null = null
    Object.defineProperty(ctx, 'js', {
      enumerable: true,
      configurable: true,
      get: () =>
        (model ??= buildJsDayModel({ facts: input.facts, mapping: input.mapping, tagsOf: campConfig.tagsOf, params })),
    })
  }
  return ctx as RuleContext
}
