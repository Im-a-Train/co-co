# ADR 0011: Rule set v2 (modular packs, per-camp module states, pack data, strict severity policy)

- Status: accepted
- Date: 2026-11-09

## Context

The first rule set («co-co Basis 2026.1», pack `packs/basis`) was one flat list of rules with
hard-coded thresholds, hard-coded keyword lists and a source given as a title + URL. Three things
pushed us to rebuild it:

1. **Better sources.** The official J+S documents are now available in a citable form: Merkblatt
   Unfallpraevention (`MB-UP`), Leitfaden Lager (`LEITFADEN`), the Lagersport/Trekking manual and tools
   (`MAN`, `TOOL-V/G/P`), the web pages for Lager, Coach, Sicherheit etc., the PBS 2027 slides (`PBS27`)
   and the older brochures (`LAGER` 2014, `BERG` 2014, `WASSER`/`WINTER` 2019). Each has a different
   authority. They are registered in `packs/sources.yaml`.
2. **The 2027 model.** From camps starting 2027-01-01 the J+S day model changes (e.g. movement time per
   J+S day, camp length counted in J+S days). One rule pack must serve 2026 and 2027.
3. **Not every camp needs every rule.** Water, mountain, winter and complementary movement blocks only
   matter when the camp does such things. Non-PBS camps do not want PBS recommendations. Other J+S sports
   will follow Lagersport/Trekking (LS/T).

The full catalog (all rules, sources, params, keyword sets, checklist, milestones, review) is in
`docs/plans/rules-v2/catalog-final.md`; the implemented API for authors is in
`docs/plans/rules-v2/infra-api.md`.

## Decision

1. **Modular packs.** Two bundled packs: `coco-js-lst` (`packs/jslst/`, modules `js`, `lst`, `lst-lager`,
   `lst-trekking`, `lst-berg`, `lst-wasser`, `lst-winter`, `lst-ebb`) and `coco-pbs` (`packs/pbs/`, module
   `pbs`). The old id `coco-basis` stays valid through `aliases`. 109 rule files: 108 active, 1 retired
   (`JS-STAFF-01`).
2. **Per-camp module states.** A module has `appliesWhen`, a default (`on`/`auto`), optional suggest
   and tag triggers. Per camp the coach can set `auto`/`on`/`off`; the resolved state is `on`, `off` or
   `suggested`. A `suggested` module runs, but all its findings are capped at `hint` and carry a note.
   Resolution is a pure function (`lib/moduleState.ts`). The coach settings are stored per camp in the
   Dexie table `campRuleConfig` (v5): module states, sport, camp context (region, form, winter-safe
   access, abroad), offer context, activity tags (`sb-berg`, `sb-wasser`, `ebb-a`, `keine-js-aktivitaet` …)
   and Sicherheitsbereich approvals.
3. **Pack data instead of code constants.** Thresholds live in `params.yaml` (rows by validity date, so
   2026 and 2027 coexist; `null` = criterion inactive; optional overrides), keyword sets in
   `keywords/*.yaml` (with `extends`, exclusions and regex), sources in the shared `packs/sources.yaml`,
   the coach checklist in `checklist.yaml` and the deadline radar in `milestones.yaml`. Rule YAML carries
   all German texts (`message`, `messageVariants`); TypeScript predicates contain no German.
4. **Strict severity policy.** `must` only for a binding statement in a current official source **and** a
   deterministic check on data (eCamp facts, coach inputs/tags, MiData/NDS aggregates, GPX numbers).
   Proxy data or keyword detection: `should`. 2014 sources: `should` + `unverified` or lower. 2019
   brochures: `should` + `heuristic`. Recommendations (PBS, didactic): `hint` + `best-practice`.
   Contradicting sources: `conflict`, never `must`. The loader rejects `must` without `verified`, the
   engine caps `unverified`/`conflict` at `should`, predicates may only lower severity/confidence per hit.
   The few explicit exceptions are listed in catalog §0.3 (JS-DAY-02/03 and JS-BWZ-02 `step` are `must`;
   JS-DAY-01/04, JS-BWZ-27, JS-FREE-01 and camp-level Winter SB are `should`).
5. **Maintainer decisions.**
   - The strict policy above applies to every rule.
   - **From 2027 days without J+S activities never break the run of J+S days.** JS-CAMP-01 then counts
     J+S days only; free days and days failing the J+S-day criteria are skipped. The rule message says
     so. For 2026 it keeps the calendar duration required by the Leitfaden.
   - **One PR** for infrastructure, rules, keywords, params, checklist and milestones.
6. **Traceability.** A finding carries `module` and `sources` (key, page, quote, binding flag); the
   explain panel and the rule catalog show them. Superseded rules list their old ids in `formerIds`, so
   stored overrides, rule states and disabled ids carry over. Ids and formerIds are globally unique.

## Consequences

- **Adding a further J+S sport module later** (another sport after LS/T): add the module to a pack's
  `pack.yaml` with `appliesWhen: { sport: [<id>] }`, add the sport value to `campRuleConfig.sport` and the
  coach UI, put its params/keywords/rules/predicates in a pack (new or existing) and register the
  predicate file. JS-wide rules stay in module `js`. The engine does not change. Known gap: rules in
  `lst` (JS-CAMP-01, JS-DAY, JS-FREE, JS-BWZ) are LS/T only for now, so `sport: other` camps get only the
  `js` module.
- **Storage:** Dexie v5 adds `campRuleConfig` (key `campIri`); backup export/import covers it
  (`TABLE_NAMES`). It holds coach choices only, no red data.
- **Migration:** overrides and rule states keyed by old ids resolve through `formerIds`; the old
  `milestones/pbs.yaml` moved to `packs/pbs/milestones.yaml`.
- **Maintenance:** rules reference sources, params and keyword sets by key; the loader validates all of
  them, so typos fail at start-up and in tests.
- **Interpretations that need J+S confirmation** (catalog §11, shortest list): free days for even camp
  lengths (sources disagree, JS-FREE-01 is `conflict`), time-of-day window boundaries, movement time on
  the combined first/last day, the 2027 start date of the whole model, whether eCamp keeps the LA
  thematic areas, the LS/T subsidy group size, exact MiData labels for the new qualification keys.
- **Known small gaps:** document kinds `sicherheitskonzept`, `lagerregeln`, `lagerinfo` are matched by
  filename keyword sets (`DocumentKind` has none of them); the child age < 10 is a J+S definition
  constant in the trekking predicates; the 90 % threshold of LST-LAGER-02 is a TS constant; PBS method
  keyword lists are provisional (Pfadiprofil not obtained).

## Alternatives considered

- **Keep one flat pack, add a toggle per rule.** Rejected: dozens of toggles, no grouping, no reasons.
- **Auto-enable modules only from keywords.** Rejected: keyword detection is heuristic; the suggested
  state plus coach confirmation keeps findings honest.
- **Several PRs.** Rejected by the maintainer: the catalog is self-consistent and splitting it would leave
  rules depending on infrastructure that is not there yet.
