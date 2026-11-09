/**
 * Guidance for the AI camp review (ADR 0014). Pure: picks the rules that describe what a good camp looks like
 * and renders them as compact German text for the prompt. The AI never produces `must` findings from this.
 */
import type { IsoDate, ModuleId, RulePack, RuleMeta } from '../types'
import { isDisabled, isValidOn } from './engine'

export interface AiGuidanceOptions {
  /** Camp start (null = no date filter on rules). */
  campStart: IsoDate | null
  disabledRuleIds?: Set<string>
  moduleStates?: Partial<Record<ModuleId, 'on' | 'suggested' | 'off'>>
}

/** Active 'ai' rules plus hard rules of the packs valid for the camp, minus disabled ones and modules that are off. */
export function aiGuidanceRules(packs: RulePack[], opts: AiGuidanceOptions): RuleMeta[] {
  const out: RuleMeta[] = []
  for (const pack of packs) {
    if (opts.campStart && !isValidOn(pack, opts.campStart)) continue
    for (const { meta } of pack.rules) {
      if (meta.status !== 'active') continue
      if (opts.campStart && !isValidOn(meta, opts.campStart)) continue
      if (isDisabled(meta, opts.disabledRuleIds)) continue
      if (opts.moduleStates?.[meta.module] === 'off') continue
      out.push(meta)
    }
  }
  // 'ai' rules first: guidanceText cuts at a char budget, and the guidance rules are what the review is for
  // (hard rules already produce engine findings that are sent separately).
  const rank = (r: RuleMeta) => (r.kind === 'ai' ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Compact guidance text: one line per rule (id, kind, title, description, source keys); cut at maxChars between rules. */
export function guidanceText(rules: RuleMeta[], maxChars: number): string {
  const lines: string[] = []
  let size = 0
  for (const r of rules) {
    const kind = r.kind === 'ai' ? 'Leitfaden' : 'Regel'
    const line = `- ${r.id} [${kind}] ${oneLine(r.title)}: ${oneLine(r.description)} (Quellen: ${r.sources.map((s) => s.key).join(', ')})`
    if (size + line.length + 1 > maxChars) break
    lines.push(line)
    size += line.length + 1
  }
  return lines.join('\n')
}
