# Rule packs

Bundled packs: `jslst/` (`coco-js-lst`: J+S general + Lagersport/Trekking modules) and `pbs/` (`coco-pbs`).
Decision: `docs/adr/0011-rule-set-v2.md`. Author API with code examples: `docs/plans/rules-v2/infra-api.md`.
Full catalog and policy: `docs/plans/rules-v2/catalog-final.md`. All user-visible texts are German; code
and comments are English; TypeScript predicates contain no German.

```
packs/
  sources.yaml              shared source registry (all packs)
  registry.ts index.ts      source registry access; loader + validateBundle + selectPacks
  <pack>/
    pack.yaml               pack metadata + modules
    params.yaml             versioned thresholds
    keywords/*.yaml         keyword sets (jslst also has docCheck.yaml for the safety-concept check)
    checklist.yaml          coach checklist items
    milestones.yaml         deadline-radar milestones
    rules/<RULE-ID>.yaml    one file per rule (schema v2)
    predicates/<module>.ts  `export const predicates: Record<string, RulePredicate>`; index.ts merges them
```

## pack.yaml

```yaml
id: coco-js-lst            # pack id; `aliases: [coco-basis]` keeps old settings working
name: "co-co J+S Lagersport/Trekking 2026.2"
version: 2026.2.0          # one version covers 2026 and 2027 (validity comes from rules/params)
validFrom: 2026-01-01
modules:
  - id: lst-wasser
    title: "Wasser"
    appliesWhen: { module: lst }          # jsCamp | sport: [..] | organizer: pbs | module: <id>
    default: auto                         # on | auto
    toggleable: true
    suggestWhen: [ { keywordSet: WATER, minActivities: 1 } ]    # -> state `suggested` (findings capped at hint)
    onWhen:      [ { activityTag: [sb-wasser] } ]               # coach tags confirm -> state `on`
```

Per camp the coach sets `auto`/`on`/`off` (Dexie `campRuleConfig`); resolution is `lib/moduleState.ts`.

## Rule YAML (schema v2)

Required: `id`, `version`, `module`, `status` (`active` | `retired`), `title`, `description`, `message`,
`severity`, `confidence`, `scope`, `validFrom`. Optional: `kind` (`hard` default | `ai`, see below), `validTo`, `messageVariants`, `inputs`, `params`,
`keywords`, `sources`, `formerIds`, `tags`. Every key in `params`/`keywords`/`sources` must exist.
Placeholders in texts use `{name}`; hits fill them (`params`, `variant`, `fragments`). Never hard-code a
threshold in a text: pass it as a param.

Policy (loader/engine enforced): `must` requires `confidence: verified`; `unverified`/`conflict` are capped at
`should`; predicates may lower severity/confidence per hit, never raise; a `suggested` module caps at `hint`.
Severity guide: binding current official source + deterministic data = `must`; proxy or keywords = `should`;
2014 sources = `should`/`unverified`; recommendations = `hint`/`best-practice`.

`kind: ai` rules are guidance for the AI camp review only (ADR 0014): the engine skips them (no finding), they
may not be `must`, and their keyword predicates stay for the catalog/explain. Rules whose output feeds J+S day counting,
Sicherheitsbereich detection or a binding requirement stay `hard` (allowlist HARD_KEYWORD_RULES in
`__tests__/aiKind.test.ts`).

Ids and `formerIds` are globally unique across packs. Replacing a rule: delete its YAML + predicate and list
the old id in the new rule's `formerIds` so overrides and disabled states carry over.

## sources.yaml, params.yaml, keywords, checklist, milestones

- **sources.yaml:** `- key: MB-UP` with title, url, date, authority. Rules cite `{ key, page, quote, binding }`.
  Old keys (L, C, LT) resolve via `formerKeys`.
- **params.yaml:** `key`, `label`, `unit`, `values` (rows with `value`, `validFrom`, optional `validTo`;
  contiguous, last row open-ended; `value: null` = criterion inactive), `sources`, `overridable`
  (`none` | `admin` | `coach`). Read with `ctx.params.get(key)`.
- **keywords/*.yaml:** `id`, `module`, optional `extends`, `include`, `exclude`. Entries: `=exact`, `^prefix`,
  `$suffix`, plain stem, phrase (contains a space), `{ regex: '...' }`. Write German words with umlauts; text
  is normalised before matching. Read with `ctx.keywords.match` / `matchActivity`; check coach activity tags first.
- **checklist.yaml:** items `id` (CL-*), `module`, `text`, `sources`, `kind` (B binding, E recommendation, 2014
  outdated), optional `showWhen` (campConfig / coachInput / activityTag / campInWinter conditions).
- **milestones.yaml:** `id`, `title`, `description`, `anchor` (start, end, leihmaterialDelivery,
  landeskartenDelivery, lastActivity, firstSb, outageOrderBy), `offsetDays` (latest date),
  `offsetEarliestDays`, `confidence` (`unverified` shows «unbestätigt»).

## Add a rule

1. `rules/<ID>.yaml` with texts, sources, params, keywords.
2. Predicate in `predicates/<module>.ts` (add to that file's `predicates` map).
3. New thresholds in `params.yaml`, new keyword sets in `keywords/*.yaml`.
4. Test `domain/rules/__tests__/<module>/<ID>.test.ts` with positive and negative cases (helpers:
   `FactsBuilder`, `makeCtx`, `msg`, `allPredicates` from `__tests__`).
5. Run `npm test` and `npm run typecheck`; the completeness/consistency tests check ids, sources, params,
   keywords and policy.

## Add a sport module or a new J+S sport

- **Module in an existing pack:** add it to `pack.yaml` (`appliesWhen`, `default`, triggers), put rules in
  `rules/` with `module: <id>`, add `predicates/<module>.ts` and register it in `predicates/index.ts`, add
  keyword sets and params, add i18n for the module title in the coach «Regelmodule» card if it is toggleable.
- **New J+S sport:** new pack folder (or new modules with `appliesWhen: { sport: [<id>] }`), add the sport to
  `campRuleConfig.sport` and the coach UI, register the pack in `packs/index.ts`. General J+S rules stay in
  module `js`. Known gap: JS-CAMP-01/JS-DAY/JS-FREE/JS-BWZ sit in `lst`, so another sport needs them moved or
  duplicated.
