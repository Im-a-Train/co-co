# Rules v2 infrastructure: API for rule authors

Spec: `catalog-final.md` §2–§3. This file documents what is implemented. Paths are relative to
`apps/desktop/src/domain/rules/`.

## Layout

```
lib/        util.ts (facts/evidence/MiData helpers), keywords.ts (matcher), params.ts, sources.ts,
            jsDays.ts (legacy computeJsDays + v2 buildJsDayModel), timeWindows.ts, birthYear.ts,
            deadlines.ts, moduleState.ts, context.ts (completeContext), campRuleConfig.ts, docCheck.ts
packs/sources.yaml                 source registry (§1); old keys L/C/LT resolve via formerKeys
packs/registry.ts                  getSourceRegistry()
packs/index.ts                     loader + cross-pack validation (validateBundle), selectPacks (aliases)
packs/jslst/  pack.yaml params.yaml keywords/*.yaml rules/*.yaml predicates/{js,lst,lager,trekking,berg,wasser,winter,ebb,consistency}.ts
packs/pbs/    pack.yaml params.yaml keywords/pbs.yaml rules/*.yaml predicates/{pbs,index}.ts
campRuleConfigStore.ts             Dexie table campRuleConfig (v5): get/put/updateCampRuleConfig
```

Each `predicates/<module>.ts` exports `predicates: Record<string, RulePredicate>`; `predicates/index.ts`
merges them with `mergePredicates` (duplicate ids throw). A rule YAML without predicate (or vice versa) throws.

## Rule YAML (schema v2)

```yaml
id: LST-WASSER-04
version: 2.0.0
module: lst-wasser            # required; must exist in the pack. `group` is derived (= module)
status: active                # active | retired (retired: in catalog, never evaluated)
title: "Wasseraufsicht: Qualifikation fehlt"
description: "…"
message: "«{title}»: {detail}"
messageVariants:              # optional; hit.variant selects one; also used by hit.fragments
  missingData: "…"
  reasonsJoin: " und "        # optional joiner for fragments of placeholder {reasons} (default "; ")
severity: should              # must requires confidence verified (loader throws)
confidence: heuristic
scope: activity               # one value; a hit may still target the camp IRI
validFrom: 2026-01-01
inputs: [midata, activityTags, params, keywords]
params: [lst.ropeMinSafetyChars]      # every key must exist (paramNotes, explain)
keywords: [WATER, POOL]               # every set must exist
sources:
  - { key: MB-UP, page: "S. 5", quote: "Für Aktivitäten IM oder AUF dem Wasser …", binding: true }
formerIds: [SAFE-WATER-01]            # overrides/ruleState/disabled ids under these ids carry over
tags: [wasser]
```

Loader checks: ids + formerIds globally unique (a formerId never equals a live id), sources/params/keywords
resolve, `must ⇒ verified`. Legacy `source: {title, url}` is still accepted (mapped by URL to a key).
No German in TS: put every text (incl. «Angabe fehlt»-style details) in `message`/`messageVariants`.

## Predicate output (`RuleHit`)

- `params` fill `{placeholders}`; `variant` picks `messageVariants[variant]`.
- `fragments: { reasons: [{ variant: 'tooShort', params: { chars: 12 } }, { variant: 'noTopics' }] }` renders
  each fragment from `messageVariants` and joins them into `{reasons}`.
- `severity` / `confidence` may only lower the YAML values (confidence order verified > best-practice >
  heuristic > unverified > conflict). The engine caps unverified/conflict at should and a `suggested`
  module at hint (+ `finding.moduleNote`, i18n `rules.module.suggestedNote`).
- `inputs` / `redKeys` as before (explain panel; red = MiData/NDS).
- Keep the `findingId` format: `${ruleId}:${targets.join('|')}`.

## params.yaml

```yaml
- key: js.minBwzDayMinutes
  label: "Bewegungszeit pro J+S-Tag"
  unit: minutes
  values:
    - { value: null, validFrom: 2026-01-01, validTo: 2026-12-31 }   # null = criterion inactive
    - { value: 120, validFrom: 2027-01-01 }                         # last row open-ended, rows contiguous
  sources: [{ key: MAN, page: "S. 21" }]
  overridable: none            # none | admin (settings.ruleParams) | coach (+ campConfig.params)
```

`ctx.params.get<T>(key)` (throws for unknown keys / uncovered dates), `ctx.params.isOverridden(key)` →
`{value, default} | null`, `ctx.params.def(key)`. Times are "HH:MM" strings (`hhmmToMinutes` in lib/params),
windows `{from, to}`. Never hard-code a threshold in a message: pass it as a param (`{min}`).

