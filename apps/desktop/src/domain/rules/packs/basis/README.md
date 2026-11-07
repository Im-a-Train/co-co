# Rule pack "co-co Basis 2026.1" – format

OWNER: rules builder. A rule = **YAML metadata** + **TypeScript predicate**, joined by `id`.

```
packs/basis/
  pack.yaml            # pack metadata
  rules/<RULE-ID>.yaml # one file per rule (RuleMeta, see src/domain/types.ts)
  predicates/*.ts      # grouped predicates, e.g. js.ts, completeness.ts, safety.ts, bestPractice.ts
  predicates/index.ts  # export const predicates: Record<string, RulePredicate>
```

## pack.yaml

```yaml
id: coco-basis
name: co-co Basis 2026.1
version: 2026.1.0
description: J+S-Lagerregeln, Vollständigkeit, Sicherheits-Heuristiken und PBS Best Practice.
validFrom: 2026-01-01
# validTo: optional
```

## rules/<RULE-ID>.yaml

```yaml
id: JS-DAY-01
version: 1.0.0
group: js                    # js | completeness | safety | best-practice
title: Gültiger J+S-Lagertag
description: >-
  Ein Lagertag zählt für J+S, wenn mindestens zwei J+S-Einheiten (LS/LA) mit
  zusammen mindestens 240 Minuten stattfinden.
message: "Tag {day}: {units} J+S-Einheiten, {minutes} Min. (nötig: 2 Einheiten, 240 Min.)"
severity: must               # must | should | hint
confidence: verified         # verified | conflict | unverified | best-practice | heuristic
scope: day                   # camp | day | activity | scheduleEntry | document
validFrom: 2026-01-01        # optional, compared with the camp start date
validTo: 2026-12-31          # optional
inputs: [mapping]            # optional: mapping | coachInputs | documents | settings
tags: [lagertag]
source:
  title: J+S Lager
  url: https://www.jugendundsport.ch/de/lager
```

Rules for metadata (enforced by `validateRuleMeta` + a vitest test over all YAML files):

- `confidence: unverified | conflict` ⇒ severity must NOT be `must`.
- Every rule cites a `source` (one of the four official links below, or the PBS Hering).
- Texts are German (they are UI content, like the feedback templates).
- Bump `version` when the behaviour changes; findings carry `ruleVersion`.

Sources: J+S Lager <https://www.jugendundsport.ch/de/lager> · Leitfaden Coach
<https://www.jugendundsport.ch/de/leitfaden-coach> · Lagersport/Trekking
<https://www.jugendundsport.ch/de/lagersport-trekking> · Hering <https://hering.scout.ch/de>

## Predicates

```ts
import type { RulePredicate } from '@/domain/types'
export const jsDay01: RulePredicate = (ctx) =>
  computeJsDays(ctx.facts, ctx.mapping).days
    .filter((d) => !d.valid && !d.validCombined)
    .map((d) => ({ targets: [d.dayIri], params: { day: d.number, units: d.unitCount, minutes: d.jsMinutes } }))
```

- Pure functions of `RuleContext`; no I/O, no `Date.now()` (use `ctx.now`).
- Return `[]` when satisfied, or when required inputs are missing and the rule cannot decide
  (then return one camp-level hit with `severity: 'hint'` asking for the coach input, if useful).
- Each pack/rule is loaded via `import.meta.glob(..., { query: '?raw', import: 'default', eager: true })`.


## Implementation notes (rules builder)

- 33 rules, ids as in the SPEC. YAML files: `rules/<ID>.yaml`, predicates grouped in `predicates/{js,completeness,safety,bestPractice}.ts`
  and registered in `predicates/index.ts` (the loader throws if a YAML has no predicate or vice versa).
- Message templates use `{param}` placeholders filled from `RuleHit.params`. A hit may replace the whole template with
  `params._message` (used for "Angabe fehlt" style hints).
- Hits may only *downgrade* severity (e.g. missing coach input -> `hint`). The engine additionally clamps
  `unverified`/`conflict` rules from `must` to `should`.
- Finding ids are `${ruleId}:${targets.join('|')}`. JS-DL-03 uses `[campIri, 'leihmaterial' | 'landeskarten']`, JS-DAY-04 uses
  `[firstDayIri, lastDayIri]`, SAFE-MTN-02 and SAFE-DOC-01 add the document id as second target.
- Day logic lives in `../../jsDays.ts` (shared with the cockpit grid); deadlines in `../../deadlines.ts`.
- Keyword heuristics (`predicates/util.ts`): `stem` = contains, `=word` = exact (+ e/en/n/s), `^stem` = prefix, `$stem` = suffix.
- Heuristic thresholds that are NOT from an official source (marked `heuristic`/`conflict`/`best-practice`): JS-STAFF-01
  (>= 2 Leitende, <= 10 Teilnehmende pro Leitende), BP-SLEEP-01 hours per Stufe, BP-REST-01 (60 min gap, 07-22 h), BP-VAR-01.