## keywords/*.yaml

```yaml
- id: WATER
  module: lst-wasser
  extends: []                 # merge include + exclude of other sets
  include: ["=baden", schwimm, "^flussfahrt", "$see", "stand up paddle", { regex: '\b(ww|wildwasser)\s*(iii|[3-6])\b' }]
  exclude: [trinkwasser, "see you"]
```

`=` exact (+e/en/n/s/er), `^` prefix, `$` suffix, plain = stem, any entry with a space = phrase (word
boundaries on both ends), `{regex}` on the normalised text. Text is lower-cased, `baden-powell` stripped,
non-letters → space, umlauts folded (write lists with umlauts only). Excluded phrase spans are removed first;
excluded tokens (prefix match) are skipped.
`ctx.keywords.match(setId, text) → {term, field: 'text'}[]`;
`ctx.keywords.matchActivity(setId, activity, fields = ['title','location','storyboard','notes'])` (memoised;
`ALL_ACTIVITY_FIELDS` in lib/keywords adds 'safety'). Activity tags (`ctx.campConfig.tagsOf(iri)`) override
keyword detection: check tags first.

## ctx.campConfig (ResolvedCampRuleConfig)

Stored `CampRuleConfig` (§3.8) with defaults, `sport` resolved ('lst' default), `isDefault`,
`tagsOf(activityIri)`, `moduleStates[moduleId] = { state: on|off|suggested, coachState, reasons[] }`
(reasons are i18n keys `rules.module.reason.*` + params). Resolution: `lib/moduleState.ts`
`resolveModuleStates` (§2.3). Unknown organizer counts as PBS; coach 'on' overrides an organizer mismatch.

## ctx.js (JsDayModel, lazy)

`status` ('unknown' without mapping and J+S tags), `days[]` with `{dayIri, date, number, isFirst, isLast,
intervals, unitIntervals, jsMinutes, units, shortGaps, shortEntryIris, entryIris, bwzMinutes, bwzKnown,
isJsDay, windowsCovered}`, `jsDayCount`, `endDaysMode` ('single'|'combined'|'none'), `trainingFreeDays`,
`isJsActivity(iri)` (tags `keine-js-aktivitaet` / `js-aktivitaet`/`ebb-a`/`ebb-b`, else mapping LS/LA).
Parallel entries are united, midnight-crossing entries split, entries < js.minUnitMinutes dropped, BWZ per
entry (< js.minBwzActivityMinutes → 0), first+last day combined when neither counts alone. The legacy
`computeJsDays` (cockpit, existing JS-DAY rules) is unchanged and takes thresholds via `thresholdsFromParams`.

Other helpers: `lib/birthYear.ts` (J+S age by Jahrgang), `lib/deadlines.ts` (`leadTimesFromParams`),
`lib/timeWindows.ts`.

## Adding a rule

1. `packs/<pack>/rules/<ID>.yaml` (schema above; sources from `sources.yaml`; texts German).
2. Predicate in `packs/<pack>/predicates/<module>.ts`, added to that file's `predicates` map.
3. Params/keyword sets it reads → `params.yaml` / `keywords/*.yaml` and the rule's `params`/`keywords` lists.
4. Test `domain/rules/__tests__/<module>/<ID>.test.ts` (positive + negative cases of the catalog).
5. Replacing an old rule: delete its YAML + predicate, list the old id in `formerIds`.

## Test helpers (`__tests__/factory.ts`, `__tests__/predicates.ts`)

```ts
import { allPredicates as p } from '../predicates'          // both packs; hits remember their rule id
import { FactsBuilder, makeCtx, msg, CAT_LS } from '../factory'

const b = new FactsBuilder({ start: '2027-07-12', days: 5 })
const a = b.activity('Baden im See', CAT_LS)
b.entry(a, 2, '14:00', '16:00', { ys: 60 })
const ctx = makeCtx(b.facts, {
  campConfig: { modules: { 'lst-wasser': 'on' }, activityTags: { [a.iri]: ['sb-wasser'] } },
  paramValues: { 'lst.ropeMinSafetyChars': 100 },   // forced values (bypass overridable)
  coachInputs: makeCoachInputs({ participantsCount: 14 }),
})
const hits = p['LST-WASSER-04'](ctx)
expect(msg(hits[0])).toContain('…')                 // rendered like the engine (variants, fragments)
evaluate(loadBundledPacks(), ctx)                    // full engine run incl. module states
```

`makeCtx` uses the bundled packs' params and keyword sets; `ctx.js` is built lazily from the same context.
