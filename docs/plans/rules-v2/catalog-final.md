# co-co Rule Catalog v2 (final, implementation-ready)

> Status: final merge of the research catalog (`docs/plans/rules-v2/catalog.md`), its review corrections (A–F), the newly obtained official J+S sources (MB-UP, LEITFADEN, WEB-SICH, WEB-L, WEB-C …) and the maintainer's decisions, plus the fixes from the consistency review `catalog-final-review.md` (§12). Date: 2026-11-08. This document replaces the draft. Everything described here ships in **one PR**.
>
> Conventions:
> - Prose is English. Rule titles, messages and keywords are German.
> - Citations use `[KEY S.n]` for printed pages, `[KEY «Abschnitt»]` for web pages and `[KEY slide n]` for PBS27.
> - `{x}` marks a message placeholder.

---

## 0. Decisions and severity policy

### 0.1 Maintainer decisions (binding for this catalog)

1. **Strict severity policy (§0.2).** It applies to every rule, with no exceptions unless one is listed explicitly in §0.3.
2. **2027: days without J+S activities never break the run.**
   - From camps starting 2027-01-01, JS-CAMP-01 counts **J+S days only**.
   - Two kinds of day are **skipped**, meaning they are not counted and do not break the run:
     - a day without J+S activities (free day);
     - a day that has J+S activities but fails the J+S-day criteria (minutes, units, movement time).
   - In practice, the run length equals the number of J+S days in the camp. The first and last day count as one J+S day when they are combined (JS-DAY-04).
   - The rule message says this explicitly.
   - For 2026, JS-CAMP-01 keeps the calendar-day duration, as the LEITFADEN requires.
3. **One PR.** Infrastructure, all rule changes, keywords, params, the checklist and the milestones ship together. The catalog is self-consistent: no rule depends on something listed only as "later".

### 0.2 Severity / confidence policy

| Situation | Allowed maximum |
|---|---|
| Binding statement in a **current** official J+S source (MAN 2026, TOOL-V, EBB-C, EBB-L, PBS27 quoting J+S, MB-UP, LEITFADEN, WEB-SICH, WEB-L, WEB-C, WEB-ZA, WEB-LU) **and** a deterministic check on data (eCamp facts, coach inputs, coach tags, MiData/NDS aggregates, GPX numbers) | `must` + `verified` |
| Binding current statement, check deterministic but the data is only a proxy for the requirement | `should` + `verified` |
| Binding current statement, detection by keyword/regex | `should` + `heuristic` |
| Only a 2014 source (LAGER, BERG) | `should` + `unverified`, or lower |
| 2019 didactic brochures (WASSER, WINTER) with "muss" wording | `should` + `heuristic` |
| Recommendation (didactic, PBS) | `hint` + `best-practice` |
| Sources contradict each other | `hint` or `should`, + `conflict` (never `must`; the engine enforces this) |

Further rules:
- **Coach tags count as data.** A rule that fires only on activities the coach tagged (e.g. `sb-berg`) is deterministic. A rule that infers the same from keywords is heuristic.
- **Per-hit downgrades.** Predicates may lower `severity` per hit, as today, and newly also `confidence` (see §3.6). They never raise either.
- **Suggested modules.** A module in state `suggested` caps all of its findings at `hint`.

### 0.3 Explicit policy notes

- **JS-DAY-02, JS-DAY-03 and JS-BWZ-02 (variant `step` only) are `must` even though a short unit "simply does not count".** These are presentation duties of the camp programme: «Die J+S-Aktivitäten und deren Inhalte müssen klar beschrieben und im Programm ersichtlich sein» [WEB-L «Lagerprogramm»]; «klar voneinander getrennt» [LEITFADEN «Aktivitätendauer»]; «in 15-Minuten-Schritten … ausgewiesen» [TOOL-V]. A programme that marks invalid blocks as J+S is defective as submitted. This follows review correction C. JS-BWZ-02 variant `under30` is **not** covered by this note: TOOL-V only says the movement time «muss **ab** einer Dauer von 30 Minuten … ausgewiesen werden», so a 20-minute value is not forbidden, it just does not count; `under30` is therefore `should`.
- **JS-DAY-01, JS-DAY-04, JS-BWZ-27 and JS-FREE-01 are `should`.** A day that fails the criteria is not a violation in itself: it is a trainingsfreier Tag [LEITFADEN «Trainingsfreie Tage»]. The `must` sits on the count (JS-CAMP-01). JS-FREE-01 stays `should`, because the sources contradict each other for even camp lengths (and, from 2027, on the cap itself; see JS-FREE-01).
- **Camp-level Sicherheitsbereich Winter is `should`, not `must`.** The camp case of LST-SB-02/03 («Lager ohne wintersichere Zufahrt») depends on whether the camp is «im Winter», which co-co decides with the co-co param `lst.winterMonths`. That is a proxy, so these hits are lowered to `should` per hit; activity hits from coach `sb-*` tags stay `must`.

---

## 1. Source registry (`packs/sources.yaml`)

Weights:
- `binding`: official, current.
- `binding-quote`: binding only where it quotes J+S.
- `didactic`: teaching material, partly binding.
- `outdated`: 2014; at most should/unverified.
- `pbs`: association best practice.
- `info`

| Key | Title | Edition / date | URL / file | Weight | Read status / notes |
|---|---|---|---|---|---|
| **MAN** | Manual Lagersport/Trekking (BASPO) | edition 2026, available since 16.10.2026 | `co-co-docs/Manual Lagersport _ Trekking.pdf` | binding (S.21 Fig. 4 core) | Read in full. PDF page = printed page (correction A). Not read: images S.46–47 (safety management, Ampelschema) and the Fig. 4 image. S.21 says «auf mindestens zwei Tageszeiten verteilt» without «pro Lagertag». |
| **TOOL-V** | J+S tool module «Lagersport/Trekking Vorgaben» `6a87f378…` | updated 2026-10-15 | J+S tool | binding | Text read. Images (Angebot.png, Lager.png, Activites.svg) not read. |
| **TOOL-G** | J+S tool module «Lagersport/Trekking Grundlagen» `6a60d154…` | 2026 | J+S tool | didactic | Read. |
| **TOOL-P** | J+S tool module «Eine gute J+S-Aktivität planen» `6a75d5f5…` | 2026-10-14 | J+S tool | didactic | Read. Linked modules «Sicherheit in der Planung» and «Innovieren» not fetched. |
| **PBS27** | 2027 Neuigkeiten von PBS und J+S | Oct 2026 | `co-co-docs/2027_neuigkeiten_von_pbs_und_js_de.pdf` | binding-quote | Slides 3, 13 and 15 are graphics/video, not read. |
| **EBB-C** | Checkliste Ergänzende Bewegungsblöcke für Coachs | status 12/2025 | co-co-docs | binding | Read. |
| **EBB-L** | Checkliste Ergänzende Bewegungsblöcke für Lagerleitende | status 12/2025 | co-co-docs | binding | Read. |
| **GST** | Merkblatt Grundlagen Sportfachtechnik LS/T (100.01.de) | 09/2026 | co-co-docs | info | Read. |
| **LAGER** | LS/T Lager (brochure) | 2014 | `co-co-docs/LS-T_Lager_d.pdf` | outdated | Read. Module names and SPORTdb references are outdated. |
| **BERG** | LS/T Berg (brochure) | 2014 | `co-co-docs/LS-T_Berg_d.pdf` (printed = PDF − 2) | outdated | Read. |
| **WASSER** | LS/T Wasser (brochure) | 2019 | `co-co-docs/LS-T_Wasser_d.pdf` | didactic | Read. S.8 «Wildwasser I und II» has no «nur» (correction A). |
| **WINTER** | LS/T Winter (brochure) | 2019 | `co-co-docs/LS-T_Winter_d.pdf` (printed = PDF − 2) | didactic | Read. The basic rules are binding now through MB-UP S.4. |
| **MB-UP** | Unfallprävention und Sicherheitsanforderungen in Lagersport/Trekking, BASPO/JES 30.401.501 d | Ausgabe 10/2025 (PDF 17.11.2025), 6 pages | https://jsle.ch/dMB1 → https://www.jugendundsport.ch/dam/de/sd-web/hD0eoaQct7HC/2025-0374_mb-unfallpraevention-LST-berg-winter-wasser_DE.pdf | binding (declared binding by LEITFADEN and WEB-L «müssen … unbedingt eingehalten werden») | All 6 pages read. No ratios, deadlines, programme rules or 2027 model. |
| **LEITFADEN** | Leitfaden für J+S-Angebote aller J+S-Sportarten und Organisatoren | published 28.07.2026 | https://jsle.ch/dLET → https://www.jugendundsport.ch/de/leitfaden-sportarten | binding (quotes SpoFöV/VSpoFöP) | Read in full. The chapter «Gruppengrösse, Leitereinsatz … pro Sportart» has teaser tiles only, so no LS/T number. Free-days text and example table contradict each other (§11). No 2027 model. |
| **WEB-SICH** | Web page «Sicherheit in Lagersport/Trekking» | 25.11.2025 | https://www.jugendundsport.ch/de/sicherheit-lagersport-trekking | binding | Read in full. Almost identical to MB-UP. Differences: «Mobiltelefon» in the emergency kit (web only); «Erfrieren» vs «Kälte»; «Entscheidungshilfe» (jsle.ch/dTCd) content; «Hauptverantwortung … Lagerleitung». |
| **WEB-L** | Web page «Lager» | 22.09.2026 | https://www.jugendundsport.ch/de/lager (former key **L**) | binding | Read. Contribution tables (images) not read. |
| **WEB-C** | Web page «Leitfaden für J+S-Coaches» | 14.08.2026 | https://www.jugendundsport.ch/de/leitfaden-coach (former key **C**) | binding | Read: deadlines, Leihmaterial, Landeskarten, J+S-Alter, Anerkennung, verbotene Sportarten. |
| **WEB-LT** | Web page «Lagersport/Trekking» | 22.09.2026 | https://www.jugendundsport.ch/de/lagersport-trekking (former key **LT**) | binding (registration) / info | Read. |
| **WEB-ZA** | News «Zusatzanerkennungen Sicherheit» | 22.12.2025 | https://www.jugendundsport.ch/de/zusatzanerkennungen-sicherheit | binding (from 2026) | Read. No module names. |
| **WEB-GR** | News «Vereinfachung der Gruppengrössen ab 2026» | 22.12.2025 | https://www.jugendundsport.ch/de/vereinfachung-der-gruppengroessen-ab-2026 | info | Read. No LS/T number. |
| **WEB-LU** | News «Lieferunterbruch Leihmaterial» | 23.06.2026 | https://www.jugendundsport.ch/de/lieferunterbruch-leihmaterial | binding (one-off) | Read. |
| **H** | PBS Hering (planning help) | – | https://hering.scout.ch/de | pbs | Current source of the BP-* rules. |
| **MD** | MiData (PBS) | – | https://db.scout.ch | info | Data consistency. |

**Not obtained (referenced, still missing):**
- 3×3 LS/T PDF.
- Brochure «Lagersport/Trekking – Grundlagen».
- Lernbaustein «Planung einer Wanderung» (jsle.ch/dMDQ) and the J+S Marschzeit template.
- Legal texts SpoFöV / VSpoFöP. Art. 3 Abs. 3 VSpoFöP (WW III exception) is named in WEB-C «Verbotene Sportarten» («Ausnahme im Kanusport Wildwasser gemäss Art. 3 Abs. 3 VSpoFöP»), but its content is not detailed in any source we hold.
- Pfadiprofil (8 methods / 5 relationships).
- cudesch «Sicherheitskonzepte».
- J+S-Notfallblatt.
- Weisung Kaderbildung.

**Superseding:** MB-UP, WEB-SICH, LEITFADEN, WEB-L and WEB-C take precedence over LAGER/BERG (2014) and WASSER/WINTER (2019) wherever they overlap. Where an older brochure is stricter than a current source and the current source is silent, the brochure item stays, at the weight of the brochure.

**`sources.yaml` record format:**
```yaml
- key: MB-UP
  title: "Unfallprävention und Sicherheitsanforderungen in Lagersport/Trekking"
  publisher: BASPO
  docId: "30.401.501 d"
  edition: "Ausgabe 10/2025"
  date: 2025-11-17
  url: https://www.jugendundsport.ch/dam/de/sd-web/hD0eoaQct7HC/2025-0374_mb-unfallpraevention-LST-berg-winter-wasser_DE.pdf
  shortUrl: https://jsle.ch/dMB1
  weight: binding          # binding | binding-quote | didactic | outdated | pbs | info
  pageConvention: printed  # printed | section | slide
  partlyRead: []           # list of unread parts (strings)
  checkedOn: 2026-11-08
```

---

## 2. Packs, modules and per-camp activation

### 2.1 Packs

| Pack folder | Pack id | Version | Modules |
|---|---|---|---|
| `packs/jslst/` (renamed from `packs/basis/`) | `coco-js-lst` | `2026.2.0` | `js`, `lst`, `lst-lager`, `lst-trekking`, `lst-berg`, `lst-wasser`, `lst-winter`, `lst-ebb` |
| `packs/pbs/` (new) | `coco-pbs` | `2026.2.0` | `pbs` |

- One pack version covers 2026 **and** 2027. The year-dependent behaviour comes from rule `validFrom`/`validTo` and from param validity (§3.4). The engine picks by camp start date.
- The old pack id `coco-basis` appears in `settings.rulePacks` (there is no UI for it) only if a user set it manually. The loader maps `coco-basis` to `coco-js-lst`.

### 2.2 Modules

| Module | Title (de) | `appliesWhen` | Default state | Suggest triggers (state `auto`) |
|---|---|---|---|---|
| `js` | J+S Lager allgemein | `jsCamp: true` | on (not toggleable) | – |
| `lst` | Lagersport/Trekking – Kern | `jsCamp: true, sport: [lst]` | on | – |
| `lst-lager` | Lagerleben und Organisation | `module: lst` | on | – |
| `lst-trekking` | Unterwegs / Trekking | `module: lst` | on | – |
| `lst-berg` | Berg | `module: lst` | auto | ≥ 1 activity hits MOUNTAIN; GPX `highestPoint` > `lst.bergSuggestAltitude` (1000); `campConfig.region ∈ {voralpen, alpen}`; any activity tagged `sb-berg` (→ **on**) |
| `lst-wasser` | Wasser | `module: lst` | auto | ≥ 1 activity hits WATER; any activity tagged `sb-wasser` or `wasser-*` (→ **on**) |
| `lst-winter` | Winter | `module: lst` | auto | camp overlaps `lst.winterMonths`; ≥ 1 WINTER hit; `campConfig.winterSafeAccess === false` (suggest only); `winterSafeAccess === false` **and** camp overlaps `lst.winterMonths` (→ **on**); tag `sb-winter` (→ **on**) |
| `lst-ebb` | Ergänzende Bewegungsblöcke | `module: lst` | auto | ≥ 1 EBB_A or EBB_B hit; tag `ebb-a`/`ebb-b` (→ **on**) |
| `pbs` | PBS Best Practice | `organizer: pbs` (`camp.hitobitoProvider` or `camp.organizer` matches PBS / db.scout.ch) | on | coach may enable it for non-PBS camps |

Notes:
- `jsCamp: true` means `coachInputs.isJsCamp !== false`, matching today's `jsApplies`.
- `sport` comes from `campConfig.sport`, which defaults to `lst`.
- **«Camp overlaps `lst.winterMonths`»** (used by the winter trigger, the camp-level case of LST-SB-02/03/04, LST-WINTER-01 and CL-LST-04; activity rules such as LST-SB-01 test the entry month instead) means: at least one camp day (`facts.days`) lies in a month listed in `lst.winterMonths`. It is computed once in `lib/timeWindows.ts` as `campInWinter(ctx)`.
- The Fig. 4 rules apply to LS/T in Nutzergruppe 3 [MAN S.21 caption]. This is recorded in the `lst` module description.

### 2.3 Module state resolution (per camp)

```
coachState = campConfig.modules[id] ?? 'auto'          // 'on' | 'off' | 'auto'
if !appliesWhen(module)               -> effective = 'off'
else if coachState == 'on'            -> 'on'
else if coachState == 'off'           -> 'off'
else if module.default == 'on'        -> 'on'
else if any tag-trigger fires         -> 'on'          // coach tags are confirmation
else if any suggest trigger fires     -> 'suggested'   // reasons collected for the UI
else                                  -> 'off'
```

- In state `suggested`, the engine caps every hit at `hint` and appends the note «Modul {module} vorgeschlagen ({reason}) – bestätigen, um vollständig zu prüfen.»
- The note text is the i18n key `rules.module.suggestedNote`, so the UI renders it, not YAML.

### 2.4 Coach UI (card «Regelmodule» in the coach-input view)

- **J+S-Lager:** ja/nein (existing field `isJsCamp`).
- **Sportart:** Lagersport/Trekking (default) / andere.
- **Toggles** (`auto` / an / aus) for Berg, Wasser, Winter, EBB and PBS. Each `auto` toggle shows its reasons, e.g. «3 Aktivitäten mit Berg-Stichworten», «Lagerstart im Februar».
- **Lagerkontext:**
  - Region (Mittelland / Jura / Voralpen / Alpen / Ausland).
  - Lagerform (Haus / Zelt / gemischt).
  - Wintersichere Zufahrt (ja/nein/–).
  - Lager im Ausland (ja/nein).
- **Angebotskontext:**
  - «Weiteres Lager ≥ 4 Tage (ab 2027: J+S-Tage) im selben Angebot» (2026 LEITFADEN wording: «mindestens 4 aufeinanderfolgenden Tagen»).
  - «Unternehmung in anderem Lager des Angebots».
  - «Erscheinungsformen in anderem Lager abgedeckt».
  - «Letzte J+S-Aktivität des Angebots am …».
- **Activity tags:** set per activity in the findings and activity detail view (§3.5).
- **SB approvals:** per activity tagged `sb-*` (plus a camp-level entry when there is no winter-safe access and the camp overlaps `lst.winterMonths`): date and kind (`experte` | `bergfuehrer`). Kind `bergfuehrer` needs no date (see LST-SB-02).

---

## 3. Infrastructure specification

### 3.1 Directory layout

```
domain/rules/
  lib/                      # moved from packs/basis/predicates: util.ts (tokenizer+matcher), jsDays.ts, deadlines.ts, timeWindows.ts (new), birthYear.ts (new)
  packs/
    sources.yaml
    jslst/
      pack.yaml
      params.yaml
      checklist.yaml
      milestones.yaml       # moved from rules/milestones/pbs.yaml (J+S ones), see §9
      keywords/*.yaml
      rules/<ID>.yaml
      predicates/{index.ts, js.ts, lst.ts, lager.ts, trekking.ts, berg.ts, wasser.ts, winter.ts, ebb.ts, consistency.ts}
    pbs/
      pack.yaml, params.yaml, milestones.yaml, keywords/*.yaml, rules/*.yaml, predicates/index.ts
```

### 3.2 `pack.yaml` schema

```yaml
id: coco-js-lst
name: "co-co J+S Lagersport/Trekking 2026.2"
version: 2026.2.0
description: "J+S-Lagerregeln (allgemein + LS/T Nutzergruppe 3), Sicherheit LS/T, Datenkonsistenz."
validFrom: 2026-01-01
aliases: [coco-basis]                 # old pack ids accepted in settings.rulePacks
modules:
  - id: lst-berg
    title: "Berg"
    description: "SAC-Skala, Sicherheitsbereich Berg, Rekognoszierung, Gewitter, Altschnee."
    appliesWhen: { module: lst }      # keys AND-ed: jsCamp(bool), sport(list), organizer(pbs), module(id)
    default: auto                     # on | auto
    toggleable: true
    suggestWhen:                      # any-of; each yields a German reason via i18n key
      - { keywordSet: MOUNTAIN, minActivities: 1 }
      - { gpxHighestPointAbove: { param: lst.bergSuggestAltitude } }
      - { campConfig: { region: [voralpen, alpen] } }
    onWhen:                           # any-of; turns 'auto' into 'on'
      - { activityTag: sb-berg }
  - id: lst-winter
    # …
    suggestWhen:
      - { campOverlapsMonths: { param: lst.winterMonths } }
      - { keywordSet: WINTER, minActivities: 1 }
      - { campConfig: { winterSafeAccess: [false] } }
    onWhen:
      - { campConfig: { winterSafeAccess: [false] }, campOverlapsMonths: { param: lst.winterMonths } }
      - { activityTag: sb-winter }
```

Supported trigger keys:
- `keywordSet` (+ `minActivities`)
- `gpxHighestPointAbove` (`{ param }`)
- `campOverlapsMonths` (`{ param }` or a month list): at least one camp day lies in one of the months (replaces the draft's `campStartMonths`)
- `campConfig` (field → allowed values)
- `activityTag`
- `coachInput` (field → value)

Each list entry is one trigger; the keys **within** one entry are AND-ed, the entries are OR-ed. The loader validates the keys and rejects unknown ones.

### 3.3 Rule YAML schema (v2)

```yaml
id: LST-WASSER-04
version: 2.0.0
module: lst-wasser                    # required; replaces `group`
status: active                        # active | retired  (retired: shown in catalog, never evaluated)
title: "Wasseraufsicht: Qualifikation fehlt"
description: "…"
message: "…{placeholders}…"
messageVariants:                      # optional; predicate selects with hit.variant
  missingData: "…"
severity: should
confidence: heuristic
scope: activity                       # exactly one of: camp | day | activity | scheduleEntry
validFrom: 2026-01-01
validTo: null
inputs: [midata, activityTags, keywords]
params: []                            # params the predicate reads (explain + "Parameter angepasst"); LST-WASSER-04 reads none
keywords: [WATER, POOL, LAKE, RIVER, SWIM, UNSUPERVISED, AM_WATER]  # keyword sets the predicate reads
sources:
  - key: MB-UP
    page: "S. 5"
    quote: "Für Aktivitäten IM oder AUF dem Wasser müssen die Leitenden über entsprechende Wasser- und Aufsichtskompetenzen verfügen oder eine Aufsichtsperson engagieren"
    binding: true
formerIds: [SAFE-WATER-01]            # ids whose overrides/ruleState carry over
tags: [wasser]
```

Loader rules:
- `module` must exist in the pack.
- `scope` is a single value (`camp | day | activity | scheduleEntry`); lists are rejected. **A hit may target the camp IRI regardless of the rule's scope.** Rules use this for a camp-level case of an otherwise per-activity check (LST-SB-02/03/04: «Lager ohne wintersichere Zufahrt», message variant `camp`).
- `severity: must` requires `confidence: verified`. The loader throws otherwise; the engine already guards `unverified`/`conflict`.
- Rule ids and `formerIds` are **globally** unique across all packs. A formerId must not equal a live id.
- `sources[].key` must exist in `sources.yaml`.
- Every name in `params` and `keywords` must resolve.
- The old `source: {title,url}` is still accepted for one release. The loader converts it to `sources: [{key: <matched by url>, page: ""}]`.
- `RuleMeta.group` is kept as a derived alias (`group = module`) for callers not yet migrated. `ruleGroupOf()` reads `meta.module` and no longer guesses from the id prefix.

### 3.4 Params (`params.yaml`)

```yaml
- key: js.consecutiveMode
  label: "Zählweise Lagerdauer"
  unit: enum
  values:
    - { value: calendar, validFrom: 2026-01-01, validTo: 2026-12-31 }
    - { value: jsDaysSkipping, validFrom: 2027-01-01 }
  sources: [{ key: LEITFADEN, page: "«Lagerdauer»" }, { key: TOOL-V, page: "«Das J+S-Lager»" }]
  overridable: none            # none | admin | coach
- key: js.minBwzDayMinutes
  unit: minutes
  values:
    - { value: null, validFrom: 2026-01-01, validTo: 2026-12-31 }   # null = criterion inactive
    - { value: 120, validFrom: 2027-01-01 }
  overridable: none
```

**Resolution order:**
1. `campConfig.params[key]`, if `overridable: coach`;
2. `settings.ruleParams[key]`, if `admin` or `coach`;
3. the value row whose validity contains the camp start date.

A key with no matching row is a loader error.

**Predicate API:**
- `ctx.params.get<T>(key): T`
- `ctx.params.isOverridden(key): {value, default} | null`

Findings computed with any overridden param carry `paramNotes: [{key, value, default}]`. The UI renders «Parameter angepasst: {label} = {value} (Standard {default})» from i18n.

**Message texts never hard-code thresholds.** They take placeholders filled from params, for example `{min}` and `{tolerancePercent}`.

### 3.5 Keyword sets (`keywords/*.yaml`) and the matcher

```yaml
id: WATER
module: lst-wasser            # informational
extends: []                   # other set ids merged in (e.g. lst-wasser POOL extends nothing)
include:
  - "=baden"                  # exact token (+ e/en/n/s/er endings)
  - "schwimm"                 # stem: token contains
  - "^flussfahrt"             # token prefix
  - "$see"                    # token suffix
  - "\"stand up paddle\""     # phrase (quoted); also any entry containing a space
  - { regex: "\\b(ww|wildwasser)\\s*(iii|iv|v|vi|[3-6])\\b" }
exclude:
  - "trinkwasser"             # token-prefix exclusion (as today)
  - "\"see you\""             # phrase exclusion: removes the phrase span before token matching
sources: [{ key: WASSER, page: "S.6–23" }]
```

**Normalisation:**
1. Lower-case the text.
2. Strip `baden-powell` (as today).
3. Turn every non-letter/non-digit into a space, so `weiss-blau-weiss` becomes `weiss blau weiss` and `3×3` becomes `3 3`.
4. Collapse whitespace.
5. Match each entry against **both** the umlaut form and the folded form (ä→ae, ö→oe, ü→ue, ß→ss). Lists are written with umlauts only, which removes today's duplicates such as `aufwärm/aufwaerm`.

**Matching:**
- Tokens: by the existing stem / `=` / `^` / `$` rules.
- Phrases: by substring on the normalised text with a word boundary at both ends.
- Regex: run on the normalised text.
- Excluded tokens and phrase spans are removed before the include pass.

**API:**
- `ctx.keywords.match(setId, text): {term, field}[]`
- `ctx.keywords.matchActivity(setId, activity, fields = ['title','location','storyboard','notes'])`

Results are memoised per evaluation.

**Activity tags override keyword detection in both directions.** The tag enum is fixed in `types.ts` `ActivityTag`:
- `unternehmung`, `keine-unternehmung`
- `js-aktivitaet`, `keine-js-aktivitaet`
- `sb-berg`, `sb-wasser`, `sb-winter`, `kein-sb`
- `ebb-a`, `ebb-b`, `kein-ebb`
- `ef1` … `ef6`
- `gesicherter-bereich` (winter rules 1–3 exception)
- `wasser-bad-beaufsichtigt`, `wasser-pool`, `wasser-see`, `wasser-fluss`, `externe-wasseraufsicht`

### 3.6 Engine changes (`engine.ts`)

1. Load all packs and all modules. Assert global id uniqueness, including `formerIds`.
2. Resolve `ctx.campConfig` to effective module states (§2.3).
3. A rule is evaluated iff all of these hold:
   - the pack date range covers the camp start;
   - the rule date range covers the camp start;
   - `status === 'active'`;
   - the effective module state ≠ `off`;
   - the rule is not disabled in `ruleState`.
4. **Hit post-processing:**
   - `hit.severity` and the new `hit.confidence` may only *lower* the values in meta.
   - Order for confidence: `verified > best-practice > heuristic > unverified > conflict`.
   - Module `suggested` caps severity at `hint`.
   - A `conflict` or `unverified` confidence caps severity at `should`.
5. `hit.variant` selects `messageVariants[variant]`.
6. Overrides, `ruleState` and explain lookups match `ruleId` **or** any `formerIds`. Stored data is not migrated.
7. A finding carries `module`, `sources[]` (resolved from the registry), `paramNotes` and `moduleNote`.
8. **Findings are de-duplicated** by `ruleId:targets`, as today.
9. **Source-version watch:** when `sources.yaml` `edition` changes from the last stored value (`settings.sourceEditions`), the rules catalog flags every rule citing that key as «Quelle aktualisiert – erneut prüfen».

### 3.7 `RuleContext` / `RuleInput` additions

```ts
type RuleInput = 'mapping' | 'coachInputs' | 'documents' | 'settings'
               | 'midata' | 'nds' | 'campConfig' | 'activityTags' | 'params' | 'keywords'

interface RuleContext {
  // existing …
  campConfig: ResolvedCampRuleConfig        // record (§3.8) + effective module states + reasons
  params: ParamReader
  keywords: KeywordMatcher
  js: JsDayModel                            // precomputed by lib/jsDays.ts (§3.9), shared by all rules
}
```

Other type changes:
- **`CoachInputs`** gains optional fields: `leihmaterialDeliveryDate: IsoDate|null`, `landeskartenDeliveryDate: IsoDate|null`, `jsLeadersCount: number|null`. Optional fields need no Dexie version.
- **`MidataAggregate`** (red-derived, aggregates only):
  - `participantsByBirthYear: Record<number, number>`.
  - `participantsJsAgeCount` is now computed by **Jahrgang**: J+S age if `campYear − birthYear ∈ [5, 20]` [WEB-C «J+S-Alter»].
  - `MidataQualKey` gains `sbBerg`, `sbWasser`, `sbWinter`, `waterBath`, `waterPoolUnsupervised`, `waterLake`, `waterRiver`.
  - Rust `qual_keys_for_label` mapping:
    - «Sicherheitsbereich Berg» / «SB Berg» → `sbBerg`
    - «Sicherheitsbereich Wasser» → `sbWasser`, `waterRiver`
    - «Sicherheitsbereich Winter» → `sbWinter`
    - «Modul Wasser LS/T», «Aufsichtsperson Wasser» (I-Modul) → `waterBath`, `waterPoolUnsupervised`, `waterLake` (MB-UP S.5: they qualify for all three settings beaufsichtigtes Bad, unbeaufsichtigter Pool and unbeaufsichtigter See, but **not** for Schwimmen im Fluss)
    - «SLRG Basis Pool» / «Brevet Basis Pool» → `waterBath`
    - «Plus Pool» → `waterBath`, `waterPoolUnsupervised`
    - «Modul See» → `waterBath`, `waterPoolUnsupervised`, `waterLake`
    - «Modul Fluss» → `waterRiver`
    - J+S Kanusport/Rudern/Segeln/Triathlon/Windsurfen leader → `waterBath`, `waterPoolUnsupervised`, `waterLake`
  - The legacy keys `wasser`, `slrg`, `berg` and `winter` stay as they are (CMP-CON-05). The coach can still override per label via `settings.midata.qualMapping`.

### 3.8 Dexie: new table `campRuleConfig` (`db.ts` `version(5)`)

```ts
this.version(5).stores({ campRuleConfig: 'campIri' })   // new table only, no upgrade needed
interface CampRuleConfig {
  campIri: Iri
  zone: 'green'                                         // co-co data
  sport: 'lst' | 'other' | null                         // null = default lst
  modules: Partial<Record<ModuleId, 'on' | 'off' | 'auto'>>
  activityTags: Record<Iri, ActivityTag[]>
  sbApprovals: Record<Iri | 'camp', { approvedOn: IsoDate | null; kind: 'experte' | 'bergfuehrer' }>
  camp: { region: 'mittelland'|'jura'|'voralpen'|'alpen'|'ausland'|null;
          campForm: 'haus'|'zelt'|'gemischt'|null; winterSafeAccess: boolean|null; abroad: boolean|null }
  angebot: { other4DayCamp: boolean|null; unternehmungElsewhere: boolean|null;
             efCoveredElsewhere: boolean|null; lastActivityDate: IsoDate|null }
  params: Record<string, number | string | boolean>
  checklist: Record<string, { done: boolean; at: IsoDateTime; note?: string }>
  updatedAt: IsoDateTime
}
```

Further changes:
- **Shorthand in this catalog:** `campConfig.<field>` means `campConfig.camp.<field>` (region, campForm, winterSafeAccess, abroad) and `angebot.<field>` means `campConfig.angebot.<field>`.
- Add `campRuleConfig` to `TABLE_NAMES`, so backup export/import covers it, and add a backup round-trip test.
- **Settings** gains `ruleParams: Record<string, …>` and `sourceEditions: Record<string, string>`. Both are optional and need no version bump.
- **AI zone:** `campRuleConfig` is green. Activity tags are co-co data. Activity *titles* are not stored there.

### 3.9 Shared J+S day model (`lib/jsDays.ts`), used by every day/camp rule

1. **`isJsActivity(a)`:**
   - Tag `keine-js-aktivitaet` → false.
   - Tags `js-aktivitaet`, `ebb-a` or `ebb-b` → true.
   - Otherwise the mapping class ∈ {LS, LA}. EBB activities count toward the 4 h [EBB-C S.1; EBB-L S.1].
   - Keyword EBB detection does **not** change J+S status.
   - With no confirmed mapping and no tags, the status is `unknown`, and `ctx.js.mappingKnown` is `false`. The camp hint «Kategorie-Zuordnung fehlt» is owned by **JS-CAMP-01 only** (variant `noMapping`). Every other rule that reads `ctx.js` (JS-DAY-*, JS-FREE-01, JS-BWZ-*, LST-ACT-02, LST-ACT-05, JS-DL-02/05 for the last J+S day) returns no hit while `mappingKnown === false`, so the hint is not repeated.
   - Because `isJsActivity` reads activity tags, every rule that reads `ctx.js` or calls `isJsActivity` declares `activityTags` (and `mapping`) in `inputs`.
2. **Intervals per day.** J+S schedule entries are clipped to the wall-clock day; an entry crossing midnight is split. Entries shorter than `js.minUnitMinutes` are dropped (JS-DAY-02 reports them). Overlapping entries (parallel subgroups) are united, never summed.
3. **Units.** United intervals separated by less than `js.minGapMinutes` merge into one unit; JS-DAY-03 reports the gap.
4. **Day values.**
   - `jsMinutes` = total union length.
   - `units` = count of merged units.
   - `bwzMinutes` = sum over the day's J+S schedule entries of the movement-time value. The entry value is used when present; otherwise the activity value, if the activity has exactly one entry. Values below `js.minBwzActivityMinutes` count as 0 [TOOL-V «Sportlich-aktive Bewegungszeit»]; while that param is `null` (2026) no value is zeroed.
5. **`isJsDay(d)`:** `jsMinutes ≥ js.minDayMinutes` **and** `units ≥ js.minDayUnits` **and** (`js.minBwzDayMinutes` is null **or** `bwzMinutes ≥ js.minBwzDayMinutes`).
6. **First and last day.**
   - Each counts on its own if it is a J+S day.
   - Otherwise, if **neither** counts on its own and both together reach `jsMinutes ≥ js.minDayMinutes` (and, when `js.minBwzDayMinutes` is not null, `bwzMinutes ≥ js.minBwzDayMinutes` summed over both; skipped while it is null), the pair counts as **one** J+S day [LEITFADEN «Erster und letzter Lagertag»; TOOL-V].
   - The combined day does not need ≥ 2 units [LEITFADEN: «zusammengezählt»].
   - Edge case: if one end day counts on its own and the other does not, they are not combined; the other end day simply does not count.
7. **`jsDayCount`** = interior J+S days + end-day contribution (0, 1 or 2).
8. **`trainingFreeDays`** = interior days (not first, not last) that are not J+S days [LEITFADEN definition: «keine oder weniger als vier Stunden»].
9. Exposed on `ctx.js`, per day: `{date, jsMinutes, units, bwzMinutes, isJsDay, windowsCovered}`, plus `jsDayCount`, `trainingFreeDays`, `endDaysMode: 'single'|'combined'|'none'`, `mappingKnown: boolean`.

### 3.10 Time windows (`lib/timeWindows.ts`)

- The windows come from param `js.timeWindows`.
- An interval covers a window if it overlaps that window by at least `js.timeWindowMinOverlap` minutes (30). This is the lenient reading.
- `windowsCovered(day)` returns the set of windows covered.

### 3.11 i18n (UI chrome only; rule, checklist and milestone texts stay in YAML)

- **`locales/de/rules.json`:**
  - `rules.catalog.module.<moduleId>` (title)
  - `rules.module.state.{on,off,auto,suggested}`
  - `rules.module.suggestedNote`
  - `rules.module.reason.{keywordSet,gpxHighestPointAbove,campOverlapsMonths,campConfig,activityTag,coachInput}`
  - `rules.activityTag.<tag>`
  - `rules.paramNote`
  - `rules.sourceUpdated`
  - `rules.status.retired`
- **New `locales/de/campConfig.json`:** labels for sport, region, Lagerform, winter access, abroad, the Angebot fields, SB approvals and the checklist card chrome.
- Remove `rules.catalog.group.*` once all views read `module`.
- Duplicate keys throw (as today).

### 3.12 Texts out of TypeScript

- All `_message` and detail strings move into rule `messageVariants`. That covers JS-DL-*, CMP-CON-*, «Angabe fehlt» and the safety labels.
- `SAFETY_CHECK_LABELS` moves to `keywords/docCheck.yaml` together with `PATTERNS` and `EMERGENCY_NUMBERS`. `112` is added there.
- **No inline keyword terms in predicates.** Every term a predicate matches lives in a keyword set of §6 and the set is listed in the rule's `keywords`. Predicates never repeat a term that a set already contains (e.g. the treeline phrase lives only in TREELINE).

### 3.13 Tests

- **`packs.test.ts`** asserts:
  - 2 packs;
  - global id and formerId uniqueness;
  - every `sources[].key`, `params[]` and `keywords[]` resolves;
  - `must ⇒ verified`;
  - every active rule has a test file.
- **Per rule:** `domain/rules/__tests__/<module>/<ID>.test.ts`, with at least the positive and negative cases listed in §4 and §5.
- **Shared tests:**
  - `jsDays.test.ts`: 2026 and 2027 params, parallel subgroups, midnight split, combined end days.
  - `keywords.test.ts`: phrases, umlaut folding, regex and exclusions, including «flying fox» and «vorbereiten» ≠ reiten.
  - `moduleState.test.ts`
  - `params.test.ts`: validity and overrides.
  - `campRuleConfig` backup round-trip.

---

## 4. Existing rules: final decision per rule (all 48)

Legend: **K** keep, **R** refine (predicate changes, version bump to 2.0.0), **S→X** superseded by X (YAML deleted, X carries `formerIds`), **RET** retired (`status: retired`).

### 4.1 J+S rules

**Inputs of the rules that read `ctx.js` / `isJsActivity`** (the tables below do not list inputs):
- JS-CAMP-01: `mapping, activityTags, campConfig, params`
- JS-DAY-01, JS-DAY-02, JS-DAY-03, JS-DAY-04: `mapping, activityTags, params`
- JS-DAY-05: `mapping, activityTags, params, keywords`
- JS-FREE-01: `mapping, activityTags, params`
- JS-BWZ-27: `mapping, activityTags, params`
- JS-DL-02: `mapping, activityTags, campConfig, params, nds`
- (new rules JS-DAY-06, JS-BWZ-02, LST-ACT-02, LST-ACT-05, JS-DL-05 list theirs in §5.)

| id | Decision | Module | Old → new sev/conf | Validity | Change and citations |
|---|---|---|---|---|---|
| JS-CAMP-01 | R | lst | must/verified → **must/verified** | 2026+ | **2026 (`js.consecutiveMode=calendar`):** longest run of consecutive calendar days ≥ `js.minConsecutiveDays` (4). The value is 3 when `angebot.other4DayCamp === true` (`js.minConsecutiveDaysWithOfferPartner`).<br>**2027 (`jsDaysSkipping`):** `ctx.js.jsDayCount` ≥ 4, or ≥ 3 with an offer partner. Non-J+S days are skipped (§0.1).<br>`ctx.js.mappingKnown === false` → one camp hint, variant `noMapping`: «Kategorie-Zuordnung fehlt: Ohne bestätigte Zuordnung der Aktivitäten (LS/LA bzw. J+S-Aktivität) können J+S-Tage und Tagesregeln nicht geprüft werden.» JS-CAMP-01 is the only owner of this hint (§3.9.1). In 2026 mode the calendar-day count is still evaluated (it needs no mapping); in 2027 mode the count is skipped while the mapping is unknown.<br>Messages:<br>2026: «Das Lager dauert nur {days} aufeinanderfolgende Tage (nötig: mindestens {min}).»<br>2027: «Das Lager hat nur {jsDays} J+S-Tage (nötig: mindestens {min}). Tage ohne J+S-Aktivitäten und Tage, welche die J+S-Tag-Kriterien nicht erfüllen, werden übersprungen: Sie zählen nicht, unterbrechen die Folge aber auch nicht.»<br>Sources: [LEITFADEN «Lagerdauer» (Art. 14 Abs. 1 und 6 VSpoFöP)]; [WEB-L «Voraussetzungen»]; [TOOL-V «Das J+S-Lager»]; [MAN S.21]; [PBS27 slides 5–6]. Tests: 2026 4-day camp ok, 3-day camp fires, 3-day with partner ok; 2027 5 days with a free day 3 and 4 J+S days ok, 5 days with 3 J+S days fires, combined end days count once. |
| JS-CAMP-02 | R | js | must/verified (unchanged) | 2026+ | Count = MiData `participantsJsAgeCount` (Jahrgang logic), else coach `participantsJsAgeCount`, else `participantsCount` with downgrade to should and variant `ageUnknown`. Threshold `js.minParticipants` (12), ages `js.ageMin`/`js.ageMax` (5/20). Missing → hint «Angabe fehlt». Sources: [LEITFADEN «Minimale Teilnehmerzahl» (Art. 13 Abs. 1 VSpoFöP)]; [WEB-L]; [WEB-C «J+S-Alter»]; [PBS27 slide 9]. Message adds: «Tage unter der Mindestzahl sind nicht beitragsberechtigt.» |
| JS-DAY-01 | R | lst | must/verified → **should/verified** | 2026+ | Fires per interior day with jsMinutes > 0 that is not a J+S day. Free days (0 J+S) are left to JS-FREE-01. Message: «{date} zählt nicht als J+S-Tag ({minutes} min J+S-Aktivität in {units} Einheit(en); nötig {minMinutes} min in mindestens {minUnits} Einheiten). Er gilt als trainingsfreier Tag.» Sources: [LEITFADEN «Aktivitätendauer», «Trainingsfreie Tage»]; [WEB-L]; [TOOL-V]; [MAN S.21]. `js.minDayUnits` = 2 in both years (LEITFADEN is current; the draft's plan to drop it for 2027 is reverted). |
| JS-DAY-02 | K | lst | must/verified | 2026+ | Every J+S schedule entry must be ≥ `js.minUnitMinutes` (30). Sources: [LEITFADEN «Aktivitätendauer»]; [MAN S.21]; [TOOL-V «Die J+S-Aktivität»]; [PBS27 slide 7]. |
| JS-DAY-03 | K | lst | must/verified (draft downgrade reverted) | 2026+ (no validTo; see §11 Q4) | Gap between J+S units < `js.minGapMinutes` (30) fires. Sources: «Zwischen den Trainingseinheiten ist eine Sozialzeit von mindestens 30 Minuten vorgesehen» [LEITFADEN «Aktivitätendauer», Art. 14 Abs. 3 VSpoFöP]; «getrennt durch mindestens 30 Minuten Sozialzeit» [WEB-L]. |
| JS-DAY-04 | R | lst | must/verified → **should/verified** | 2026+ | Fires when `endDaysMode === 'none'` and at least one end day has J+S minutes > 0: «Erster und letzter Lagertag zählen nicht als J+S-Tag (zusammen {minutes} min, nötig {min}).» Combined total 0 → no finding (plain arrival/departure days are normal: «Wenn am ersten und am letzten Lagertag … keine J+S-Aktivitäten stattfinden, zählen sie nicht» [LEITFADEN]). The «≥ 2 units» clause for the combined day is dropped. When `js.minBwzDayMinutes` is not null (2027+), the pair also needs BWZ ≥ `js.minBwzDayMinutes` summed over both days (interpretation, §11 Q3). Thresholds come from `js.minDayMinutes` / `js.minBwzDayMinutes` (§3.9.6). Sources: [LEITFADEN «Erster und letzter Lagertag» (Art. 14 Abs. 4)]; [TOOL-V]. |
| JS-DAY-05 | R | lst | should/heuristic (unchanged) | 2026+ | Now backed by a binding source: «Vor jedem Training ist ein gezieltes Aufwärmen erforderlich» [LEITFADEN «Aktivitätendauer»]; «Die Trainingseinheiten starten jeweils mit einem gezielten Aufwärmen» [WEB-L]. Keywords from set WARMUP (§6); head length param `lst.warmupHeadChars` (400). The draft downgrade to hint is reverted. |
| JS-DL-01 | K | js | must/verified (confirmed) | 2026+ | Due = camp start − `js.ndsRegistrationLeadDays` (30). This holds both when the camp is the first of the offer and when it is added later («gleiche Frist für die Nachmeldung»). Message variant `late`: «… Bewilligung nicht garantiert». Sources: [WEB-C «Anmeldefrist für J+S-Angebote» (Art. 22 SpoFöV, Art. 58 VSpoFöP)]. The 2014 «erstes Lager des Jahres» reading [LAGER S.23] is superseded. |
| JS-DL-02 | R | js | must/verified (confirmed) | 2026+ | Due = (`angebot.lastActivityDate` ?? last J+S day ?? camp end) + `js.ndsClosingDays` (30). Message names the consequence «kein Anspruch auf Auszahlung». Sources: [WEB-C «5. Schritt: Abschluss des Angebots»]. |
| JS-DL-03 | R | js | should/verified | 2026+ | **Leihmaterial:** due = (`leihmaterialDeliveryDate` ?? camp start) − `js.leihmaterialLeadDays` (35). **Landeskarten:** due = (`landeskartenDeliveryDate` ?? camp start) − `js.landeskartenLeadDays` (21), or − `js.landeskartenLeadDaysSummer` (35) when the delivery month is in `js.landeskartenSummerMonths` (June–August). Without a delivery date, variant `noDeliveryDate` says «Lieferdatum unbekannt – Frist ab Lagerbeginn gerechnet; liegt das Lieferdatum früher, ist auch die Frist früher». Leihmaterial note: «Bestellung erst ab Status «Bewilligt», max. 1 Bestellung pro Lager». Sources: [WEB-C «Leihmaterial», «Topografische Landeskarten»]; [PBS27 slide 16]. |
| JS-LL-01 | K | lst | must/verified | 2026+ | Sources: «In der Sportart Lagersport/Trekking muss mindestens eine Person über den Zusatz «Lagerleiter» verfügen» [LEITFADEN «Lagerleitung»]; [PBS27 slide 9]. |
| JS-STAFF-01 | **RET** | js | should/conflict → retired | – | No ratio exists for LS/T: the LEITFADEN has none, and leaders set the safety-relevant group size themselves [WEB-SICH «Grundhaltung»; MB-UP S.1]. Replaced by JS-STAFF-02 (minimum 2) and JS-STAFF-03 (subsidy group size). YAML kept with `status: retired`, so existing overrides still resolve. |
| JS-FREE-01 | R | lst | should/conflict → **should/verified** (hit-level `conflict`) | 2026+ | New semantics: cap on training-free days. D = number of camp days, F = `ctx.js.trainingFreeDays`.<br>`A_text(D) = D < js.freeDaysFirstAt ? 0 : 1 + floor((D − js.freeDaysFirstAt)/js.freeDaysEveryFurther)` [WEB-L; LEITFADEN text]; `A_table(D) = D < js.freeDaysFirstAt ? 0 : floor((D − 2)/2)` [LEITFADEN example table].<br>**Camps with `js.consecutiveMode === 'calendar'` (2026):**<br>• F > A_table → should/verified.<br>• A_text < F ≤ A_table → hint, confidence `conflict`, variant `conflict`.<br>**Camps with `js.consecutiveMode === 'jsDaysSkipping'` (from 2027-01-01):** every hit (F > A_text) is capped at hint with confidence `conflict`, variant `conflict2027`, because TOOL-V 2027 («Es ist möglich, einen Tag ohne J+S-Aktivitäten zu planen, sofern die Mindestanzahl an J+S-Tagen eingehalten wird») contradicts the LEITFADEN cap and JS-CAMP-01 skips such days (§0.1). This is the strict and simpler choice (one rule, per-hit downgrade; no second rule with split validity).<br>Message: «{free} trainingsfreie Tage bei {days} Lagertagen – erlaubt sind {allowed}. Trainingsfreie Tage werden nicht beitragsberechtigt gezählt.»<br>Variant `conflict2027`: «{free} trainingsfreie Tage bei {days} Lagertagen. Der Leitfaden erlaubt {allowed}; die J+S-Vorgaben ab 2027 erlauben Tage ohne J+S-Aktivitäten, solange die Mindestzahl J+S-Tage erreicht ist. Ob die Obergrenze weiter gilt, ist offen – beim J+S-Coach-Support klären.»<br>Params: `js.freeDaysFirstAt`, `js.freeDaysEveryFurther`, `js.consecutiveMode`. Sources: [LEITFADEN «Trainingsfreie Tage»]; [WEB-L «Trainingsfreie Tage»]; [TOOL-V «Das J+S-Lager»] (2027 conflict). Tests: 2026 7 days F 3 → should; 2026 6 days F 2 → hint `conflict`; 2027 9 days F 4 → hint `conflict2027`. |
| JS-BWZ-27 | R | lst | hint/unverified → **should/verified** | validFrom 2027-01-01 | Per interior day with jsMinutes ≥ 240 and bwzMinutes < `js.minBwzDayMinutes` (120): «{date}: nur {bwz} min Bewegungszeit (nötig {min}) – Tag zählt nicht als J+S-Tag.» No BWZ data at all → one camp hint, variant `noData`. Sources: [MAN S.21]; [TOOL-V «Sportlich-aktive Bewegungszeit»]; [PBS27 slide 6]. |

### 4.2 Completeness and consistency rules

| id | Decision | Module | Sev/conf | Validity | Change and citations |
|---|---|---|---|---|---|
| CMP-ACT-01 | K | lst | should/best-practice | 2026+ | Citations: [MAN S.39]; [TOOL-P step 1]. |
| CMP-ACT-02 | R | lst | should/best-practice → **should/verified** | 2026+ | Accept a storyboard **or** notes text. Sources: «Die J+S-Aktivitäten und deren Inhalte müssen klar beschrieben und im Programm ersichtlich sein» [WEB-L «Lagerprogramm»; LEITFADEN]; [MAN S.38–39]. |
| CMP-ACT-03 | R | lst | should/heuristic | 2026+ | Applies to every J+S activity:<br>• Risk activities (OUTDOOR/WATER/MOUNTAIN/ROPE/NIGHT/WINTER/FIRE hit, or tag `sb-*`/`ebb-*`) → should.<br>• Other J+S activities → hint.<br>Sources: «haben ein Sicherheitskonzept …» [MB-UP S.1]; [TOOL-P step 3]; [MAN S.39, 45]. |
| CMP-LA-01 | K | lst | should/best-practice | validTo 2026-12-31 | The LA concept is absent from the 2027 sources (§11 Q7). |
| CMP-DAY-01 | R (move) | lst-lager | hint/best-practice → **hint/unverified** | 2026+ | Citation: [LAGER S.8, 18] (2014 only, so `unverified` per §0.2). |
| CMP-CAMP-01 | R | js | hint/best-practice → **hint/unverified** | 2026+ | Citation: [LAGER S.18] (2014 only, so `unverified` per §0.2). |
| CMP-MD-01 | K | js | hint/best-practice | 2026+ | Citation: [MD] (data consistency eCamp ↔ MiData). |
| CMP-NDS-01 | K | js | hint/best-practice | 2026+ | Citation: [WEB-C «Anmeldefrist für J+S-Angebote»] (the camp is registered in the NDS with its dates); [WEB-L] (former key L). |
| CMP-NDS-02 | R | js | should/best-practice → **should/verified** | 2026+ | Citation: «AWK zeitnah und wahrheitsgetreu … erfasst» [WEB-C «3. Schritt»]; [MAN S.17]. |
| CMP-NDS-03 | R | js | hint/best-practice | 2026+ | Threshold from param `js.participantsDiffTolerance` (0.2); message uses `{tolerancePercent}`. |
| CMP-PROG-01 | K (move) | pbs | hint/best-practice | 2026+ | Lead time param `pbs.progressLeadDays` (21). |
| CMP-CON-01…04, 06…08 | K | js | unchanged | 2026+ | Texts move to YAML variants. |
| CMP-CON-05 | R | js | should/conflict | 2026+ | Key list extended with `sbBerg`, `sbWasser`, `sbWinter`. Citations: «gültig bis zum Ende des übernächsten Kalenderjahres …; Zusatzanerkennungen Sicherheit … alle vier Jahre» [WEB-C «J+S-Anerkennung»]; [WEB-ZA]. |
| CMP-CON-09 | R | js | hint/conflict | 2026+ | Message: without a birthday the Jahrgang-based J+S-Alter cannot be computed [WEB-C]. |
| CMP-CON-10 | R | js | hint/conflict | 2026+ | Tolerance param `js.participantsDiffTolerance`. |

### 4.3 Safety rules

| id | Decision | Module | Sev/conf | Validity | Change and citations |
|---|---|---|---|---|---|
| SAFE-WATER-01 | S→LST-WASSER-01 (+ LST-WASSER-04) | – | – | – | The qualification part moves to LST-WASSER-04. |
| SAFE-MTN-01 | S→LST-TREK-01 | – | – | – | – |
| SAFE-MTN-02 | S→LST-TREK-02 | – | – | – | – |
| SAFE-MTN-03 | S→LST-SB-03 | – | – | – | – |
| SAFE-ROPE-01 | R | lst-lager | should/heuristic | 2026+ | ROPE set with phrase «flying fox» (now works) and `!seilpark` exclusion (→ EBB B). Min length param `lst.ropeMinSafetyChars` (200). Citations: [TOOL-G EF1]; [MAN S.26, 64]; [MB-UP S.1 «Sicherheitskonzept»]. |
| SAFE-NIGHT-01 | R | lst-lager | hint/heuristic | 2026+ | Params `lst.nightEndTime` (22:00), `lst.minRestMinutes` (510), `lst.morningWindow` (05:00–14:00). Citations: [LAGER S.22]; [MAN S.42]. |
| SAFE-WX-01 | R | lst-lager | should/heuristic | 2026+ | Phrases from set SCHLECHTWETTER (§6). Citations: [MAN S.39 rubric «Schlechtwettervariante»]; [LAGER S.23]. |
| SAFE-DOC-01 | S→LST-LAGER-01 | – | – | – | – |

### 4.4 Best-practice rules

| id | Decision | Module | Sev/conf | Validity | Change and citations |
|---|---|---|---|---|---|
| BP-REST-01 | R (move) | pbs | hint/best-practice → **hint/unverified** | 2026+ | Params `pbs.restGapMinutes` (60), `pbs.restWindow` (07:00–22:00). Citation: [LAGER S.18] (2014); [H] (param basis, content not verified). Kept `unverified` because no current source we hold states the rule. |
| BP-SLEEP-01 | K (move) | pbs | hint/heuristic | 2026+ | Param `pbs.sleepHours` (per Stufe). Citation: [MAN S.55]; [H]. |
| BP-WOLF-01 | K (move) | pbs | hint/best-practice | 2026+ | Param `pbs.wolfParticipantsPerLeader` (6). |
| BP-WATER-01 | K (move) | pbs | hint/best-practice | 2026+ | Param `pbs.slrgParticipantsPerPerson` (12). The ratio is PBS practice only; the official requirement is LST-WASSER-04. The 1:12 raft/canoe ratio [LAGER S.11, 2014] is not adopted. |
| BP-VAR-01 | K (move) | lst | hint/best-practice | 2026+ | Params `lst.varMinUnits` (4), `lst.varMinDistinct` (2). Citation: [MAN S.38]. |

---

## 5. New rules

Format per rule: `id · module · severity/confidence · scope · inputs · validity`.

All rules have `version: 1.0.0`. All J+S-gated rules (modules `js` and `lst*`) are skipped when `isJsCamp === false`.

### 5.1 Module `js`

**JS-STAFF-02** · js · must/verified · camp · midata, coachInputs · 2026+
- **Titel:** Mindestens zwei J+S-Leitende
- **Meldung:** «Es sind {count} J+S-Leitende Lagersport/Trekking mit gültiger Anerkennung erfasst – nötig sind mindestens {min}.»
- **Variant `missing`:** «Anzahl J+S-Leitende unbekannt – MiData verbinden oder Anzahl erfassen.» (hint)
- **Prüfung:**
  - `count` = MiData `qualificationKinds` with key `leiterLsT`, summing `validLeaders`. Skip MiData when `qualificationsReadable === false`.
  - Otherwise fall back to coach `jsLeadersCount`.
  - Fire if `count < js.minLeaders` (2).
- **Params:** `js.minLeaders`.
- **Quellen:**
  - [LEITFADEN «Lagerleitung» (Art. 12 VSpoFöP)] «mindestens zwei J+S-Leiterinnen bzw. -Leiter, die in den angemeldeten Sportarten sowie Zielgruppen eine Leiteranerkennung … im Status «gültig» aufweisen»
  - [WEB-L «Leitung»]
  - [PBS27 slide 9]
- **Tests:**
  - + MiData leiterLsT validLeaders 1 → must.
  - − validLeaders 2 → none.
  - + no MiData, coach count null → hint `missing`.

**JS-STAFF-03** · js · hint/unverified · camp · midata, coachInputs · 2026+
- **Titel:** Beitragsrelevante Gruppengrösse
- **Meldung:** «{participants} Teilnehmende bei {leaders} J+S-Leitenden: Beiträge werden höchstens für {max} Teilnehmende berechnet ({perLeader} pro J+S-Leiter*in).»
- **Prüfung:** `max = leaders × js.subsidyGroupSizePerLeader` (16). Fire if `participantsJsAgeCount > max`. This describes a contribution consequence, not a ban.
- **Quellen:**
  - [PBS27 slide 9] «16+16+16»
  - [WEB-GR] «Pro J+S-Leiterin oder -Leiter wird die maximale Gruppengrösse fortgeführt»
  - [WEB-C «Ungenügende Anzahl J+S-Leiterinnen oder -Leiter»]
- **Confidence:** unverified, because the LS/T number 16 is not on an official page we hold (§11 Q8).
- **Tests:**
  - + 2 leaders, 40 TN → hint.
  - − 3 leaders, 40 TN → none.

**JS-EXCL-01** · js · should/heuristic · activity · keywords, activityTags · 2026+
- **Titel:** Von J+S ausgeschlossene Aktivität
- **Meldung:** ««{activity}» enthält «{term}». Diese Aktivität ist von J+S generell ausgeschlossen (Art. 6 Abs. 2 SpoFöV) und darf auch nicht als ergänzender Bewegungsblock durchgeführt werden.»
- **Variant `ww`:** ««{activity}»: Wildwasser ab Grad III ist von J+S ausgeschlossen (Ausnahme Kanusport Wildwasser gemäss Art. 3 Abs. 3 VSpoFöP).»
- **Prüfung:**
  - Set EXCLUDED, or regex `WW_HIGH`, on title, location, storyboard and notes.
  - Tags do not silence the rule, except that an `ebb-a`-tagged activity with only a WW hit is downgraded to hint (Kanusport exception).
  - `schlucht` is never an exclusion trigger (see LST-WASSER-08).
- **Keywords:** EXCLUDED, WW_HIGH.
- **Quellen:**
  - [MB-UP S.6 «Von J+S generell ausgeschlossen»]
  - [WEB-SICH]
  - [WEB-C «Verbotene Sportarten»] (includes sports where knock-down is *allowed*, and Bruchtests); for variant `ww`: «Ausnahme im Kanusport Wildwasser gemäss Art. 3 Abs. 3 VSpoFöP» (stated literally there)
  - [EBB-C S.1]; [EBB-L S.1]
- **Tests:**
  - + «Canyoning im Tessin» → should.
  - + «Rafting WW III» → should, variant `ww`.
  - − «Bachtrekking durch die Schlucht» → none.
  - − «Kartenlesen» → none.
  - + «Kickbox-Training» → should.
  - + «Bruchtest mit Brettern» → should.

**JS-AGE-01** · js · hint/verified · camp · midata · 2026+
- **Titel:** Teilnehmende ausserhalb des J+S-Alters
- **Meldung:** «{n} Teilnehmende liegen ausserhalb des J+S-Alters (J+S-Alter: Jahrgänge {fromYear}–{toYear}) und zählen nicht für die Mindestzahl.»
- **Prüfung:**
  - From `participantsByBirthYear`, count birth years with `campYear − y ∉ [ageMin, ageMax]`.
  - `fromYear = campYear − 20`, `toYear = campYear − 5`.
  - Aggregates only.
- **Quellen:** [WEB-C «J+S-Alter»] «erstmals am 1. Januar des Jahres, in dem ein Kind 5 Jahre alt wird, und letztmals am 31. Dezember des Jahres, in dem das 20. Altersjahr vollendet wurde»; [LEITFADEN]; [PBS27 slide 9].
- **Tests** (campYear 2027):
  - + one TN born 2006 → hint.
  - − all TN born 2007–2022 → none.
  - + one born 2023 → hint.

**JS-DL-04** · js · hint/verified · camp · coachInputs, params · 2026+
- **Titel:** Leihmaterial: Liefertag kein Werktag
- **Meldung:** «Liefertermin Leihmaterial {date} ist ein {weekdayOrHoliday}. Geliefert wird nur an Werktagen – Termin anpassen.»
- **Prüfung:**
  - Only when `leihmaterialDeliveryDate` is set.
  - Fire if the day is Saturday or Sunday, or listed in `js.publicHolidays` (federal plus general holidays; Easter-dependent dates computed).
  - No finding without a delivery date (the correction B9 fix).
- **Quellen:** [PBS27 slide 16]; [LAGER S.24].
- **Tests:**
  - + delivery 2027-05-06 (Auffahrt, a Thursday) → hint (holiday path).
  - + delivery 2027-07-03 (Saturday) → hint (weekend path).
  - − 2027-07-05 (Mon) → none.
  - − no date → none.

**JS-DL-05** · js · must/verified · camp · nds, mapping, activityTags, campConfig, params · 2026+
- **Titel:** Lagerprogramm nicht in der NDS
- **Meldung:** «Das definitive Lagerprogramm ist noch nicht in der NDS hochgeladen. Es muss spätestens beim Abschluss des Angebots vorliegen (Frist {due}).»
- **Prüfung:**
  - Only if NDS is linked and `nds.campAgendaUploaded === false`.
  - `due` = the closing due date of JS-DL-02: (`angebot.lastActivityDate` ?? last J+S day ?? camp end) + `js.ndsClosingDays`.
  - Today before camp end → downgraded to hint.
  - Camp end ≤ today ≤ `due` → downgraded to should.
  - Today > `due` → must.
- **Params:** `js.ndsClosingDays`.
- **Quellen:** [WEB-L «Lagerprogramm»] «Das definitive Lagerprogramm muss spätestens beim Abschluss des Angebots in die Nationale Datenbank Sport (NDS) hochgeladen werden.»; [WEB-C «5. Schritt: Abschluss des Angebots»] (deadline).
- **Tests:**
  - + before camp end → hint.
  - + 10 days after camp end (due not passed) → should.
  - + 31 days after camp end, no `lastActivityDate` → must.
  - + 31 days after camp end, `lastActivityDate` = end + 20 → should.
  - − uploaded true → none.
  - − NDS not linked → none.

**JS-DL-06** · js · hint/verified · camp · coachInputs, params · validFrom 2026-01-01, validTo 2027-01-17
- **Titel:** Lieferunterbruch Leihmaterial
- **Meldung:** «Zwischen {outageStart} und {outageEnd} wird kein Leihmaterial ausgeliefert oder abgeholt (Systemwechsel Armeelogistikcenter). Bestellschluss für diesen Zeitraum war der {orderBy}. Material muss ab {outageStart} sicher gelagert werden.»
- **Prüfung:**
  - `js.leihmaterialOutage` is not null (it is null for camps starting from 2027-01-18).
  - Leihmaterial in use: `coachInputs.leihmaterialOrdered === true` or `leihmaterialDeliveryDate` is set. (`leihmaterialOrdered` is a boolean defaulting to `false`, so a null check would always be true.)
  - The camp's material window [`windowStart`, `windowEnd`] = [`leihmaterialDeliveryDate` ?? camp start − 7, camp end + 7] overlaps [`outageStart`, `outageEnd`] of `js.leihmaterialOutage`.
  - validTo 2027-01-17 covers the last camps whose window (start − 7) still reaches the outage end 2027-01-10; the overlap check decides everything else.
- **Params:** `js.leihmaterialOutage` (fields `outageStart`, `outageEnd`, `orderBy`).
- **Quellen:** [WEB-LU].
- **Tests:**
  - + camp 2026-12-27…2027-01-02 with Leihmaterial → hint.
  - + camp 2027-01-15…2027-01-20 with `leihmaterialOrdered === true` → hint (window starts 2027-01-08).
  - − same camp with `leihmaterialOrdered === false` and no delivery date → none.
  - − camp 2026-08-01…2026-08-10 with Leihmaterial → none (no overlap).
  - − camp 2027-02-15 → not evaluated (validity).

**JS-PROG-01** · js · must/verified · day · – · 2026+
- **Titel:** Tag ohne Programm
- **Meldung:** «Für {date} ist kein Programm erfasst. Für sämtliche Lagertage braucht es eine Tagesplanung mit Start- und Endzeiten.»
- **Prüfung:** A camp day (`facts.days`) has no schedule entry.
- **Quellen:** [WEB-L «Lagerprogramm»] «Für sämtliche Tage muss eine Tagesplanung mit Start- und Endzeiten aller Aktivitäten sowie Fixpunkten … angegeben werden».
- **Tests:**
  - + day 3 empty → must.
  - − every day has an entry → none.

**JS-PROG-02** · js · hint/heuristic · day · keywords · 2026+
- **Titel:** Fixpunkte (Mahlzeiten) fehlen
- **Meldung:** «Am {date} sind keine Fixpunkte wie Mahlzeiten im Programm erkennbar.»
- **Prüfung:** No schedule entry on that day whose activity title matches MEAL. Skipped when the day has no entries at all (JS-PROG-01 reports that).
- **Quellen:** [WEB-L «Lagerprogramm»].
- **Tests:**
  - + day with only «Geländespiel» → hint.
  - − day with «Zmittag» → none.

### 5.2 Module `lst` (core)

**JS-DAY-06** · lst · should/verified · day · mapping, activityTags, params · 2026+
- **Titel:** J+S-Aktivitäten auf mindestens zwei Tageszeiten
- **Meldung:** «Am {date} liegen alle J+S-Aktivitäten in der Tageszeit «{slot}». Sie müssen auf mindestens {min} Tageszeiten (Morgen, Nachmittag, Abend) verteilt sein.»
- **Prüfung:**
  - For each interior day with jsMinutes > 0: fire if `windowsCovered < js.minTimeWindows` (2).
  - If `endDaysMode === 'combined'`, the first and last day are evaluated as one union.
- **Params:** `js.timeWindows`, `js.timeWindowMinOverlap`, `js.minTimeWindows`.
- **Severity:** should, because the window boundaries are not defined in any source (§11 Q2).
- **Quellen:**
  - [LEITFADEN «Aktivitätendauer»] «je eine am Vormittag und/oder am Nachmittag und/oder am Abend» (per Lagertag)
  - [WEB-L]
  - [TOOL-V «Das J+S-Lager»]
  - [MAN S.21] (no «pro Tag», correction A)
- **Tests:**
  - + 09:00–11:00 and 10:00–12:00 only → should.
  - − 09:00–11:00 + 14:00–16:00 → none.
  - − 11:30–12:30 + 17:00–18:30 → none (lenient: covers morning and afternoon; overlap ≥ 30 min each).

**JS-BWZ-02** · lst · must/verified · activity · mapping, activityTags, params · validFrom 2027-01-01
- **Titel:** Bewegungszeit korrekt ausweisen
- **Meldung:** «Bewegungszeit von «{activity}» ({value} min): {problem}.»
- **Variants and per-hit severity:**

  | Variant | Problem text | Severity |
  |---|---|---|
  | `under30` | «unter {min} min – wird nicht angerechnet» | should (not forbidden, only not counted; §0.3) |
  | `step` | «nicht in {step}-Minuten-Schritten» | must |
  | `missing` | «fehlt» | should |
  | `tooLong` | «länger als die Aktivität ({duration} min)» | should |

- **Prüfung:**
  - Per J+S activity, and per schedule entry when the value is set there.
  - `missing` fires for every J+S activity without a value (MAN «für jede J+S-Aktivität separat»), independent of the day total.
- **Params:** `js.minBwzActivityMinutes` (30), `js.bwzStepMinutes` (15).
- **Quellen:**
  - [TOOL-V «Sportlich-aktive Bewegungszeit»] «muss ab einer Dauer von 30 Minuten pro Aktivität und in 15-Minuten-Schritten auf dem Lagerprogramm ausgewiesen werden»
  - [MAN S.21]
  - [PBS27 slide 6]
- **Tests:**
  - + value 20 → should `under30`.
  - + 50 → must `step`.
  - + null → should `missing`.
  - + 120 on a 90-min entry → should `tooLong`.
  - − 45 on a 60-min entry → none.

**LST-ACT-01** · lst · should/heuristic · activity · mapping, keywords, activityTags · 2026+
- **Titel:** J+S-Aktivität ohne Bewegung?
- **Meldung:** ««{activity}» ist als J+S-Aktivität eingeteilt, wirkt aber nicht sportlich-aktiv («{term}»). Nicht-sportliche Programmpunkte zählen nicht als J+S-Aktivität.»
- **Prüfung:**
  - `isJsActivity` is true.
  - The title matches PASSIVE.
  - Neither title nor storyboard matches MOVEMENT.
  - Not tagged `js-aktivitaet`.
- **Quellen:** [LEITFADEN] «Nicht-sportliche Aktivitäten zählen nicht zu den J+S-Aktivitäten»; [WEB-L «Förderung von Events»]; [TOOL-V «Aktiv und bewegungsorientiert»]; [MAN S.21].
- **Tests:**
  - + LS «Filmabend» → should.
  - − LS «Singspiel mit Fangis» → none.
  - − tagged js-aktivitaet → none.

**LST-ACT-02** · lst · hint/heuristic · activity · mapping, activityTags, keywords, params · validFrom 2027-01-01
- **Titel:** J+S-Aktivität nur für einen Teil der Gruppe?
- **Meldung:** ««{activity}» scheint sich nur an einen Teil der Gruppe zu richten («{term}»). J+S-Aktivitäten richten sich an alle Teilnehmenden.»
- **Prüfung:** A J+S activity whose title matches SUBGROUP, with no other J+S schedule entry overlapping it by ≥ `js.minUnitMinutes` (30) (parallel blocks count as «für alle»).
- **Params:** `js.minUnitMinutes`. **Keywords:** SUBGROUP.
- **Quellen:** [MAN S.21]; [TOOL-V «Die J+S-Aktivität»]; [PBS27 slide 7].
- **Tests:**
  - + «Pio-Workshop» alone → hint.
  - − «Pio-Workshop» in parallel with «Wölfe-Postenlauf» → none.

**LST-ACT-03** · lst · hint/best-practice · activity · mapping · 2026+
- **Titel:** Ziele der Aktivität fehlen
- **Meldung:** ««{activity}» hat keine Ziele. Ziele leiten sich aus Analyse, Erscheinungsformen und J+S-Zielen ab.»
- **Prüfung:** J+S activity with empty `learningObjectivesText`.
- **Quellen:** [TOOL-P step 2]; [MAN S.37].
- **Tests:** + empty → hint; − text present → none.

**LST-ACT-04** · lst · hint/best-practice · activity · mapping, keywords · 2026+
- **Titel:** Detailplanung unvollständig
- **Meldung:** «Bei «{activity}» fehlen Rubriken der Detailplanung: {missing}.»
- **Prüfung:** For a J+S activity, check four rubrics:
  - Ort (`location`).
  - Material (`materialText`).
  - Schlechtwettervariante: a SCHLECHTWETTER phrase anywhere; required only for OUTDOOR hits.
  - Sicherheitsüberlegungen.
  - The responsible person is left to CMP-ACT-01.
- **Quellen:** [MAN S.39].
- **Tests:**
  - + outdoor activity without location and weather variant → hint listing both.
  - − all present → none.

**LST-ACT-05** · lst · hint/heuristic · activity · mapping, keywords, activityTags · validFrom 2027-01-01
- **Titel:** Keine Erscheinungsform erkennbar
- **Meldung:** ««{activity}» lässt sich keiner Erscheinungsform zuordnen. Jede J+S-Aktivität zielt auf die Erscheinungsformen ab – ggf. EF-Tag setzen.»
- **Prüfung:** A J+S activity with no `ef*` tag and no match in any of EF1–EF6.
- **Quellen:** [MAN S.21]; [PBS27 slide 7].
- **Tests:**
  - + «Programmblock A» → hint.
  - − «Seilbrücke bauen» (EF1) → none.

**LST-ANG-01** · lst · should/heuristic · camp · keywords, activityTags, campConfig · validFrom 2027-01-01
- **Titel:** Keine Unternehmung im Programm
- **Meldung:** «Im Lager ist keine Unternehmung erkennbar (Aktivität ausserhalb des Lagerortes, z. B. Wanderung, Velotour). Ein J+S-Angebot braucht mindestens eine.»
- **Prüfung:**
  - Satisfied by any activity tagged `unternehmung`.
  - Otherwise satisfied by a J+S activity that matches UNTERNEHMUNG, is not tagged `keine-unternehmung`, and has an empty location or a location that differs from the camp address/name.
  - Skip if `angebot.unternehmungElsewhere`.
- **Quellen:** [TOOL-V «Das J+S-Angebot»]; [MAN S.21]; [PBS27 slide 5].
- **Tests:**
  - + no hike → should.
  - − «Tageswanderung Napf» → none.
  - − elsewhere flag → none.

**LST-ANG-02** · lst · hint/heuristic · camp · keywords, activityTags, campConfig · validFrom 2027-01-01
- **Titel:** Erscheinungsformen nicht alle sichtbar
- **Meldung:** «Für folgende Erscheinungsformen ist keine Aktivität erkennbar: {list}. Im Angebot müssen alle erlebbar werden.»
- **Prüfung:** Classify J+S activities into EF1–EF6, by tag first and keywords second. List the uncovered EFs. Skip if `angebot.efCoveredElsewhere`.
- **Quellen:** [MAN S.21, 26–27]; [TOOL-V]; [TOOL-G slides 1–6]; [PBS27 slide 5].
- **Tests:** + EF6 missing → hint naming it; − all six → none.

**LST-SB-01** · lst · should/heuristic · activity · keywords, documents, campConfig, activityTags, params · 2026+
- **Titel:** Möglicherweise Sicherheitsbereich {area}
- **Meldung:** ««{activity}» sieht nach einer Aktivität im Sicherheitsbereich {area} aus ({reason}). Falls zutreffend: als «SB {area}» markieren – dann gelten Expertenbewilligung, Zusatzanerkennung im Leitungsteam und nur Jugendliche (Jahrgang ≥ 10).»
- **Prüfung:** Skipped for activities tagged `sb-*` or `kein-sb`. «Multi-day» below means: the activity's schedule entries span ≥ 2 calendar days (an entry crossing midnight counts). «Winter month» means: the entry month ∈ `lst.winterMonths`. Triggers:
  - **Berg** (MB-UP S.3: «Mehrtägige Wanderungen mit Übernachtung im Biwak oberhalb der Waldgrenze»; anspruchsvolle T3):
    - T3 together with ANSPRUCHSVOLL; or
    - BIWAK **and** multi-day **and** above the treeline (GPX `highestPoint` > `lst.treelineM` (2000), or a TREELINE hit). Both conditions are required; the draft's multi-day-only path is dropped (it ignored the treeline condition).
  - **Wasser:**
    - RIVER together with BOAT or FLOSS (BOAT contains `=raft` and `rafting`), when not tagged `ebb-b`; or
    - BACHTREKKING together with ANSPRUCHSVOLL; or
    - an SB_WASSER_EXTRA hit (Flussschwimmen, Flusssurfen).
  - **Winter** (only in winter months):
    - SNOWSHOE and (GPX `estimatedMinutes` > `lst.snowshoeSbMinutes` (180), multi-day, or ANSPRUCHSVOLL); or
    - (BIWAK **or** IGLU) and `campConfig.campForm !== 'haus'` (MB-UP S.4: «Biwakübernachtungen, die im Zelt, Iglu usw. stattfinden, ohne dass ein Lagerhaus mit wintersicherer Zufahrt schnell erreicht werden kann»; this reverts correction B6, which excluded IGLU against the source). Outside winter months this path never fires.
  - The `{area}` hit is downgraded to hint if that area module is not effectively on.
- **Params:** `lst.treelineM`, `lst.snowshoeSbMinutes`, `lst.winterMonths`.
- **Keywords:** T3, ANSPRUCHSVOLL, BIWAK, TREELINE, RIVER, BOAT, FLOSS, BACHTREKKING, SB_WASSER_EXTRA, SNOWSHOE, IGLU.
- **Quellen:** [MB-UP S.3 «Definition Aktivitäten im Sicherheitsbereich Berg», S.4 (Winter), S.5 (Wasser)]; [WEB-SICH].
- **Tests:**
  - + «Flossfahrt auf der Aare» → should (wasser).
  - + «Iglunacht» in February, `campForm: zelt` → should (winter).
  - − «Iglunacht» in February, `campForm: haus` → none.
  - − «Biwak» in July, `campForm: zelt`, single day, no GPX → none (no winter month, not multi-day above the treeline).
  - + «Biwak» spanning 2 days in July with GPX `highestPoint` 2300 → should (berg).
  - − «Biwak» spanning 2 days in July with GPX `highestPoint` 1400 → none.
  - + «Schneeschuhtour 2 Tage» in February → should (winter).
  - − tagged kein-sb → none.

**Camp-level winter case (shared by LST-SB-02, LST-SB-03, LST-SB-04).** The camp counts as Sicherheitsbereich Winter when `campConfig.camp.winterSafeAccess === false` **and** the camp overlaps `lst.winterMonths` (§2.2). A summer camp with `winterSafeAccess === false` is never a camp-level winter case. The hit targets the **camp IRI** (allowed regardless of `scope: activity`, §3.3), uses message variant `camp`, and is lowered to `should` per hit because the winter determination is a co-co proxy (§0.3).

**LST-SB-02** · lst · must/verified · activity · activityTags, campConfig, params · 2026+
- **Titel:** Sicherheitsbereich ohne Expertenbewilligung
- **Meldung:** ««{activity}» ist im Sicherheitsbereich {area}. Jede solche Aktivität muss vor der Durchführung durch eine J+S-Expertin / einen J+S-Experten LS/T mit Zusatz im Sicherheitsbereich {area} bewilligt werden – Bewilligung nicht erfasst.»
- **Variant `camp`:** «Lager ohne wintersichere Zufahrt gilt als Sicherheitsbereich Winter – Expertenbewilligung nicht erfasst.» (should, camp IRI)
- **Prüfung:**
  - Per activity tagged `sb-*`: the rule is satisfied when `sbApprovals[iri]` exists and either `approvedOn` is set **or** `kind === 'bergfuehrer'`. An entry with `kind: bergfuehrer` satisfies the rule even when `approvedOn` is `null`, because activities led by a Bergführer with eidg. Fachausweis need no expert approval [WEB-C «1. Schritt»]. Otherwise fire (must).
  - Camp-level winter case (see above): satisfied by `sbApprovals.camp` under the same condition; otherwise fire with variant `camp`.
- **Params:** `lst.winterMonths`.
- **Quellen:**
  - [WEB-C «1. Schritt: Anmeldung durch J+S-Coach»] «Folgende Sicherheitsaktivitäten müssen angemeldet und vor ihrer Durchführung durch eine J+S-Expertin oder einen J+S-Experten der entsprechenden Sportart oder Disziplin bewilligt werden: […] in der Sportart Lagersport/Trekking jede Aktivität in den Sicherheitsbereichen «Berg», «Wasser» und «Winter».» The same section states the exception for leadership by a Bergführer with eidg. Fachausweis (paraphrased; verified in the source extraction, not quoted verbatim).
  - [MB-UP S.2]
  - [WEB-SICH «Sicherheitsbereiche»]
- **Tests:**
  - + tag sb-wasser, no approval → must.
  - − approval date set → none.
  - − `sbApprovals[iri] = {approvedOn: null, kind: 'bergfuehrer'}` → none.
  - − `sbApprovals[iri] = {approvedOn: null, kind: 'experte'}` → must.
  - + winterSafeAccess false, camp in February, no camp approval → should `camp` (target camp IRI).
  - − winterSafeAccess false, camp in July → none.

**LST-SB-03** · lst · must/verified · activity · activityTags, campConfig, midata, params · 2026+ · `formerIds: [SAFE-MTN-03]`
- **Titel:** Sicherheitsbereich ohne Zusatzanerkennung im Team
- **Meldung:** «Für «{activity}» (Sicherheitsbereich {area}) braucht mindestens eine J+S-Leitungsperson einen gültigen Zusatz im Sicherheitsbereich {area} – im Leitungsteam ist keiner erfasst.»
- **Variant `camp`:** «Lager ohne wintersichere Zufahrt gilt als Sicherheitsbereich Winter – im Leitungsteam ist kein gültiger Zusatz Sicherheitsbereich Winter erfasst.» (should, camp IRI)
- **Variant `unknown`:** «Zusatzanerkennungen nicht prüfbar (MiData nicht verbunden oder nicht lesbar).» (hint, camp IRI, at most once)
- **Prüfung:**
  - Per activity tagged `sb-berg` / `sb-wasser` / `sb-winter`: MiData key `sbBerg` / `sbWasser` / `sbWinter`, summing `validLeaders` (validity matters: «gültigen Zusatz»). Fire on the activity if the sum is 0.
  - Camp-level winter case: key `sbWinter`; fire with variant `camp`.
  - With no MiData or `qualificationsReadable === false`: one hint, variant `unknown`, instead of the above.
- **Params:** `lst.winterMonths`.
- **Quellen:** [MB-UP S.2] «Mindestens eine J+S-Leitungsperson verfügt über einen gültigen Zusatz im entsprechenden Sicherheitsbereich»; [WEB-ZA]; [WEB-SICH].
- **Tests:**
  - + sb-berg, sbBerg valid 0 → must.
  - − sbBerg valid 1 → none.
  - + no MiData → hint `unknown`.
  - + winterSafeAccess false, camp in January, sbWinter valid 0 → should `camp`.

**LST-SB-04** · lst · should/verified · activity · activityTags, campConfig, midata, params · 2026+
- **Titel:** Sicherheitsbereich nur mit Jugendlichen
- **Meldung:** ««{activity}» liegt im Sicherheitsbereich {area} und ist nur mit Jugendlichen erlaubt. Im Lager sind {n} Teilnehmende gemäss J+S-Jahrgangslogik noch Kinder (Jahrgang {fromYear} und jünger) – sie dürfen nicht teilnehmen.»
- **Variant `camp`:** «Das Lager ohne wintersichere Zufahrt gilt als Sicherheitsbereich Winter und ist nur mit Jugendlichen erlaubt. Im Lager sind {n} Teilnehmende gemäss J+S-Jahrgangslogik noch Kinder (Jahrgang {fromYear} und jünger).» (camp IRI)
- **Prüfung:**
  - One hit per activity tagged `sb-*`, plus the camp-level winter case (variant `camp`).
  - From `participantsByBirthYear`, n = count with `campYear − y < lst.sbMinAgeByYear` (10); `fromYear = campYear − 9`. Fire if n > 0.
  - Check by birth year, never by birth date [WEB-C «Definition Kinder und Jugendliche»].
  - Severity is should: who takes part in the activity is not in the data.
- **Params:** `lst.sbMinAgeByYear`, `lst.winterMonths`.
- **Quellen:** [MB-UP S.2] «nur mit Jugendlichen (10–20 Jahre) …, nicht aber mit Kindern unter 10 Jahren»; [WEB-C].
- **Tests** (campYear 2027):
  - + one TN born 2018, one sb-berg activity → should.
  - − youngest born 2017 → none (turns 10 in 2027 = Jugendlicher).
  - + one TN born 2018, winterSafeAccess false, camp in February, no sb tags → should `camp`.

**LST-SB-05** · lst · should/verified · activity · activityTags, documents, params · 2026+
- **Titel:** Sicherheitsbereich: detaillierte Planung fehlt
- **Meldung:** «Für «{activity}» (Sicherheitsbereich {area}) fehlt eine detaillierte Planung mit Sicherheitskonzept.»
- **Prüfung:** Tagged `sb-*`, safety text < `lst.sbSafetyMinChars` (300), and no document linked to the activity.
- **Quellen:** [MB-UP S.2] «Alle Aktivitäten im Sicherheitsbereich müssen detailliert geplant und vorbereitet werden inkl. Sicherheitskonzept».
- **Tests:**
  - + tagged, 50 chars, no doc → should.
  - − linked doc → none.

### 5.3 Module `lst-lager`

**LST-LAGER-01** · lst-lager · should/heuristic · camp · documents, keywords · 2026+ · `formerIds: [SAFE-DOC-01]`
- **Titel:** Sicherheitskonzept fürs Lager
- **Meldung:** «Kein Sicherheitskonzept für das Lager gefunden.»
- **Variants:**
  - `incomplete`: «Im Sicherheitskonzept fehlen: {missing}.»
  - `riskNotNamed`: «Aktivitäten mit erhöhten Sicherheitsanforderungen sind im Konzept nicht erwähnt: {list}.» (hint)
- **Prüfung:**
  - Pick the document of kind `sicherheitskonzept`, else the document with the most docCheck items found.
  - None → should.
  - Otherwise list the missing docCheck items.
  - `riskNotNamed`: titles of MOUNTAIN, WATER, WINTER, ROPE or EBB activities that do not appear in the concept text.
- **Quellen:** [MB-UP S.1] «haben ein Sicherheitskonzept, das … Massnahmen zur Verhinderung von Unfällen definiert und das Vorgehen im Notfall beinhaltet»; [LAGER S.22]; [MAN S.45]; [WINTER S.27].
- **Tests:**
  - + no documents → should.
  - + concept without the hospital item → should `incomplete`.
  - − complete → none.

**LST-LAGER-02** · lst-lager · hint/unverified · camp · documents · 2026+
- **Titel:** Lagerdossier unvollständig
- **Meldung:** «Im Lagerdossier fehlen voraussichtlich: {missing}.»
- **Prüfung:** Evidence per part:
  - Grobprogramm: always ok (eCamp).
  - Detailprogramm: CMP-ACT-02 compliance ≥ 90 %.
  - Routenplanung: LST-TREK-01 clean.
  - Sicherheitskonzept: LST-LAGER-01 clean.
  - Lagerregeln: document kind `lagerregeln`.
  - TN-Information: document kind `lagerinfo`.
  - Schlechtwetterprogramm: SAFE-WX-01 clean.
- **Quellen:** [LAGER S.23] (2014).
- **Tests:** + no Lagerregeln document → hint naming it; − all present → none.

**LST-LAGER-03** · lst-lager · hint/unverified · camp · documents, keywords · 2026+
- **Titel:** Lagerregeln: Pflichtbereiche
- **Meldung:** «In den Lagerregeln fehlt ein Bezug zu: {missing}.»
- **Prüfung:** Only runs if a `lagerregeln` document exists. Checks the groups RULES_SICHERHEIT, RULES_SUCHT, RULES_ZUSAMMEN, RULES_ELEKTRONIK and RULES_UMWELT.
- **Quellen:** [LAGER S.32–33]; [MAN S.16] (no tobacco or alcohol during sport); [MB-UP S.1] «legen klare Regeln fest».
- **Tests:** + rules without «Handy» → hint; − all five groups → none.

**LST-LAGER-04** · lst-lager · hint/best-practice · day · keywords · 2026+
- **Titel:** Kein täglicher Leiterhöck
- **Meldung:** «Am {date} ist kein Leiterhöck / Tagesrückblick im Programm.»
- **Prüfung:** Every day except the last; no entry whose title matches HOECK.
- **Quellen:** [LAGER S.20]; [TOOL-P step 5].
- **Tests:** + day without one → hint; − «Leiterhöck 21:30» → none.

**LST-LAGER-05** · lst-lager · hint/best-practice · camp · keywords · 2026+
- **Titel:** Lagerregeln und Sicherheitsinfo am ersten Tag
- **Meldung:** «Am ersten Lagertag ist kein Programmpunkt zu Lagerregeln oder Sicherheit erkennbar.»
- **Prüfung:** No day-1 entry whose title or storyboard matches DAY1_INFO.
- **Quellen:** [LAGER S.31–32, 37]; [MB-UP S.1] «legen klare Regeln fest».
- **Tests:** + day 1 only «Anreise» → hint; − «Begrüssung und Lagerregeln» → none.

**LST-LAGER-06** · lst-lager · hint/unverified · scheduleEntry · keywords, params · 2026+
- **Titel:** Auf-/Abbau in der Nachtruhe
- **Meldung:** ««{activity}» (Auf-/Abbau) liegt zwischen {from} und {to}.»
- **Prüfung:** Title matches BUILD and the entry overlaps `lst.buildQuietWindow` (22:00–07:00).
- **Quellen:** [LAGER S.40] (2014 only, so `unverified` per §0.2).
- **Tests:** + «Abbau» 22:30–23:30 → hint; − 14:00 → none.

**LST-LAGER-07** · lst-lager · hint/heuristic · activity · keywords · 2026+
- **Titel:** Feuer: Waldbrandgefahr bedenken
- **Meldung:** ««{activity}» arbeitet mit Feuer. Überlegungen zu Feuerstelle und Waldbrandgefahr fehlen.»
- **Prüfung:** FIRE hit and the safety text has no FIRE_SAFETY hit.
- **Quellen:** [MAN S.61, 66].
- **Tests:** + «Bräteln» without safety text → hint; − with «Feuerverbot geprüft» → none.

### 5.4 Module `lst-trekking`

**LST-TREK-01** · lst-trekking · should/heuristic · activity · documents, keywords, activityTags · 2026+ · `formerIds: [SAFE-MTN-01]`
- **Titel:** Planungsunterlagen zur Wanderung
- **Meldung:** «Für «{activity}» fehlen Unterlagen, die mit dem Lagerprogramm beim Coach einzureichen sind: {missing}.»
- **Prüfung:**
  - Applies to activities tagged `unternehmung`, or with a HIKE hit and not tagged `keine-unternehmung`.
  - Four parts, each checked separately:
    1. **Route / Kartenausschnitt:** a linked GPX or map document, or ROUTE_DOC in the text.
    2. **Alternativroute:** ALT_ROUTE in the text or a linked document.
    3. **Zeitberechnung:** a GPX link, or MARSCHZEIT in the text.
    4. **Sicherheitskonzept:** safety text ≥ `lst.hikeSafetyMinChars` (150) or a linked document.
- **Quellen:** [MB-UP S.3] «Jede Wanderung muss mit einer Routenplanung (inkl. Alternativrouten) und Zeitberechnung vorbereitet werden. Die Lagerleitung muss sie mit Kartenausschnitt und Sicherheitskonzept zusammen mit dem gesamten Lagerprogramm beim J+S-Coach einreichen.»; [WEB-SICH]; [BERG S.12].
- **Tests:**
  - + «Wanderung Rigi» with GPX only → should, missing alternative route and safety concept.
  - − all four present → none.

**LST-TREK-02** · lst-trekking · should/heuristic · activity · documents, settings, coachInputs, midata, params · 2026+ · `formerIds: [SAFE-MTN-02]`
- **Titel:** Marschzeit länger als Programmfenster
- **Meldung:** «Geschätzte Marschzeit von «{activity}» {estimate} (inkl. Pausen) passt nicht ins Programmfenster von {slot}.»
- **Prüfung:**
  - Estimate from GPX Lkm. Descent counts `lst.descentHmPerLkm` (150 Hm = 1 Lkm) by default.
  - Pace: `lst.paceKidsLkmPerHour` (3) when Stufe ∈ {biber, woelfe} or the youngest Jahrgang is < 10; otherwise `lst.paceLkmPerHour` (4). `settings.gpx` values remain coach overrides.
  - Pauses: + `lst.pauseMinutesPerHour` (10).
  - Compare against the longest schedule-entry slot of the activity.
  - **Per-hit confidence:** the duty to calculate the time is current [MB-UP S.3], but the pace, descent and pause values come only from BERG (2014). When the estimate uses the default value of any of `lst.paceLkmPerHour`, `lst.paceKidsLkmPerHour`, `lst.descentHmPerLkm` or `lst.pauseMinutesPerHour` (not coach-overridden, `ctx.params.isOverridden(key) === null`), the hit's confidence is lowered to `unverified`. With all used values coach-overridden it stays `heuristic`.
- **Params:** `lst.paceLkmPerHour`, `lst.paceKidsLkmPerHour`, `lst.descentHmPerLkm`, `lst.pauseMinutesPerHour`.
- **Quellen:** [MB-UP S.3] «Zeitberechnung»; [BERG S.14, 21].
- **Tests:** + 16 Lkm with kids in a 4 h slot → should, confidence `unverified` (default pace); + same with coach-overridden pace and descent/pause values → should, `heuristic`; − 8 Lkm → none.

**LST-TREK-03** · lst-trekking · hint/unverified · activity · documents, coachInputs, midata, params · 2026+
- **Titel:** Wanderung für Kinder zu lang
- **Meldung:** «Geschätzte Marschzeit von «{activity}» {h} h. Mit Kindern sollte die effektive Wanderzeit {max} h nicht überschreiten.»
- **Prüfung:** GPX estimate > `lst.hikeKidsMaxMinutes` (180), and the Stufe is biber/woelfe or the youngest Jahrgang < 10.
- **Quellen:** [BERG S.4] (2014 only, recommendation; so `unverified` per §0.2).
- **Tests:** + 4 h with Wölfe → hint; − Pfadi → none.

**LST-TREK-04** · lst-trekking · should/unverified · activity · keywords · 2026+
- **Titel:** Umkehrzeit / Abbruchkriterien fehlen
- **Meldung:** «Für «{activity}» sind keine Umkehrzeit bzw. Abbruch- und Ausweichkriterien festgehalten.»
- **Prüfung:**
  - HIKE or MOUNTAIN hit → should.
  - WATER (not POOL), WINTER or ROPE hit → downgraded to hint.
  - Fires when the safety text has no UMKEHR hit and no time pattern `\b\d{1,2}[:.]\d{2}\b` within 40 characters of «umkehr» or «abbruch».
- **Quellen:** [BERG S.6, 15] (2014); [WASSER S.17]; [MAN S.44–45] (risk matrix, recommended); [MB-UP S.1] «Vorgehen im Notfall».
- **Tests:**
  - + hike without one → should.
  - + raft without one → hint.
  - − «Umkehrzeit 14:00» → none.

**LST-TREK-05** · lst-trekking · hint/best-practice · activity · keywords · 2026+
- **Titel:** Unterwegs mit nur einer Leitungsperson
- **Meldung:** ««{activity}» hat {n} verantwortliche Person(en). Unterwegs sollten mindestens zwei Leitende dabei sein (Spitze und Schluss).»
- **Prüfung:** HIKE or BIKE hit and `responsibleIris.length` < 2.
- **Quellen:** [BERG S.7, 18]; [MB-UP S.2] «Verantwortliche Personen am Anfang und am Ende der Gruppe sind bestimmt» (Strassenverkehr).
- **Tests:** + 1 responsible → hint; − 2 → none.

**LST-TREK-06** · lst-trekking · should/heuristic · activity · keywords · 2026+
- **Titel:** Notfallausrüstung unterwegs
- **Meldung:** «Im Material/Sicherheitsteil von «{activity}» fehlt: {missing} (Notfallapotheke, Rettungsdecke oder Biwaksack, Alarmierungsmittel).»
- **Prüfung:**
  - Applies to activities tagged `unternehmung`, or with a hit in HIKE, BIWAK, WATER (not POOL) or WINTER outdoor.
  - Check the groups KIT_APOTHEKE, KIT_RETTUNGSDECKE and KIT_ALARM in material text plus safety text.
  - The J+S-Notfallblatt is mentioned in the message only (not required by the current source).
- **Quellen:** [MB-UP S.1] «haben im Gelände eine Notfallapotheke, eine Rettungsdecke oder einen Biwaksack dabei und können im Notfall alarmieren»; [WEB-SICH] (adds «Mobiltelefon»); [BERG S.49]; [LAGER S.37].
- **Tests:** + hike material without a Rettungsdecke → should; − «Apotheke, Biwaksack, Natel» → none.

**LST-TREK-07** · lst-trekking · hint/unverified · activity · keywords, coachInputs, midata · 2026+
- **Titel:** Biwak mit jüngeren Kindern
- **Meldung:** ««{activity}» ist ein Biwak/Zelttrekking. Biwaks eignen sich primär für Jugendliche.»
- **Prüfung:** BIWAK hit, and the Stufe is biber/woelfe or the youngest Jahrgang < 10.
- **Quellen:** [BERG S.43] (2014 only, so `unverified` per §0.2).
- **Tests:** + Wölfe biwak → hint; − Pios → none.

**LST-TREK-08** · lst-trekking · should/heuristic · activity · keywords · 2026+
- **Titel:** Velo/Trottinett/Inline: Sicherheit
- **Meldung:** «Für «{activity}» fehlen: {missing} (Helmkontrolle, Instruktion Fahr- und Bremstechnik, bei Inline-Skates Schutzausrüstung).»
- **Prüfung:**
  - BIKE hit. Groups: BIKE_HELM and BIKE_INSTR.
  - When a BIKE_INLINE hit is present, also BIKE_PROTECT.
  - EBB_B «Trottinett-Abfahrt» counts too.
- **Keywords:** BIKE, BIKE_INLINE, BIKE_HELM, BIKE_INSTR, BIKE_PROTECT, EBB_B.
- **Quellen:** [MB-UP S.2] «kontrollieren, dass alle einen korrekt sitzenden Helm tragen …; instruieren vorgängig Fahr- und Bremstechnik …; benutzen Inline-Skates mit Bremsvorrichtung und tragen zusätzliche Schutzausrüstung»; [LAGER S.11].
- **Tests:** + «Velotour» without «Helm» → should; − «Helm, Bremstechnik instruiert» → none.

**LST-TREK-09** · lst-trekking · should/heuristic · activity · keywords, campConfig · 2026+
- **Titel:** Rekognoszierung der Wanderung
- **Meldung:** «Für «{activity}» ist keine Rekognoszierung festgehalten. Wanderungen in alpinen und voralpinen Gebieten, im Jura und im Ausland müssen rekognosziert werden.»
- **Variant `soll`:** «… Alle Wanderungen sollen vor dem Lager rekognosziert werden.» (hint)
- **Prüfung:**
  - HIKE hit or tag `unternehmung`, and no RECO hit in any text.
  - `campConfig.region` ∈ {voralpen, alpen, jura, ausland} or `abroad` → should.
  - Region unset or mittelland → hint `soll`.
- **Quellen:** [MB-UP S.3]; [WEB-SICH]; [BERG S.13].
- **Tests:**
  - + alpen without reko → should.
  - + mittelland → hint.
  - − «Route am 12.5. rekognosziert» → none.

### 5.5 Module `lst-berg`

**LST-BERG-01** · lst-berg · should/heuristic · activity · keywords, documents, activityTags · 2026+
- **Titel:** Tour ausserhalb Lagersport/Trekking
- **Meldung:** ««{activity}» enthält «{term}». Mit einer LS/T-Anerkennung nicht erlaubt sind Alpinwandern ab T4, Seil/Abseilen zur Hindernisüberwindung, Gletscher und Klettersteige. Möglich nur als ergänzender Bewegungsblock unter Leitung einer Person mit passender J+S-Anerkennung (z. B. Bergsteigen).»
- **Prüfung:** ALPINE hit (the set contains the regex `\bt\s?[4-6]\b` for T4–T6) in text or material. Activities tagged `ebb-a` are downgraded to hint (variant `ebbA`: «… Leitung mit Anerkennung Bergsteigen sicherstellen»).
- **Quellen:** [MB-UP S.3 «Mit einer Anerkennung Lagersport/Trekking nicht erlaubt»]; [MB-UP S.6]; [BERG S.10–11, 31].
- **Tests:**
  - + «Klettersteig Braunwald» → should.
  - + same tagged ebb-a → hint.
  - − «Wanderung T2» → none.

**LST-BERG-02** · lst-berg · hint/heuristic · activity · keywords, coachInputs, midata · 2026+
- **Titel:** T3-Wanderung
- **Meldung:** ««{activity}» ist als T3 angegeben. Für T3 empfiehlt J+S den Zusatz Sicherheitsbereich Berg oder Erfahrung im Bergwandern mit Gruppen; anspruchsvolle T3-Touren gehören zum Sicherheitsbereich Berg (nur Jugendliche).»
- **Prüfung:** T3 regex, and not tagged `sb-berg` (the SB rules take over then). If kids are present (Stufe biber/woelfe or Jahrgang < 10), the message adds «für Kinder ungeeignet».
- **Quellen:** [MB-UP S.3]; [BERG S.10].
- **Tests:** + «T3» → hint; − «T2» → none.

**LST-BERG-03** · lst-berg · hint/heuristic · activity · keywords, params · 2026+
- **Titel:** Gewitterrisiko am Nachmittag
- **Meldung:** ««{activity}» endet um {end}. Im Sommer treten Gewitter meist nachmittags auf – rechtzeitige Rückkehr und Abbruchkriterium planen.»
- **Prüfung:**
  - MOUNTAIN or WATER (not POOL) hit.
  - Entry month ∈ `lst.thunderstormMonths` (6–9).
  - End after `lst.thunderstormEnd` (16:00).
  - The safety text lacks a GEWITTER hit.
- **Quellen:** [BERG S.6, 33]; [WASSER S.36].
- **Tests:** + July hike ending 17:30 → hint; − with «Gewitter» noted → none.

**LST-BERG-04** · lst-berg · hint/unverified · activity · documents, keywords, params · 2026+
- **Titel:** Altschnee / Schneefall möglich
- **Meldung:** «Höchster Punkt von «{activity}» {m} m ü. M. im {month}. Mit Altschnee bzw. Schneefall rechnen; Variante bei Nebel/Schnee planen.»
- **Prüfung:**
  - GPX `highestPoint` > `lst.oldSnowHighAltitude` (2000) with entry month ∈ `lst.oldSnowHighMonths` (3–6), or > `lst.oldSnowLowAltitude` (1000) with entry month ∈ `lst.oldSnowLowMonths` (4, 5, 10, 11).
  - No SNOW_FOG hit in the text.
- **Params:** `lst.oldSnowHighAltitude`, `lst.oldSnowHighMonths`, `lst.oldSnowLowAltitude`, `lst.oldSnowLowMonths`.
- **Quellen:** [BERG S.6, 33] (2014 only, so `unverified` per §0.2).
- **Tests:** + 2300 m in June → hint; − 2300 m in August → none.

### 5.6 Module `lst-wasser`

**LST-WASSER-01** · lst-wasser · should/heuristic · activity · keywords · 2026+ · `formerIds: [SAFE-WATER-01]`
- **Titel:** Wasseraktivität: Aufsicht und Sicherheitsüberlegungen
- **Meldung:** «Bei «{activity}» fehlt {missing}.»
- **Variants:** `noResponsible` («eine verantwortliche Leitungsperson – auch beim freien Spielen muss eine Leitungsperson anwesend sein»), `noSafety` («Sicherheitsüberlegungen»).
- **Prüfung:** WATER hit (exclusions as today). Check whether `responsibleIris` is empty and whether the safety text is empty.
- **Quellen:** [WASSER S.3, 5, 18]; [MB-UP S.5] «Die Aktivität, Betreuung und Ausrüstung wird … angepasst».
- **Tests:** + «Baden im See» without a responsible → should; − with both → none.

**LST-WASSER-02** · lst-wasser · should/heuristic · activity · keywords, activityTags · 2026+
- **Titel:** Nur offene, schwimmfähige Boote
- **Meldung:** ««{activity}» erwähnt «{term}». Mit LS/T sind nur Boote zulässig, die vollgelaufen schwimmfähig bleiben (offen, Sit-on-Top, aufblasbar) oder Flosse; nicht erlaubt sind geschlossene Boote und anspruchsvolle Wassersportarten wie Gerätetauchen.»
- **Prüfung:** CLOSED_BOAT or DIVING hit. Tag `ebb-a` → hint (Kanusport leader).
- **Quellen:** [MB-UP S.5].
- **Tests:** + «Kajak mit Spritzdecke» → should; − «Kanadier» → none.

**LST-WASSER-03** · lst-wasser · hint/heuristic · activity · keywords · 2026+
- **Titel:** Floss: Bewilligung und Westen
- **Meldung:** «Floss bei «{activity}»: Flösse ab 2,50 m Länge brauchen eine Bewilligung des kantonalen Schifffahrtsamts. Auf dem See tragen alle eine Schwimmweste; ausserhalb der Uferzone (300 m) zusätzlich Rettungswesten mitführen.»
- **Prüfung:** FLOSS hit, and the text has no FLOSS_OK hit.
- **Quellen:** [WASSER S.20, 23]; [MB-UP S.5].
- **Tests:** + «Flossbau und Fahrt» → hint; − with «Bewilligung Schifffahrtsamt» → none.

**LST-WASSER-04** · lst-wasser · should/heuristic · activity · keywords, activityTags, midata · 2026+
- **Titel:** Wasseraufsicht: Qualifikation fehlt
- **Meldung:** «Für «{activity}» ({setting}) braucht es eine Person mit {required} – im Leitungsteam ist keine erfasst. Alternativ eine qualifizierte Aufsichtsperson engagieren.»
- **Variant `unknown`:** «Qualifikationen nicht prüfbar.» (hint)
- **Prüfung:**
  1. **Setting**, from tags first (`wasser-bad-beaufsichtigt` → `bad`, `wasser-pool` → `pool`, `wasser-see` → `see`, `wasser-fluss` → `fluss`), otherwise by keywords, with the strictest match winning (`fluss` > `see` > `pool` > `bad`):
     - RIVER together with SWIM → `fluss`;
     - LAKE → `see`;
     - POOL together with UNSUPERVISED → `pool`;
     - POOL → `bad`.
     **Supervised baths win over LAKE/RIVER for the same term.** MB-UP S.5 defines «Beaufsichtigtes Bad (Hallenbad/Freibad/Seebad/Flussbad)». The terms `seebad`, `strandbad` and `flussbad` are therefore in POOL and are **excluded** from LAKE and RIVER (§6), so «Baden im Seebad» resolves to `bad`, not `see`. A text that also names an open lake or river elsewhere (e.g. «Seebad, danach Schwimmen im offenen See») still hits LAKE and resolves to `see`.
     Only activities IM or AUF dem Wasser are in scope; AM_WATER-only texts (Füsse baden, Wasserrad) are skipped.
  2. **Required MiData key:**
     - `bad` → `waterBath`
     - `pool` → `waterPoolUnsupervised`
     - `see` → `waterLake`
     - `fluss` → `waterRiver` (J+S Kanu etc., Modul Wasser LS/T and the I-Modul «Aufsichtsperson Wasser» do **not** count here; §3.7)
  3. **Fire** if the team's `validLeaders` for that key is 0.
  4. **Suppression:** tag `externe-wasseraufsicht`, or an override.
- **Keywords:** WATER, POOL, LAKE, RIVER, SWIM, UNSUPERVISED, AM_WATER.
- **Quellen:** [MB-UP S.5] (settings list, footnote 1); [WEB-SICH]; [WEB-L «Wassersicherheit»].
- **Tests:**
  - + «Baden im Bielersee», waterLake 0 → should.
  - − waterLake 1 → none.
  - − «Baden im Bielersee», only a «Modul Wasser LS/T» leader → none (that module maps to `waterLake`).
  - + «Baden im Seebad», waterBath 0, waterLake 1 → should, setting `bad` (requires `waterBath`, not `waterLake`).
  - − «Baden im Seebad», waterBath 1, waterLake 0 → none.
  - + «Flussschwimmen Aare», only a Kanu leader → should.
  - − «Wasserrad am Bach bauen» → none.

**LST-WASSER-05** · lst-wasser · should/heuristic · activity · keywords · 2026+
- **Titel:** Bachtrekking: Pflichtpunkte
- **Meldung:** «Für das Bachtrekking «{activity}» fehlen in den Sicherheitsüberlegungen: {missing} (Wetterbericht, Ausstiegsmöglichkeiten, Rekognoszierung, Kraftwerk/Schwall).»
- **Prüfung:** BACHTREKKING hit. Groups: WETTER, AUSSTIEG, RECO and KRAFTWERK.
- **Quellen:** [WASSER S.13, 15, 16]; [MB-UP S.3, 5].
- **Tests:** + no Wetter → should listing it; − all four → none.

**LST-WASSER-06** · lst-wasser · should/heuristic · activity · keywords · 2026+
- **Titel:** Seeschwimmen ohne Begleitboot
- **Meldung:** «Bei «{activity}» (Strecke im See) muss mindestens eine Leitungsperson die Gruppe im Boot oder mit Rettungsbrett begleiten.»
- **Prüfung:** LAKE_SWIM hit, and no ESCORT hit.
- **Quellen:** [WASSER S.19].
- **Tests:** + «Seeüberquerung» → should; − «mit Begleitboot» → none.

**LST-WASSER-07** · lst-wasser · hint/heuristic · activity · keywords · 2026+
- **Titel:** Springen ins Freigewässer
- **Meldung:** ««{activity}» erwähnt Springen. Vom Springen in Freigewässer wird abgeraten; falls doch: Kriterien (klares, tiefes Wasser, keine Hindernisse, umgehbar) festhalten.»
- **Prüfung:** WATER (not POOL) hit together with JUMP.
- **Quellen:** [WASSER S.36].
- **Tests:** + «Brückensprung in die Aare» → hint; − «Sprungturm Hallenbad» → none.

**LST-WASSER-08** · lst-wasser · should/heuristic · activity · keywords · 2026+
- **Titel:** Seil oder Abseilen im Fliessgewässer / in der Schlucht
- **Meldung:** ««{activity}» kombiniert Seil/Abseilen mit Fluss oder Schlucht. Man darf sich nie angeseilt in einen Fluss begeben; Flusstrekking mit Seil oder Abseilen ist mit LS/T nicht erlaubt, Canyoning ist von J+S ausgeschlossen.»
- **Prüfung:** (RIVER or GORGE) together with ROPE_IN_WATER.
- **Keywords:** RIVER, GORGE, ROPE_IN_WATER.
- **Quellen:** [MB-UP S.5]; [WASSER S.21, 35]. This resolves correction B5: a GORGE hit alone never fires.
- **Tests:** + «Abseilen in die Schlucht» → should; − «Schluchtwanderung» → none.

**LST-WASSER-09** · lst-wasser · hint/heuristic · activity · keywords · 2026+
- **Titel:** Wärmeschutz für Wasseraktivitäten
- **Meldung:** «Für «{activity}» fehlen in Material/Sicherheit Rettungsfolie bzw. Wärmekissen.»
- **Prüfung:** WATER (not POOL) hit, and no KIT_WAERME hit.
- **Quellen:** [WASSER S.33].
- **Tests:** + no Rettungsfolie → hint; − «Rettungsfolie» → none.

**LST-WASSER-10** · lst-wasser · should/heuristic · activity · keywords · 2026+
- **Titel:** Westen bei Boots- und Flossaktivitäten
- **Meldung:** «Bei «{activity}» sind keine Schwimm- bzw. Rettungswesten erwähnt. Auf dem See tragen alle eine Schwimmweste; auf Fliessgewässern auf Kanu/SUP Schwimmweste, auf anderen Booten und Flossen Rettungsweste mit Kragen.»
- **Prüfung:** BOAT or FLOSS hit, and no VEST hit in material or safety text.
- **Quellen:** [MB-UP S.5] «Beim Bootfahren auf dem See müssen alle eine Schwimmweste tragen»; «Für alle anderen Boote und Flosse sind Rettungswesten mit Kragen und höherem Auftrieb vorgeschrieben».
- **Tests:** + «Kanadiertour» without Weste → should; − «Schwimmwesten für alle» → none.

### 5.7 Module `lst-winter`

**LST-WINTER-01** · lst-winter · should/verified · camp · campConfig, params · 2026+
- **Titel:** Winterlager: Haus mit wintersicherer Zufahrt
- **Meldung:** «Lager im Winter finden in einem Haus mit wintersicherer Zufahrt statt – Angabe zur Zufahrt fehlt.» (hint)
- **Variant `notHouse`:** «Lager im Winter finden in einem Haus statt – als Lagerform ist «{campForm}» erfasst.» (should)
- **Variant `noAccess`:** «Ohne wintersichere Zufahrt gilt das Lager als Sicherheitsbereich Winter (Expertenbewilligung, Zusatz Winter, nur Jugendliche).» (hint)
- **Prüfung:** Only when the camp overlaps `lst.winterMonths` (§2.2); otherwise no finding, even if the module is on via a tag. One hit per camp (findings are de-duplicated per camp IRI), chosen in this order:
  1. `campConfig.camp.campForm ∈ {zelt, gemischt}` → variant `notHouse`, should. Severity is should, not must, because «im Winter» is decided by the co-co param `lst.winterMonths` (proxy row of §0.2).
  2. `winterSafeAccess === false` → variant `noAccess`, hint; LST-SB-02…04 then evaluate the camp case.
  3. `winterSafeAccess === null` → default message, hint.
  4. Otherwise no finding.
- **Params:** `lst.winterMonths`.
- **Quellen:** [MB-UP S.4] «Lager im Winter finden in einem Haus mit wintersicherer Zufahrt statt»; S.4 definition of the SB Winter.
- **Tests:**
  - + February, `campForm: zelt` → should `notHouse`.
  - + February, `campForm: haus`, access null → hint.
  - + February, `campForm: haus`, access false → hint `noAccess`.
  - − February, `campForm: haus`, access true → none.
  - − July, `campForm: zelt`, access false → none (not a winter camp).

**LST-WINTER-02** · lst-winter · should/heuristic · activity · keywords, activityTags · 2026+
- **Titel:** Winteraktivität: fünf Grundregeln
- **Meldung:** «In den Sicherheitsüberlegungen zu «{activity}» fehlen Bezüge zu den Grundregeln: {missing} (keine Hänge ab 30°/25° bei Nassschnee, Lawinengefahr nur Stufe 1–2, unter 1800 m, 3×3, defensive Beurteilung).»
- **Prüfung:**
  - SNOWSHOE or WINTERHIKE hit. Groups: WR_HANG, WR_LAWINE, WR_HOEHE, WR_3X3, WR_DEFENSIV.
  - Activities tagged `gesicherter-bereich` or matching WINTER_SECURED need only groups 4–5 (the exception covers rules 1–3).
- **Quellen:** [MB-UP S.4] «bei allen Aktivitäten folgende 5 Grundregeln einzuhalten» (binding, closes the 2019 «empfehlen» question); [WINTER S.10–14].
- **Tests:**
  - + snowshoe without Lawine → should.
  - − on a «Schneeschuhtrail» with 3×3 and defensive → none.

**LST-WINTER-03** · lst-winter · should/heuristic · activity · documents, keywords, activityTags, params · 2026+
- **Titel:** Winterwanderung über 1800 m
- **Meldung:** «Höchster Punkt von «{activity}» {m} m ü. M. – Winteraktivitäten unterhalb von {max} m halten (ausser in gesicherten Bereichen).»
- **Prüfung:**
  - Winter module on, SNOWSHOE or WINTERHIKE hit, entry month ∈ `lst.winterMonths`.
  - GPX `highestPoint` > `lst.winterMaxAltitude` (1800).
  - Not tagged `gesicherter-bereich` and no WINTER_SECURED hit.
- **Severity / confidence:** should, because the secured-area exception cannot be read from GPX; `heuristic`, because the activity is selected (SNOWSHOE/WINTERHIKE) and suppressed (WINTER_SECURED) by keywords (§0.2). This is the simpler of the two options; a split «`sb-winter`-tagged → verified» path is not added.
- **Params:** `lst.winterMaxAltitude`, `lst.winterMonths`. **Keywords:** SNOWSHOE, WINTERHIKE, WINTER_SECURED.
- **Quellen:** [MB-UP S.4] rule 3.
- **Tests:** + 1950 m in February → should; − tagged gesicherter-bereich → none.

**LST-WINTER-04** · lst-winter · should/heuristic · activity · keywords · 2026+
- **Titel:** Schlitteln: Helm und Pistensicherheit
- **Meldung:** «Für «{activity}» fehlen: {missing} (Helm und feste Schuhe, Pistentest durch Leitende, Sicherheitszone/Auslauf, Aufsicht an Start und Auslauf).»
- **Prüfung:** SLED hit. Groups: SLED_HELM (must name «Helm»), SLED_TEST, SLED_ZONE, SLED_AUFSICHT. `responsibleIris` < 2 also adds «Aufsicht».
- **Quellen:** [MB-UP S.4] «tragen beim Schlitteln Helm und feste Schuhe und halten sich an die zehn Verhaltensregeln»; [WINTER S.19].
- **Tests:** + «Schlitteln» without Helm → should; − all present with 2 responsibles → none.

**LST-WINTER-05** · lst-winter · hint/heuristic · scheduleEntry · keywords, params · 2026+
- **Titel:** Draussen nach Einbruch der Dunkelheit
- **Meldung:** ««{activity}» endet um {end}, Sonnenuntergang ca. {sunset}. Im Winter sind die Tage kurz.»
- **Prüfung:** OUTDOOR, HIKE or SNOWSHOE hit in winter months; end > `lst.sunsetTable[month]` + 15 min. Night sledging adds «nur bei genügender Sicht».
- **Quellen:** [WINTER S.19, 20, 27].
- **Tests:** + January hike ending 17:45 → hint; − ending 15:30 → none.

**LST-WINTER-06** · lst-winter · hint/heuristic · activity · keywords · 2026+
- **Titel:** Zeit- und Ortsplan hinterlegen
- **Meldung:** «Für «{activity}» ist keine Rückmeldezeit bzw. Vertrauensperson mit Zeit- und Ortsplan festgehalten.»
- **Prüfung:** SNOWSHOE, BIWAK or HIKE hit in winter months, and no RUECKMELD hit.
- **Quellen:** [WINTER S.27]; [BERG S.16].
- **Tests:** + no mention → hint; − «Rückmeldung an Lagerleitung bis 16:00» → none.

**LST-WINTER-07** · lst-winter · should/heuristic · activity · keywords, activityTags · 2026+
- **Titel:** Winteraktivität ausserhalb Lagersport/Trekking
- **Meldung:** ««{activity}» enthält «{term}». Mit LS/T nicht erlaubt sind Skitouren, Gletscherüberquerungen und Aktivitäten, die LVS oder alpintechnische Fähigkeiten voraussetzen. Möglich nur als ergänzender Bewegungsblock mit passender J+S-Anerkennung (z. B. Skitouren).»
- **Prüfung:** WINTER_FORBIDDEN hit. Tag `ebb-a` → hint.
- **Quellen:** [MB-UP S.4, S.6].
- **Tests:** + «Skitour Pizol» → should; − «Schneeschuhtrail» → none.

**LST-WINTER-08** · lst-winter · hint/best-practice · activity · keywords, coachInputs, midata, params · 2026+
- **Titel:** Grosse Schneeschuhgruppe
- **Meldung:** «Bei «{activity}» mit {participants} Teilnehmenden sind {responsible} Leitende verantwortlich. Gruppen über {max} in Untergruppen mit je einer Leitungsperson aufteilen.»
- **Prüfung:** SNOWSHOE hit and `responsibleIris.length < ceil(participants / lst.snowGroupMax)` (12).
- **Quellen:** [WINTER S.16].
- **Tests:** + 30 TN with 2 leaders → hint; − 3 leaders → none.

### 5.8 Module `lst-ebb`

**LST-EBB-01** · lst-ebb · should/heuristic · activity · keywords, activityTags · 2026+
- **Titel:** Ergänzender Bewegungsblock nicht gekennzeichnet
- **Meldung:** ««{activity}» ist vermutlich ein EBB {kind} («{term}»). EBB sind im Grobprogramm klar zu kennzeichnen – inkl. J+S-Sportart (EBB A) bzw. Anbieter (EBB B).»
- **Variant `incomplete`:** ««{activity}» ist als EBB gekennzeichnet, nennt aber {missing}.»
- **Prüfung:**
  - Applies to activities tagged `ebb-*`, or with an EBB_A/EBB_B hit and not tagged `kein-ebb`.
  - The title must contain `ebb`.
  - It must also contain a sport term (EBB A, any EBB_A term) or a provider hint: a capitalised word or quoted name next to EBB_B, or EBB_B_PROVIDER.
- **Quellen:** [EBB-L S.1, S.2] (examples «EBB ‹J+S-Skifahren› – LS Pistenmorgen»).
- **Tests:**
  - + «Seilpark» untitled → should.
  - + «EBB Seilpark» without provider → should `incomplete`.
  - − «EBB ‹Firma Musterseil› – Seilpark» → none.

**LST-EBB-02** · lst-ebb · should/heuristic · activity · keywords, activityTags · 2026+
- **Titel:** EBB ohne Sicherheitsüberlegungen
- **Meldung:** «Für den EBB «{activity}» fehlen dokumentierte Sicherheitsüberlegungen{detail}. Die Gesamtverantwortung bleibt bei den J+S-Leitenden.»
- **Prüfung:**
  - **EBB A:** the safety text is empty.
  - **EBB B:** the safety text is empty, or lacks one of EBB_INSTR, EBB_BEGLEIT, EBB_ANBIETER, EBB_FAEHIGKEIT, EBB_WOHL. The missing groups go into `{detail}`.
- **Quellen:** [EBB-C S.2; EBB-L S.2]; [MB-UP S.6] «behalten die Aufsicht und Gesamtverantwortung …; Anbieter … qualifiziert; … Sicherheitsinstruktion»; [WEB-SICH «kommerzielle Anbieter»].
- **Tests:** + EBB B without Instruktion → should; − all five groups → none.

**LST-EBB-03** · lst-ebb · hint/heuristic · activity · keywords, activityTags · 2026+
- **Titel:** EBB A: Leitung mit Anerkennung der Sportart
- **Meldung:** ««{activity}» ist ein EBB A ({sport}). Leitung nur durch eine Person mit J+S-Anerkennung dieser Sportart oder einer für die Aktivität entsprechenden Ausbildung, unter Einhaltung der sportartspezifischen Sicherheitsbestimmungen. Ein LS/T-Coach kann die Aktivität nicht prüfen.»
- **Prüfung:** Tag `ebb-a` or an EBB_A hit. co-co has no sport recognition data, so the rule always fires; the coach dismisses it by override.
- **Quellen:** [MB-UP S.6]; [EBB-C S.2]; [EBB-L S.2]; [WEB-L «Aktivitäten im J+S-Lager»].
- **Tests:** + «EBB ‹J+S-Skifahren› Pistenmorgen» → hint; − «Geländespiel» → none.

**LST-EBB-04** · lst-ebb · should/verified · activity · activityTags · 2026+
- **Titel:** EBB ohne begleitende Leitungsperson
- **Meldung:** «Für den EBB «{activity}» ist keine verantwortliche Leitungsperson eingetragen. EBB mit externen Personen oder Anbietern müssen von einer J+S-Leitungsperson begleitet werden.»
- **Prüfung:** Tagged `ebb-a` or `ebb-b`, and `responsibleIris` is empty.
- **Quellen:** [WEB-L «Aktivitäten im J+S-Lager»] «müssen diese Aktivitäten von einer J+S-Leiterperson begleitet werden»; [MB-UP S.6].
- **Tests:** + tagged with no responsible → should; − one responsible → none.

### 5.9 Module `pbs`

**PBS-METH-01** · pbs · hint/unverified · camp · keywords, activityTags · 2026+
- **Titel:** Pfadimethoden und Beziehungen
- **Meldung:** «Für folgende Pfadi-Methoden/Beziehungen ist kein Programmpunkt erkennbar: {list}.»
- **Prüfung:** Keyword mapping PBS_METHODS / PBS_RELATIONS. The list is provisional until the Pfadiprofil is obtained (§11 Q15).
- **Quellen:** [PBS27 slides 3, 5, 7].
- **Tests:** + no «Natur» term → hint; − all present → none.

### 5.10 Draft id → final id

| Draft id | Final id |
|---|---|
| LST-BERG-01 | LST-BERG-01 |
| LST-BERG-02 | LST-BERG-02 |
| LST-BERG-03 | LST-SB-03 |
| LST-BERG-04 | LST-TREK-09 |
| LST-BERG-05 | LST-BERG-03 |
| LST-BERG-06 | LST-BERG-04 |
| LST-WASSER-02 | JS-EXCL-01 (variant `ww`) + LST-SB-01 |
| LST-WASSER-03 | LST-WASSER-02 |
| LST-WASSER-04 | LST-WASSER-03 |
| LST-WASSER-05 | LST-WASSER-04 (new semantics; the 1:12 ratio is dropped) |
| LST-WASSER-06…10 | LST-WASSER-05…09 |
| (new) | LST-WASSER-10 |
| LST-WINTER-01 | LST-SB-01/02/03 + LST-WINTER-01 (new semantics) |
| new | LST-WINTER-07, LST-WINTER-08 |
| LST-SAFE-01 | dropped (covered by CMP-ACT-03) |

---

## 6. Keyword sets (final)

Syntax (§3.5):
- plain = stem
- `=` exact (+ endings)
- `^` prefix
- `$` suffix
- `"…"` phrase
- `regex:` regular expression
- `!` exclude

Umlaut spelling only (folding is automatic). Sets marked *(fix)* contain corrections relative to the draft. The Exclude column lists exclusions without the `!` prefix (the column itself means «exclude»). *(extends X)* means the set's `extends: [X]` (X's include and exclude entries are merged in). Every set named by any rule is listed here with its full content; the loader rejects a rule whose `keywords` name a missing set.

| Set | Module | Include | Exclude |
|---|---|---|---|
| WATER | lst-wasser | `=baden, badi, schwimm, =see, $see, fluss, =bach, $bach, =aare, =reuss, =rhein, =limmat, =emme, kanu, kanadier, kajak, kayak, =boot, $boot, wasser, rafting, =raft, tauchen, weiher, =teich, strand, ruder, floss, flösse, ^schlauchboot, =sup, "stand up paddle", ^seeüberquer, ^streckenschwimm, ^flussschwimm, ^bachtrekking, ^wasserspiel, ^staudamm, ^dämme, ^planschen, =freibad, =hallenbad, =strandbad, =seebad` | `trinkwasser, wasserflasche, wasserkanister, wasserhahn, wasserstelle, abwasser, seeland, seepferdchen, seele, suppe` *(fix: exclude `suppe`)* |
| POOL | lst-wasser | `hallenbad, freibad, erlebnisbad, badi, schwimmbad, seebad, strandbad, flussbad` *(fix: supervised baths per MB-UP S.5 «Hallenbad/Freibad/Seebad/Flussbad»)* | – |
| SWIM | lst-wasser | `=baden, $baden, schwimm` *(new)* | `"füsse baden"` |
| UNSUPERVISED | lst-wasser | `unbeaufsichtigt, "ohne badeaufsicht", "ohne bademeister"` *(new)* | – |
| RIVER | lst-wasser | `fluss, =bach, =aare, =reuss, =rhein, =limmat, =emme, ^flussfahrt, fliessgewässer` | `flussdiagramm, flussbad` *(fix: `flussbad` is a supervised bath → POOL)* |
| LAKE | lst-wasser | `=see, $see, weiher` | `trinkwasser, wasserflasche, wasserkanister, wasserhahn, wasserstelle, abwasser, seeland, seepferdchen, seele, seebad, strandbad` *(fix: full list; supervised baths → POOL)* |
| FLOSS | lst-wasser | `=floss, flösse, ^flossbau, ^flossfahrt` | – |
| BOAT | lst-wasser | `kanu, kanadier, kajak, =boot, $boot, =raft, rafting, =sup, ^schlauchboot` | `kursschiff` |
| GORGE | lst-wasser | `schlucht` *(new; never an exclusion trigger, see JS-EXCL-01)* | – |
| BACHTREKKING | lst-wasser | `^bachtrekking, ^flusstrekking, ^bachwanderung` *(extends GORGE)* | – |
| SB_WASSER_EXTRA | lst | `^flussschwimm, ^flusssurf` *(new; moved out of the LST-SB-01 predicate)* | – |
| CLOSED_BOAT | lst-wasser | `spritzdecke, spritzwasserdecke, eskimorolle, wildwasserkajak, "geschlossenes kajak"` | – |
| DIVING | lst-wasser | `gerätetauchen, ^sporttauchen, ^scuba, ^tauchflasche` | `schnorchel` |
| LAKE_SWIM | lst-wasser | `^seeüberquer, ^seequerung, ^streckenschwimm, "über den see"` | – |
| AM_WATER | lst-wasser | `"füsse baden", ^wasserrad, ^staudamm, ^dämme bauen, ^steine sammeln` | – |
| JUMP | lst-wasser | `=springen, sprung, ^klippensprung, ^brückensprung` | `sprungturm` |
| ROPE_IN_WATER | lst-wasser | `anseil, angeseilt, seilsicherung, abseil, "boote verbinden", zusammengebunden` | – |
| WW_HIGH | js | `regex: \b(ww|wildwasser)\s*(iii|iv|v|vi|[3-6])\b` | – |
| MOUNTAIN | lst-berg | `wanderung, wandern, hike, hiking, berg, gipfel, =grat, =pass, ^passübergang, biwak, bivouac, kletter, trekking, höhenmeter, ^alpwanderung, =sac, =hütte, ^berghütte, ^alp, aufstieg, abstieg, ^schrofen, ^geröll, ^schneefeld` | `bergfest, kletterhalle` *(fix: `=ski`, `^skitour`, `^skifahr`, `^skilager` moved to EBB_A / WINTER_FORBIDDEN; `kletterhalle` → EBB_A)* |
| ALPINE | lst-berg | `alpinwander, "weiss blau weiss", gletscher, firn, klettersteig, "via ferrata", steigeisen, =pickel, anseilen, angeseilt, klettergurt, anseilgurt, hochtour, regex: \bt\s?[4-6]\b` | – |
| T3 | lst-berg | `regex: \bt\s?3\b` | – |
| TREELINE | lst | `"oberhalb der waldgrenze", "über der waldgrenze"` *(new; the treeline phrase lives only here)* | – |
| ANSPRUCHSVOLL | lst | `anspruchsvoll, schlüsselstelle, ausgesetzt, mehrtägig` *(extends TREELINE)* | – |
| UNTERNEHMUNG | lst | `wanderung, wandern, ^wanderlager, hike, hajk, haik, ^velotour, ^radtour, ^fahrradtour, schnitzeljagd, ^flusswanderung, ^bachtrekking, ^schneeschuhtour, ^schneeschuhwanderung, ausflug, ^tagesausflug, unternehmung, trekking, ^zelttrekking, ^sternwanderung, "unterwegs sein", ^etappe, ^pilger` | `wanderweg` *(fix: `postenlauf` removed – usually on site)* |
| HIKE | lst-trekking | `wanderung, wandern, hike, hajk, haik, ^bergwanderung, ^tageswanderung, =marsch, ^nachtwanderung, ^bachtrekking, ^schneeschuh` | `wanderweg` |
| BIKE | lst-trekking | `velo, fahrrad, ^radtour, =bike, biken, ^trotti` *(extends BIKE_INLINE)* | `veloständer, velokeller` |
| BIKE_INLINE | lst-trekking | `inline, skates, ^inlineskat, rollschuh` *(new; moved out of the LST-TREK-08 predicate)* | – |
| BIWAK | lst-trekking | `biwak, bivouac, ^blachenzelt, "übernachtung draussen", ^zelttrekking, "unter freiem himmel"` | *(fix: `^iglunacht` moved to IGLU)* |
| IGLU | lst-winter | `iglu, ^iglunacht, ^schneehöhle, quinzhee` | – |
| WINTER | lst-winter | `schnee, ^schneeschuh, iglu, ^schneehöhle, quinzhee, ^schneebiwak, ^winterwander, schlitteln, schlitten, =bob, airboard, lawine, ^schneeburg, ^schneeskulptur, ^schneeball, ^wintercamp, ^winterlager` | – |
| SNOWSHOE | lst-winter | `^schneeschuh, ^winterwander` | – |
| WINTERHIKE | lst-winter | `^winterwander, "wanderung im schnee"` | – |
| SLED | lst-winter | `schlitteln, schlitten, =bob, airboard, ^schlittelpiste, ^schlittelweg` | – |
| WINTER_SECURED | lst-winter | `winterwanderweg, schneeschuhtrail, skigebiet, ^schlittelweg, "gesicherter bereich", "im dorf"` | – |
| WINTER_FORBIDDEN | lst-winter | `skitour, =lvs, lawinenverschütteten, gletscher, ^gletscherüberquer` | – |
| ROPE | lst-lager | `seil, pionier, abseil, hochseil, "flying fox", flyingfox, ^seilbrücke, ^seilbahn, ^pionierbau, =knoten` | `seilziehen, seilspringen, seilspiel, seilpark` |
| FIRE | lst-lager | `=feuer, ^feuerstelle, ^lagerfeuer, bräteln, ^grill, "kochen über", ^feuerschale, =glut, "feuer machen", "feuer entfachen"` | `feuerwehr, feuerwerk` |
| FIRE_SAFETY | lst-lager | `waldbrand, feuerverbot, feuerstelle, feuerschale, löschwasser, löschen, =kübel` | – |
| NIGHT | lst-lager | `^nacht` | `nachtessen, nachtisch, nachtrag, nachtmahl, nachtruhe` |
| OUTDOOR | lst | `draussen, outdoor, wald, wiese, gelände, geländespiel, wanderung, wandern, hike, berg, gipfel, biwak, trekking, ausflug, =feuer, ^feuerstelle, orientierungslauf, postenlauf, schnitzeljagd, rakete, bräteln, zeltplatz, lagerplatz, spielplatz, hajk, abseil, seilbahn, pionier, kanu, baden, schwimm, velo, radtour, schnee, ^schneeschuh, schlitteln` (today's list from `predicates/util.ts` minus the folded duplicates `gelaende`, `braeteln`, `=hajk`, plus the three winter terms) | – (today has none) |
| EBB_A | lst-ebb | Schneesport: `=ski, ^skifahr, ^skitag, ^pistenmorgen, =piste, snowboard, biathlon, ^skispring` · Bergsport: `sportklettern, kletterhalle, =boulder, ^bergsteig, hochtour, skitour` · Wasser: `^kanusport, ^kanutraining, ^kanukurs, eskimorolle, rettungsschwimm, ^schwimmtraining, ^schwimmkurs, ^schwimmunterricht, ^rudertraining, ^ruderkurs, segeln, ^segelkurs, windsurf, wasserball, wasserspring, ^wasserfahren, pontonier, triathlon, ^synchronschwimm, "artistic swimming"` · Pferd: `=reiten, ^reitstunde, ^ausritt, voltige` · Schiessen: `armbrust, ^bogenschiess, luftgewehr, =gewehr, =pistole, sportschiess, ^schiessstand` | `"skilift spiel"` *(fix: `reiten` was a stem and matched «vorbereiten»; `pferd` and `rudern` removed – boat rowing in LS/T stays WATER; `=pistole` excludes «Wasserpistole»)* |
| EBB_B | lst-ebb | `seilpark, hochseilgarten, kletterpark, ^sommerrodel, rodelbahn, "trottinett abfahrt", trottiabfahrt, "river rafting", rafting, ^lasertag, ^trampolinhalle` | *(fix: the draft's «^bowling?» entry is removed)* |
| EBB_B_PROVIDER | lst-ebb | `anbieter, firma, =ag, =gmbh, ^eintritt, gebucht` (booster only, never alone) | – |
| EXCLUDED | js | `canyoning, bungee, ^gleitschirm, paragliding, ^deltaseg, ^fallschirm, ^tandemflug, ^heissluftballon, motocross, "go kart", =kart, =quad, ^motorboot, jetski, =boxen, ^boxkampf, ^kickbox, ^thaibox, =mma, bruchtest` | `boxenstopp, kartenlesen, karte, kartoffel, schlucht` *(fix: `wildwasser iii` phrases replaced by WW_HIGH; `schlucht` explicitly never; `bruchtest` added per WEB-C «Verbotene Sportarten» «Bruchtests»)* |
| PASSIVE | lst | `=film, kino, ^filmabend, ^singen, ^singabend, ^liederabend, basteln, bastel, jass, ^brettspiel, ^gesellschaftsspiel, quiz, vortrag, ^vorlesen, ^gottesdienst, siesta, nachtruhe, ^znacht, ^zmittag, ^zmorge, ^znüni, ^zvieri, ämtli, abwasch, duschen, höck, packen, "knoten am tisch", ^museum` | – |
| MOVEMENT | lst | `spiel, =lauf, rennen, stafette, ^geländespiel, sport, turnier, tanz, bauen, ^lagerbau, wanderung, ^postenlauf, ^fangis, ^versteck` | – |
| SUBGROUP | lst | `"nur für", leiter, leitende, küchenteam, =pio, "wölfe only", ausgewählte, freiwillig` | `"für alle"` |
| MEAL | js | `^zmorge, ^frühstück, ^zmittag, ^mittagessen, ^znacht, ^abendessen, ^znüni, ^zvieri, ^brunch, ^essen, ^mahlzeit` | – |
| WARMUP | lst | `einstimm, aufwärm, "warm up", warmup, einlauf, einspiel, ankommen, einleitung, einstieg, ^aufwärmspiel, mobilisation, "warm machen"` | – |
| SCHLECHTWETTER | lst-lager | `schlechtwetter, "schlechtes wetter", regenprogramm, regenvariante, "bei regen", "bei schlechtem wetter", regenwetter, "plan b", "sw variante", schlechtwettervariante, regenalternative, "indoor variante", ausweichprogramm, "bei nässe", "falls es regnet", "variante bei regen"` | – |
| HOECK | lst-lager | `höck, leiterhöck, tagesrückblick, leitersitzung` | – |
| DAY1_INFO | lst-lager | `lagerregeln, =regeln, lagerpakt, sicherheit, notfall, begrüssung` | – |
| BUILD | lst-lager | `aufbau, abbau, lagerbau` | – |
| RULES_SICHERHEIT / RULES_SUCHT / RULES_ZUSAMMEN / RULES_ELEKTRONIK / RULES_UMWELT | lst-lager | `sicherheit, feuer, "gelände verlassen"` / `alkohol, tabak, rauch, drogen, sucht` / `respekt, zusammen` / `handy, natel, smartphone, elektronisch` / `abfall, umwelt, natur` | – |
| ROUTE_DOC / ALT_ROUTE / MARSCHZEIT | lst-trekking | `route, karte, kartenausschnitt` / `alternativroute, "alternative route", ausweichroute, variante` / `marschzeit, zeitberechnung, marschtabelle, =lkm, leistungskilometer` | – |
| UMKEHR | lst-trekking | `umkehr, umkehrzeit, umkehrpunkt, abbruch, ausstieg, ausweich, "spätestens um"` | – |
| RECO | lst-trekking | `reko, rekognos, erkundet` | – |
| KIT_APOTHEKE / KIT_RETTUNGSDECKE / KIT_ALARM / KIT_WAERME | lst-trekking | `apotheke, "erste hilfe", sanität` / `rettungsdecke, rettungsfolie, biwaksack` / `handy, natel, telefon, funk, mobiltelefon` / `rettungsfolie, rettungsdecke, wärmekissen` | – |
| BIKE_HELM / BIKE_INSTR / BIKE_PROTECT | lst-trekking | `helm` / `instruktion, instruiert, fahrtechnik, bremstechnik, velocheck, fahrtest, veloparcours` / `schoner, schutzausrüstung, handgelenk` | – |
| GEWITTER / SNOW_FOG | lst-berg | `gewitter` / `schnee, nebel` | – |
| FLOSS_OK / ESCORT / VEST | lst-wasser | `bewilligung, schifffahrtsamt, "2 5", uferzone` / `begleitboot, =boot, rettungsbrett, =sup` / `schwimmweste, rettungsweste, =weste` | – |
| WETTER / AUSSTIEG / KRAFTWERK | lst-wasser | `wetter, meteo, gewitter` / `ausstieg, abbruch` / `kraftwerk, schwall, wasserstand` | – |
| WR_HANG / WR_LAWINE / WR_HOEHE / WR_3X3 / WR_DEFENSIV | lst-winter | `hang, neigung, "30 grad", "30 °"` / `lawinenbulletin, lawine, =slf, gefahrenstufe` / `1800, höhe` / `"3 3", 3x3, "drei mal drei"` / `defensiv, ausweich, variante, "plan b"` | – |
| SLED_HELM / SLED_TEST / SLED_ZONE / SLED_AUFSICHT | lst-winter | `helm` / `test, getestet, abgefahren` / `sicherheitszone, auslauf` / `aufsicht, posten, =start` | – |
| RUECKMELD | lst-winter | `rückmeld, vertrauensperson, kontaktperson, zeitplan, zurückmelden` | – |
| EBB_INSTR / EBB_BEGLEIT / EBB_ANBIETER / EBB_FAEHIGKEIT / EBB_WOHL | lst-ebb | `instruktion, einführung, briefing` / `begleit, betreu, aufsicht` / `anbieter, geprüft, seriös, qualifiziert, anerkennung` / `fähigkeit, =gruppe, niveau` / `wohlergehen, wohlbefinden, verzicht, abbruch` | – |
| EF1 (Outdoor-/Lagerbautechniken) | lst | `biwak, iglu, seil, knoten, ^seilbrücke, ^seilbahn, abseil, ^lagerbau, ^aufbau, ^abbau, pionier, ^feuer, ^werkzeug, morsen, ^übermittlung, "erste hilfe", ^unfallorganisation, ^alarmierung, zelt, blache, sarasani` *(fix: phrase `"erste hilfe"`)* | – |
| EF2 (Sicher unterwegs) | lst | `wanderung, ^velotour, ^fahrradtour, schatzsuche, bachtrekking, orientierungslauf, "ol lauf", kompass, karte, ^kartenlesen, gps, ^höhenmesser, kroki, ^krokier, route, ^streckenplanung, "rucksack packen", unternehmung, ^risikobeurteilung` *(fix: `=ol` → `orientierungslauf` + `"ol lauf"`; `"rucksack packen"` phrase)* | – |
| EF3 (Spiel und Sport) | lst | `geländespiel, ^spielturnier, turnier, olympiade, stafette, ^sportblock, volleyball, alaskaball, ^hindernisparcours, ^fangis, ^ballspiel, "spiele entwickeln"` *(fix: phrase)* | – |
| EF4 (Bedürfnisse/Ideen) | lst | `sinnesparcours, achtsamkeit, ^prävention, ^grenzen, ^gesundheit, ^mitbestimmung, atelier, ^wunschprogramm, ^lagerparlament, theater` | – |
| EF5 (Gemeinschaft) | lst | `^gruppenchallenge, ^kommunikationsspiel, kooperation, ^lagerregeln, fairplay, "fair play", inklusion, diversität, toleranz, ^teamspiel, ^vertrauensspiel` *(fix: `"fair-play"` → `"fair play"`, hyphens are normalised to spaces)* | – |
| EF6 (Natur/Umwelt) | lst | `upcycling, recycling, ^waldexkursion, flora, fauna, ^wetterkunde, ^sternkunde, sterne, ^nachhaltig, insekten, ^kleinstruktur, ^aufräumaktion, "clean walk", naturschutz, ^tierspuren, ^pflanzen` | – |
| PBS_METHODS | pbs | **Provisional** (Pfadiprofil not obtained, §11 Q15; PBS-METH-01 is hint/unverified). One group per method, each group is a sub-list matched on its own: Persönlicher Fortschritt `fortschritt, "persönliches ziel", ^etappe` / Gesetz und Versprechen `pfadigesetz, versprechen, ^taufe` / Leben in der Gruppe `^gruppenleben, =fähnli, =rudel, =meute, gruppenarbeit` / Rituale und Traditionen `ritual, tradition, ^lagerfeuer, =taufe, ^abendrunde` / Mitbestimmen und Verantwortung tragen `mitbestimm, ^lagerparlament, ^ämtliplan, verantwortung, abstimm` / Draussen leben `draussen, ^biwak, =wald, ^lagerbau, natur` / Spielen `=spiel, ^geländespiel, spielen, ^nachtspiel`. **Only seven methods are listed;** the eighth method of the current Pfadiprofil is not in any source we hold and is added when §11 Q15 is resolved. Until then PBS-METH-01 checks these seven only. | – |
| PBS_RELATIONS | pbs | **Provisional** (same caveat). One group per relationship: Persönlichkeit `persönlichkeit, ^selbst, reflexion, ^stärken` / Mitmenschen `gemeinschaft, ^zusammenarbeit, kooperation, ^hilfsbereit` / Umwelt `umwelt, natur, ^nachhaltig, naturschutz` / Spiritualität `spirituell, besinnung, ^stille, ^sinnfrage, ^gottesdienst` / Körper `körper, sport, bewegung, gesundheit, ernährung` | – |
| docCheck (`docCheck.yaml`) | lst-lager | Moved verbatim from `documents/index.ts`:<br>`EMERGENCY_NUMBERS`: `144, 1414, 117, 118, 145, 112` (`112` new).<br>`PATTERNS` (case-insensitive regex): `hospital` `(spital\|klinik\|notfallstation\|notfallpraxis\|hospital)`; `crisisContact` `(krisen\|helpline\|krisenkontakt\|krisenteam\|pfadi[- ]?notruf\|ansprechperson)`; `evacuation` `(evakuier\|evakuation\|notunterkunft\|sammelplatz\|sammelstelle\|notquartier\|schlechtwetterunterkunft)`; `badWeather` `(schlechtwetter\|gewitter\|unwetter\|regenprogramm\|wetterumschlag\|wettervariante)`; `threeByThree` `(3\s*[x×*]\s*3\|drei\s*mal\s*drei\|3\s*mal\s*3\|3-mal-3\|dreimal\s*3)`; `firstAid` `(apotheke\|erste[- ]hilfe\|sanität\|first[- ]aid)`.<br>`COORD_RE` (`campAddress`): WGS84 pair `\b4[5-8]\.\d{3,}\s*[,;/ ]\s*[5-9]\.\d{3,}`, LV95 pair `\b2[5-8]\d{2}['’ ]?\d{3}\s*[,/ ]\s*1[0-3]\d{2}['’ ]?\d{3}`, or `koordinaten\|lagerplatz\|lagerort\|lageradresse\|adresse`.<br>`SAFETY_CHECK_LABELS`: emergencyNumbers «Notrufnummern», hospital «Spital», crisisContact «Krisenkontakt», evacuation «Evakuation/Notunterkunft», badWeather «Schlechtwetterplan», threeByThree «3x3», firstAid «Notfallapotheke», campAddress «Lageradresse/Koordinaten». | – |

---

## 7. Params (`params.yaml`, defaults and sources)

**Value rows.** Every key has value rows that cover every camp start date from 2026-01-01 onward without gaps (§3.4: a key with no matching row is a loader error). A single value in the table means one row `{ value, validFrom: 2026-01-01 }` with no `validTo`. Year-dependent values list each row; `null` marks a criterion that is inactive in that period. Combined keys (`a / b`) are separate params with the values in the same order.

| Key | Default (validity) | Unit | Overridable | Source |
|---|---|---|---|---|
| js.consecutiveMode | calendar (2026); jsDaysSkipping (2027+) | enum | none | LEITFADEN «Lagerdauer»; TOOL-V; maintainer decision |
| js.minConsecutiveDays | 4 | days | none | LEITFADEN; TOOL-V |
| js.minConsecutiveDaysWithOfferPartner | 3 | days | none | LEITFADEN (Art. 14 Abs. 6); TOOL-V |
| js.minParticipants | 12 | persons | none | LEITFADEN; WEB-L; PBS27 s9 |
| js.ageMin / js.ageMax | 5 / 20 (Jahrgang) | years | none | WEB-C «J+S-Alter» |
| js.minLeaders | 2 | persons | none | LEITFADEN «Lagerleitung» |
| js.subsidyGroupSizePerLeader | 16 | persons | admin | PBS27 s9; WEB-GR (unverified) |
| js.minUnitMinutes | 30 | min | none | LEITFADEN; MAN S.21 |
| js.minGapMinutes | 30 | min | none | LEITFADEN; WEB-L |
| js.minDayMinutes | 240 | min | none | LEITFADEN; TOOL-V |
| js.minDayUnits | 2 | units | none | LEITFADEN; WEB-L |
| js.minBwzDayMinutes | null (2026); 120 (2027+) | min | none | MAN S.21; TOOL-V; PBS27 s6 |
| js.minBwzActivityMinutes | null (2026); 30 (2027+) | min | none | TOOL-V || js.bwzStepMinutes | null (2026-01-01 … 2026-12-31); 15 (2027-01-01+) | min | none | TOOL-V; MAN S.21 |
| js.timeWindows | Morgen 00:00–12:00, Nachmittag 12:00–18:00, Abend 18:00–24:00 | hh:mm | coach | none (undefined, §11 Q2) |
| js.timeWindowMinOverlap | 30 | min | coach | co-co interpretation |
| js.minTimeWindows | 2 | windows | none | LEITFADEN; TOOL-V |
| js.freeDaysFirstAt / js.freeDaysEveryFurther | 5 / 2 | days | none | LEITFADEN; WEB-L |
| js.ndsRegistrationLeadDays | 30 | days | none | WEB-C |
| js.ndsClosingDays | 30 | days | none | WEB-C |
| js.leihmaterialLeadDays | 35 | days | none | WEB-C; PBS27 s16 |
| js.landeskartenLeadDays / js.landeskartenLeadDaysSummer / js.landeskartenSummerMonths | 21 / 35 / [6,7,8] | days / months | none | WEB-C |
| js.deadlineSoonDays | 14 | days | admin | co-co |
| js.leihmaterialOutage | {outageStart 2026-12-11, outageEnd 2027-01-10, orderBy 2026-11-04} (2026-01-01 … 2027-01-17); null (2027-01-18+) | dates | none | WEB-LU |
| js.publicHolidays | 1.1., Karfreitag, Ostermontag, Auffahrt, Pfingstmontag, 1.8., 25.12., 26.12. | dates/rules | admin | PBS27 s16 (holidays generic) |
| js.participantsDiffTolerance | 0.2 | ratio | admin | co-co |
| lst.sbMinAgeByYear | 10 | years (Jahrgang) | none | MB-UP S.2; WEB-C |
| lst.sbSafetyMinChars | 300 | chars | coach | co-co |
| lst.hikeSafetyMinChars | 150 | chars | coach | co-co |
| lst.ropeMinSafetyChars | 200 | chars | coach | co-co |
| lst.treelineM | 2000 | m | coach | co-co heuristic |
| lst.bergSuggestAltitude | 1000 | m | admin | co-co |
| lst.winterMonths | [11,12,1,2,3,4] | months | coach | co-co |
| lst.winterMaxAltitude | 1800 | m | none | MB-UP S.4 |
| lst.snowshoeSbMinutes | 180 | min | coach | co-co heuristic |
| lst.snowGroupMax | 12 | persons | coach | WINTER S.16 |
| lst.paceLkmPerHour / lst.paceKidsLkmPerHour | 4 / 3 | Lkm/h | coach (`settings.gpx`) | BERG S.14 |
| lst.descentHmPerLkm | 150 | Hm | coach | BERG S.14 |
| lst.pauseMinutesPerHour | 10 | min | coach | BERG S.21 |
| lst.hikeKidsMaxMinutes | 180 | min | coach | BERG S.4 |
| lst.oldSnowHighAltitude / lst.oldSnowHighMonths | 2000 / [3,4,5,6] | m / months | coach | BERG S.6, 33 |
| lst.oldSnowLowAltitude / lst.oldSnowLowMonths | 1000 / [4,5,10,11] | m / months | coach | BERG S.6, 33 |
| lst.thunderstormMonths / lst.thunderstormEnd | [6,7,8,9] / 16:00 | months / hh:mm | coach | BERG S.6 |
| lst.sunsetTable | monthly CH values (46.8° N) | hh:mm | admin | WINTER S.20 |
| lst.nightEndTime / lst.minRestMinutes / lst.morningWindow | 22:00 / 510 / 05:00–14:00 | – | coach | LAGER S.22; H |
| lst.buildQuietWindow | 22:00–07:00 | hh:mm | coach | LAGER S.40 |
| lst.warmupHeadChars | 400 | chars | admin | co-co |
| lst.varMinUnits / lst.varMinDistinct | 4 / 2 | – | admin | MAN S.38 |
| pbs.sleepHours | biber 11, woelfe 10, pfadi 9, pios 8.5, rover 8, gemischt 9 | h | coach | H |
| pbs.wolfParticipantsPerLeader | 6 | persons | coach | H |
| pbs.slrgParticipantsPerPerson | 12 | persons | coach | H |
| pbs.restGapMinutes / pbs.restWindow | 60 / 07:00–22:00 | – | coach | H |
| pbs.progressLeadDays | 21 | days | coach | H |

---

## 8. Coach checklist (`checklist.yaml`)

Items are shown per camp in the card «Coach-Checkliste». Done-state is stored in `campRuleConfig.checklist` and feeds the report.
- **B** = binding source; **E** = recommendation; **2014** = outdated source, item kept as unverified. These three are the only kinds. Items from `didactic` sources (WASSER, WINTER) and `info` sources (GST) are recorded as **E**. A combined cell such as «2014 / B» means the item is backed by both kinds of source.
- `showWhen` uses the same keys as `appliesWhen` plus `campConfig` fields.

| id | Module | Text (de) | Source | Kind | showWhen |
|---|---|---|---|---|---|
| CL-JS-01 | js | Organisation ist beim BASPO für J+S-Lager registriert. | WEB-LT | B | – |
| CL-JS-02 | js | Angebot fasst höchstens ein Jahr zusammen; Lager im richtigen Angebot erfasst. | LEITFADEN «Definition J+S-Angebot» | B | – |
| CL-JS-03 | js | Teilnehmende bzw. Eltern und Kader über Datenerfassung in der NDS informiert und einverstanden. | WEB-C «Datenschutz» | B | – |
| CL-JS-04 | js | Teilnehmende, Eltern und Kader über Risiken und den Zweck einer Unfall-/Haftpflichtversicherung informiert. | WEB-C «Organisatoren» (Art. 11 SpoFöV) | B | – |
| CL-JS-05 | js | Rega-Gönnerschaft: Interessierte vor dem Lager in der NDS angemeldet. | WEB-C «Rega» | E | – |
| CL-JS-06 | js | AWK wird während des Lagers zeitnah und wahrheitsgetreu erfasst (Mobile NDS). | WEB-C «3. Schritt» | B | – |
| CL-JS-07 | js | J+S-Dokumentation (AWK, Programm) wird mindestens 5 Jahre aufbewahrt. | WEB-C (Art. 34 VSpoFöP); MAN S.17 | B | – |
| CL-JS-08 | js | Leihmaterial: bei Erhalt prüfen, Mängel innert 1 Arbeitstag melden; Lieferort für Lastwagen (2,90 m breit, 4,00 m hoch, 26 t) zugänglich, fester Untergrund; Kontaktperson am Liefertag erreichbar; sauber zurückgeben. | WEB-C «Leihmaterial»; PBS27 s16; MAN S.17 | B | coachInputs.leihmaterialOrdered === true, or leihmaterialDeliveryDate set |
| CL-JS-09 | js | Lager im Ausland: Organisator führt J+S-Kurse/-Lager zur Hauptsache in der Schweiz durch. | WEB-C «3. Schritt»; LEITFADEN «Durchführungsort» | B | campConfig.abroad |
| CL-JS-10 | js | Ethik-Charta eingehalten; kein Tabak und Alkohol während des Sports. | MAN S.9, 16 | B | – |
| CL-LST-01 | lst | Programm mit dem J+S-Coach besprochen. | MB-UP S.1 | B | – |
| CL-LST-02 | lst | Alle Aktivitäten «sinnvoll aufgebaut» und «auf die Bedürfnisse der Teilnehmenden abgestimmt». | MAN S.21; TOOL-V; PBS27 s7 | B | – |
| CL-LST-03 | lst | Entscheidungshilfe für Aktivitäten mit erhöhten Sicherheitsanforderungen angewendet (ausgeschlossen? Ausbildung erfüllt? Risiken minimierbar?); Alternativen erneut geprüft. | WEB-SICH «Entscheidungshilfe» | B | – |
| CL-LST-04 | lst | Sicherheitsbereich: J+S-Expert*in LS/T mit Zusatz beurteilt und bewilligt (Bewilligungen in co-co erfasst). | WEB-C «1. Schritt»; MB-UP S.2 | B | activity tag sb-*, or (winterSafeAccess=false and camp overlaps `lst.winterMonths`) |
| CL-LST-05 | lst | Gruppengrösse und nötige fachkompetente Hilfspersonen pro Aktivität bewusst festgelegt. | MB-UP S.1 | B | – |
| CL-LST-06 | lst | Lagerleitung und Coach kennen alle Detailprogramme. | LAGER S.21 | 2014 | – |
| CL-LAGER-01 | lst-lager | Ganzes Leitungsteam kennt das Krisenkonzept des Vereins vor dem Lager. | LAGER S.39 | 2014 | – |
| CL-LAGER-02 | lst-lager | TN-Infoblatt von allen Teilnehmenden **und** Leitenden ausgefüllt; vertraulich behandelt und nach dem Lager vernichtet. | LAGER S.27 | 2014 | – |
| CL-LAGER-03 | lst-lager | J+S-Notfallblatt vor dem Lager ausgefüllt und dem Team abgegeben. | LAGER S.7, 31, 39 | 2014 | – |
| CL-LAGER-04 | lst-lager | Sanitätsverantwortliche Person bestimmt; nur sie gibt Medikamente ab; verordnete Medikamente nicht abgesetzt. | LAGER S.7, 38 | 2014 | – |
| CL-LAGER-05 | lst-lager | Stellvertretung der Lagerleitung bestimmt. | LAGER S.6 | 2014 | – |
| CL-LAGER-06 | lst-lager | Lagerregeln decken die 5 Pflichtbereiche ab; Konsequenzen ohne bleibenden Schaden. | LAGER S.32–33; MB-UP S.1 | 2014 / B | – |
| CL-LAGER-07 | lst-lager | Gemischte Lager: getrennte Dusch- und Umkleidebereiche; mehrere Leitende anwesend; Untersuchungen im Intimbereich nur durch Fachpersonen. | LAGER S.33, 36 | 2014 | – |
| CL-LAGER-08 | lst-lager | Getränke jederzeit verfügbar; Trinkwasserqualität geprüft. | LAGER S.34–35 | 2014 | – |
| CL-LAGER-09 | lst-lager | Unfälle/Krankheiten mit Arztbesuch den Eltern gemeldet; Krisenteam informiert, wenn Rettungsdienste beteiligt sind. | LAGER S.38–39 | 2014 | – |
| CL-LAGER-10 | lst-lager | Zeltlager: Hochwasser-, Steinschlag-, Murgang- und Sturmgefahr mit Grundeigentümer besprochen; mit Vereinsleitung und Coach entschieden. | LAGER S.13 | 2014 | campConfig.campForm ∈ {zelt, gemischt} |
| CL-LAGER-11 | lst-lager | Schriftlicher Mietvertrag, von Erwachsenen unterzeichnet. | LAGER S.13 | 2014 | – |
| CL-LAGER-12 | lst-lager | Gemeinde des Aktivitätsorts kontaktiert; Feuer- und Waldbrandvorschriften geklärt. | MAN S.61 | E | – |
| CL-LAGER-13 | lst-lager | Notfallapotheke bei jeder Aktivität und in jeder Gruppe. | MB-UP S.1; LAGER S.37 | B | – |
| CL-TREK-01 | lst-trekking | Strassenverkehr: klare Organisationsform; verantwortliche Personen am Anfang und Ende der Gruppe bestimmt. | MB-UP S.2 | B | – |
| CL-TREK-02 | lst-trekking | PW/Kleinbus: Fahrberechtigung (Anzahl Sitzplätze) und Fähigkeiten der Fahrenden geprüft; alle angegurtet, Gepäck gesichert. | MB-UP S.2 | B | – |
| CL-TREK-03 | lst-trekking | Kinder bis 12 Jahre oder 150 cm (was zuerst eintrifft) im Auto mit Kindersitz – vorne und hinten. | MB-UP S.2 | B | – |
| CL-TREK-04 | lst-trekking | Anreise nach Möglichkeit mit öffentlichem Verkehr. | MB-UP S.2 | E | – |
| CL-TREK-05 | lst-trekking | Wanderungen mit Kartenausschnitt, Routenplanung inkl. Alternativen, Zeitberechnung und Sicherheitskonzept zusammen mit dem Lagerprogramm beim Coach eingereicht. | MB-UP S.3 | B | – |
| CL-TREK-06 | lst-trekking | Treffpunkte und Zeiten vereinbart, falls sich die Gruppe auseinanderzieht. | BERG S.17 | 2014 | – |
| CL-TREK-07 | lst-trekking | Kocher vor der Unternehmung geübt; nie im Zelt kochen; oberhalb der Waldgrenze Kocher statt Feuer. | BERG S.40 | 2014 | – |
| CL-TREK-08 | lst-trekking | Biwak ausserhalb eidg. Jagdbanngebiete, Schutzgebiete und Wildruhezonen. | BERG S.44; WINTER S.18; MAN S.61 | 2014 / E | – |
| CL-BERG-01 | lst-berg | Verantwortliche Leitungsperson hat Bergerfahrung für anspruchsvolle Wanderungen; für T3 Zusatz Berg oder Gruppenerfahrung. | MB-UP S.3; BERG S.7 | E | – |
| CL-BERG-02 | lst-berg | Biwak oberhalb der Waldgrenze nur mit Biwaksack und bei sicherem Schönwetter. | BERG S.42 | 2014 | – |
| CL-BERG-03 | lst-berg | Hüttenübernachtung: Selbstverpflegung mit Hüttenwart abgesprochen. | BERG S.44 | 2014 | – |
| CL-BERG-04 | lst-berg | Steinschlag- und Schneefeldregeln eingehalten; nicht reduzierbares Risiko → Aktivität nicht durchführen. | BERG S.31–32 | 2014 | – |
| CL-BERG-05 | lst-berg | Sicherheitskonzept anspruchsvoller Wanderungen im Team besprochen und allen Leitenden schriftlich abgegeben. | BERG S.16 | 2014 | – |
| CL-WASSER-01 | lst-wasser | Am oder entlang dem Wasser: Gruppe geht nur an geeigneten Stellen ins Wasser. | MB-UP S.5 | B | – |
| CL-WASSER-02 | lst-wasser | Aktivität, Betreuung und Ausrüstung an die Schwimmkompetenz der TN, das Gewässer und die Verhältnisse angepasst; Wissen der Leitenden zu Ertrinkungsprävention aktuell. | MB-UP S.5 | B | – |
| CL-WASSER-03 | lst-wasser | Rechtliche Vorschriften (Ausrüstung, Immatrikulation, Uferschutzzonen) und SLRG-Bade- und Flussregeln beachtet; kantonale Regeln und Schutzgebietstafeln beachtet. | MB-UP S.5; WASSER S.9 | E | – |
| CL-WASSER-04 | lst-wasser | Floss ab 2,50 m: Bewilligung des kantonalen Schifffahrtsamts. | WASSER S.23 | E | – |
| CL-WASSER-05 | lst-wasser | Gewässer unterhalb eines Kraftwerks: Betreiber informiert. | WASSER S.15 | E | – |
| CL-WASSER-06 | lst-wasser | Boots- und Flossbesatzung kann schwimmen; Wehre werden nie befahren, sondern umtragen. | WASSER S.20–21 | E | – |
| CL-WASSER-07 | lst-wasser | Meer: den Umständen entsprechende wasserspezifische Zusatzausbildung vorhanden; möglichst überwachte Strände; Flaggenzeichen beachtet. | MB-UP S.6 | B | campConfig.abroad |
| CL-WINTER-01 | lst-winter | Gruppen nur in Gelände, in dem keine Lawinen niedergehen können. | MB-UP S.4 | B | – |
| CL-WINTER-02 | lst-winter | Erhöhte Wintergefahren berücksichtigt (Kälte/Erfrieren, Nässe, Müdigkeit, Verkehr auf Schlittelwegen, Eisflächen, Schlittschuhkufen). | MB-UP S.4; WEB-SICH | B | – |
| CL-WINTER-03 | lst-winter | Winterbiwak (Zelt, Iglu) nur, wenn das Lagerhaus jederzeit, auch nachts und bei schlechtem Wetter, schnell und sicher erreichbar ist. | MB-UP S.4 | B | – |
| CL-WINTER-04 | lst-winter | Vor jeder Winterwanderung die Ja-Fragen beantwortet (Verantwortung, Erfahrung, Verhältnisse, Alternative). | WINTER S.14 | E | – |
| CL-EBB-01 | lst-ebb | Mit Lagerleitung geklärt, ob EBB geplant sind; Coach informiert. | EBB-C S.1; EBB-L S.1 | B | – |
| CL-EBB-02 | lst-ebb | EBB A: Vorgaben der Sportart (Leitfaden, Manual, Merkblatt Unfallprävention, Kontrollvorgaben) erfüllt; zusätzlicher Coach bzw. Expert*in der Sportart organisiert. | EBB-C S.2; EBB-L S.2; MB-UP S.6 | B | – |
| CL-EBB-03 | lst-ebb | EBB B: Anbieter seriös und qualifiziert (J+S-Anerkennung oder Ausbildung + professionelle Organisation), geprüft und dokumentiert; Sicherheitsinstruktion vor Beginn; Begehung bei Unsicherheit. | EBB-C S.2; MB-UP S.6 | B | – |
| CL-EBB-04 | lst-ebb | Bei Zweifeln wird der EBB nicht durchgeführt. | EBB-L S.2; MB-UP S.6 | B | – |
| CL-PBS-01 | pbs | Nothilfekurs vor den Modulen «Lager hauptleiten» und «Sicherheitsbereich» geplant (Ausbildungsplanung). | GST S.2 | E | – |

---

## 9. Deadline radar: milestones (`milestones.yaml`)

The existing 8 PBS milestones move to `packs/pbs/milestones.yaml` unchanged (unverified). The J+S milestones go to `packs/jslst/milestones.yaml`.

Format:
```yaml
- id: M-JS-ANMELDUNG
  title: "…"
  anchor: start          # start | end | delivery | date
  offsetDays: -30
  source: …
  confidence: …
  module: …
```

| id | Title (de) | Anchor / offset | Module | Confidence | Source |
|---|---|---|---|---|---|
| M-JS-ANMELDUNG | Angebot/Lager in der NDS angemeldet | start −30 | js | verified | WEB-C |
| M-JS-ABSCHLUSS | Angebot in der NDS abgeschlossen | (angebot.lastActivityDate ?? end) +30 | js | verified | WEB-C |
| M-JS-PROGRAMM-NDS | Definitives Lagerprogramm in der NDS hochgeladen | = M-JS-ABSCHLUSS | js | verified | WEB-L |
| M-JS-LEIHMATERIAL | Leihmaterial bestellt (ab Status «Bewilligt») | (delivery ?? start) −35 | js | verified | WEB-C; PBS27 s16 |
| M-JS-LANDESKARTEN | Landeskarten bestellt | (delivery ?? start) −21 / −35 (Jun–Aug) | js | verified | WEB-C |
| M-JS-LIEFERUNTERBRUCH | Bestellschluss Lieferunterbruch 2026/27 | date `js.leihmaterialOutage.orderBy` (2026-11-04); only when the param is not null and the camp's material window overlaps the outage (same check as JS-DL-06) | js | verified | WEB-LU |
| M-LST-SB-BEWILLIGUNG | Sicherheitsbereich: Expertenbewilligung eingeholt | first sb-* activity date −14 (recommended buffer) | lst | best-practice | WEB-C (deadline = «vor Durchführung») |
| M-LST-PROGRAMM-COACH | Lagerprogramm inkl. Wanderunterlagen beim Coach | start −42 | lst-trekking | unverified | MB-UP S.3 (no deadline given); LAGER S.23 (6–4 Wochen) |
| M-LST-GROBPROGRAMM | Grobprogramm an den Coach | start −120…−90 | lst | unverified | LAGER S.3 |
| M-LST-DETAILPROGRAMM | Detailprogramm an den Coach | start −84…−42 | lst | unverified | LAGER S.3 |
| M-LST-LAGERDOSSIER | Lagerdossier an den Coach | start −42…−28 | lst-lager | unverified | LAGER S.23 |
| M-LST-LAGERREGELN | Lagerregeln fertig | start −28…−14 | lst-lager | unverified | LAGER S.3 |
| M-LST-TN-LISTE | Definitive Teilnehmendenliste | start −28…−14 | js | unverified | LAGER S.3 |
| M-LST-ELTERNINFO | Detaillierte Elterninformation versandt | start −21 | lst-lager | unverified | LAGER S.28 |
| M-LST-JUGENDURLAUB | Jugendurlaub beantragt | start −60 | js | unverified | LAGER S.5 |
| M-LST-AWK-COACH | AWK und Teilnehmendenliste an den Coach | end +14 | js | unverified | LAGER S.4, 45 |
| M-LST-ABRECHNUNG | Lagerabrechnung | end +14 | lst-lager | unverified | LAGER S.45 |
| M-LST-AUSWERTUNG | Auswertung im Team | end +14…+42 | lst | unverified | LAGER S.45 |
| M-WINTER-LAWINENBULLETIN | Lawinenbulletin täglich lesen | start −7 … start | lst-winter | best-practice | WINTER S.13 |

---

## 10. Validity overview 2026 / 2027

| Item | Camps starting 2026 | Camps starting 2027+ | Source of change |
|---|---|---|---|
| JS-CAMP-01 counting | calendar days ≥ 4 (3 with offer partner) | J+S days ≥ 4 (3); non-J+S days skipped | TOOL-V; MAN S.21; maintainer decision |
| J+S day definition (`isJsDay`) | ≥ 240 min, ≥ 2 units | ≥ 240 min, ≥ 2 units, ≥ 120 min BWZ (activity values ≥ 30 count) | MAN S.21; TOOL-V; PBS27 s6 |
| Combined first/last day | ≥ 240 min combined | ≥ 240 min and ≥ 120 min BWZ combined (interpretation) | TOOL-V; §11 Q3 |
| JS-DAY-02, -03, -05 | active | active (no 2027 source revokes them) | LEITFADEN; §11 Q4 |
| JS-DAY-06 times of day | active (should) | active (should) | LEITFADEN; TOOL-V |
| JS-FREE-01 cap | active (should; hint/`conflict` in the A_text…A_table gap) | active, every hit capped at hint/`conflict` (variant `conflict2027`: TOOL-V 2027 allows days without J+S activities while the minimum J+S days are met) | LEITFADEN; TOOL-V; §11 Q1 |
| JS-BWZ-27, JS-BWZ-02 | inactive | active (JS-BWZ-02: `step` must, `under30`/`missing`/`tooLong` should) | MAN; TOOL-V |
| Camp-level SB Winter (LST-SB-02/03/04 variant `camp`, LST-WINTER-01) | only when the camp overlaps `lst.winterMonths` | same | MB-UP S.4 |
| LST-ACT-02, LST-ACT-05, LST-ANG-01, LST-ANG-02 | inactive | active | MAN; TOOL-V; PBS27 |
| CMP-LA-01 | active | retired (validTo 2026-12-31) | §11 Q7 |
| Target groups (Kinder/Jugendliche) | separate recognitions | merged 5–20, one recognition; MiData «LS/T Kinder» and «LS/T Jugendliche» → `leiterLsT` | PBS27 s9 |
| Zusatzanerkennungen Sicherheit | from 2026, 4-year renewal | same | WEB-ZA |
| JS-DL-06 Lieferunterbruch | camps whose material window overlaps 2026-12-11…2027-01-10 | camps starting up to 2027-01-17 (validTo); `js.leihmaterialOutage` is null from 2027-01-18 | WEB-LU |
| JS-STAFF-01 | retired | retired | – |
| All other rules | active | active | – |

Pack versioning:
- `coco-js-lst` and `coco-pbs` both start at `2026.2.0`.
- A future official change bumps the minor version and adds validity rows. Rules are not duplicated for this.

---

## 11. Remaining open questions

1. **Free days for even camp lengths.** The LEITFADEN text («nach jeweils zwei weiteren gültigen Lagertagen») and WEB-L (1 + floor((D−5)/2)) disagree with the LEITFADEN example table (6–7 days: 2, 8–9 days: 3). JS-FREE-01 marks the gap as conflict/hint. Ask J+S which reading is valid. Also ask whether TOOL-V 2027 («Es ist möglich, einen Tag ohne J+S-Aktivitäten zu planen, sofern die Mindestanzahl an J+S-Tagen eingehalten wird») replaces the cap from 2027. Until answered, JS-FREE-01 caps every 2027 hit at hint/`conflict` (variant `conflict2027`).
2. **Time-of-day boundaries** (Morgen/Nachmittag/Abend) are undefined everywhere. The defaults in `js.timeWindows` are a co-co choice. JS-DAY-06 stays at `should` until J+S defines the boundaries.
3. **Movement time on the combined first/last day (2027).** No source says whether the combined day needs ≥ 120 min BWZ. co-co requires it, documented as an interpretation.
4. **Sozialzeit (30 min) and the ≥ 2-units rule in 2027.** Both stand in the current LEITFADEN (07/2026) and on WEB-L (09/2026), so co-co keeps them active for 2027. Confirm that the 2027 LS/T model does not change Art. 14 VSpoFöP.
5. **The skip rule for days that fail the J+S-day criteria.** This is the maintainer's decision (§0.1). It is documented in the rule message. An optional confirmation from J+S would remove the residual risk.
6. **Start date of the new model.** We assume 2027-01-01 for the whole model. Only the target-group merger is explicitly dated, via PBS27 slide 9. MAN and TOOL-V carry no effective date.
7. **LS/LA in 2027.** The new sources speak only of «J+S-Aktivität». Will eCamp keep the LA thematic areas? CMP-LA-01 ends 2026-12-31 for now. The 2014 cap «maximal zwei Stunden LA» [LAGER S.21] is not implemented.
8. **Subsidy group size for LS/T.** The value 16 is only on PBS27 slide 9; the official Leitfaden chapter shows teaser tiles only. JS-STAFF-03 stays hint/unverified.
9. **2026 target groups.** The LEITFADEN requires recognition «in den angemeldeten … Zielgruppen». co-co counts `leiterLsT` without telling Kinder and Jugendliche apart. Matching the Kinder/Jugendliche recognitions to the camp's participants would need a finer MiData mapping.
10. **Offer-level checks** (≥ 4-day partner camp, Unternehmung elsewhere, EF elsewhere, last activity of the offer) rely on coach input. Possible later: several camps through NDS `offerBusinessId`.
11. **MiData labels for the new qualification keys** (`sbBerg`, `waterLake` …). The exact MiData qualification labels for «Zusatz Sicherheitsbereich» and the SLRG modules must be checked against live data. Coach overrides via `settings.midata.qualMapping` remain the fallback.
12. **The WW III exception** (Art. 3 Abs. 3 VSpoFöP, Kanusport Wildwasser, cited from WEB-C «Verbotene Sportarten»): content of the exception not detailed.
13. **Mobile phone in the emergency kit.** WEB-SICH requires it; MB-UP (PDF) does not. LST-TREK-06 accepts any alarm means.
14. **2014-only items** (LAGER, BERG) stay `unverified` until a current source confirms them. This covers milestones, checklist items marked «2014», LST-LAGER-02/03/06, LST-TREK-03/04/07, LST-BERG-04, CMP-DAY-01, CMP-CAMP-01, BP-REST-01, and LST-TREK-02 hits computed with the default BERG pace/descent/pause values (per-hit confidence `unverified`).
15. **PBS methods and relationships list** (PBS-METH-01): the Pfadiprofil is not obtained.
16. **TOOL-V movement-time example** (3 h Schnitzeljagd: 6 × 5 min running = 1.5 h) is internally inconsistent. Do not use it as a test fixture.
17. **Public holidays for JS-DL-04.** Only federal and general holidays are in the param. Cantonal holidays at the delivery site are not covered.
18. **Gender-based recommendations** [BERG S.7; LAGER S.5, 33] need red-zone data. They are deliberately not rules; CL-LAGER-07 covers what is needed.
19. **Camps with `sport: other`.** JS-CAMP-01 and the JS-DAY/JS-FREE/JS-BWZ rules stay in module `lst` (maintainer decision), so camps with `campConfig.sport === 'other'` currently get only the `js` module; the general J+S camp-length and day minima (LEITFADEN Art. 14, all sports) are not checked for them.
---

## 12. Changelog of review fixes

One line per item of `catalog-final-review.md`, in review order.

1. **LST-WASSER-04 / MiData mapping:** §3.7 maps «Modul Wasser LS/T» and «Aufsichtsperson Wasser» to `waterBath`, `waterPoolUnsupervised` and `waterLake`; «SLRG Basis Pool» / «Brevet Basis Pool» stay `waterBath` only; test «Bielersee with Modul Wasser LS/T → none» added.
2. **Supervised baths:** `seebad`, `strandbad`, `flussbad` added to POOL and excluded from LAKE/RIVER, so POOL wins for these terms; LST-WASSER-04 explains it; tests «Baden im Seebad» → `waterBath` added.
3. **Missing keyword groups:** new sets SWIM and UNSUPERVISED in §6; listed in LST-WASSER-04 `keywords` and in the §3.3 example.
4. **§3.3 example param:** `lst.waterSettingDefault` removed (`params: []`); example `keywords` now match LST-WASSER-04.
5. **LST-SB-01 SB Winter biwak:** trigger is (BIWAK ∪ IGLU) and `campForm !== 'haus'`, only in `lst.winterMonths` (correction B6 reverted); tests «Iglunacht» Feb haus → none, zelt → should; summer biwak → none.
6. **LST-SB-01 SB Berg:** biwak path now requires multi-day **and** above the treeline (GPX or TREELINE); the multi-day-only path is dropped (strict choice); tests added.
7. **SB Winter camp case season gate:** defined «camp overlaps `lst.winterMonths`» (§2.2); `lst-winter` only suggests on `winterSafeAccess === false`, switches on only in winter months (§2.2, §3.2 AND-ed trigger keys, new key `campOverlapsMonths`); LST-SB-02/03/04 camp case and CL-LST-04 gated; camp hits lowered to should as a proxy (§0.3).
8. **LST-WINTER-01:** new variant `notHouse` (should) for `campForm ∈ {zelt, gemischt}`; rule only for winter camps; meta raised to should/verified with the other variants as hints; one hit per camp in a fixed order.
9. **LST-WINTER-03:** changed to should/heuristic (simpler option; no tagged-only verified path).
10. **2014-only confidences:** LST-TREK-03, LST-TREK-07, LST-BERG-04, LST-LAGER-06, CMP-DAY-01, CMP-CAMP-01 and BP-REST-01 set to `unverified` (BP-REST-01 cites [H] only as param basis); LST-TREK-02 lowers per-hit confidence to `unverified` when default BERG pace/descent/pause values are used; §11 Q14 updated to match.
11. **JS-BWZ-02 `under30`:** downgraded to should; §0.3 now limits the `must` to variant `step` and explains why.
12. **JS-FREE-01 2027:** for `js.consecutiveMode === 'jsDaysSkipping'` every hit is capped at hint/`conflict` (variant `conflict2027`, TOOL-V quote verified); §10 row and §11 Q1 updated.
13. **§0.3 wording:** reworded to «The `must` sits on the count (JS-CAMP-01). JS-FREE-01 stays `should`, because the sources contradict each other …».
14. **JS-DAY-04:** «Combined total 0 → hint» replaced by «no finding», citing the LEITFADEN.
15. **§3.9.6 thresholds:** `240`/`120` replaced by `js.minDayMinutes` / `js.minBwzDayMinutes` (BWZ condition skipped when null); JS-DAY-04 aligned.
16. **«Kategorie-Zuordnung fehlt» owner:** JS-CAMP-01 variant `noMapping` only; `ctx.js.mappingKnown` added; all other `ctx.js` rules stay silent (§3.9.1).
17. **Param rows:** `js.bwzStepMinutes` has a `null` row for 2026; `js.leihmaterialOutage` has a value row 2026-01-01…2027-01-17 and `null` from 2027-01-18; §7 intro states the gap-free row rule; new params `lst.oldSnow*` replace hard-coded LST-BERG-04 thresholds.
18. **JS-DL-06:** uses `leihmaterialOrdered === true`; validity 2026-01-01…2027-01-17 plus overlap check; param fields renamed `outageStart`/`outageEnd`/`orderBy`, window named `windowStart`/`windowEnd`; tests for 2027-01-15 camp and `false` flag added.
19. **JS-DL-05 escalation:** hint before camp end, should between camp end and the JS-DL-02 closing due date, must after it; interval tests added.
20. **JS-DL-04 holiday test:** now 2027-05-06 (Auffahrt, Thursday); a Saturday test added.
21. **LST-BERG-01 `T_HIGH`:** removed; the rule uses ALPINE (which contains `\bt\s?[4-6]\b`).
22. **Inline keyword terms:** new sets SB_WASSER_EXTRA (`^flussschwimm, ^flusssurf`; `raft` was already in BOAT), GORGE (`schlucht`, BACHTREKKING extends it), BIKE_INLINE (BIKE extends it), TREELINE (ANSPRUCHSVOLL extends it); §3.12 forbids inline terms.
23. **EXCLUDED:** `bruchtest` added; test «Bruchtest mit Brettern» added.
24. **JS-EXCL-01 WW III exception:** WEB-C «Verbotene Sportarten» cited for variant `ww`; §11 Q12 shortened; §1 «not obtained» note aligned.
25. **`EBB-C/L`:** split into `EBB-C` + `EBB-L` in JS-EXCL-01, §3.9.1 and §0.2.
26. **Missing sources:** CMP-MD-01 cites [MD]; CMP-NDS-01 cites [WEB-C «Anmeldefrist für J+S-Angebote»] and [WEB-L].
27. **`activity|camp` scope:** LST-SB-02/03/04 use `scope: activity`; §3.3 states once that a hit may target the camp IRI regardless of scope; camp case uses variant `camp` (added to LST-SB-03/04).
28. **LST-SB-02 Bergführer:** `kind: bergfuehrer` satisfies the rule even with `approvedOn: null`; WEB-C quote replaced by the verbatim text; tests added.
29. **Angebotskontext label:** now «Weiteres Lager ≥ 4 Tage (ab 2027: J+S-Tage) im selben Angebot».
30. **JS-AGE-01 message:** now «… ausserhalb des J+S-Alters (J+S-Alter: Jahrgänge {fromYear}–{toYear}) …».
31. **`activityTags` inputs:** added to JS-DAY-06, JS-BWZ-02, LST-ACT-02, JS-DL-05 headers and to an inputs list for JS-CAMP-01, JS-DAY-01…05, JS-FREE-01, JS-BWZ-27, JS-DL-02 in §4.1; §3.9.1 states the requirement.
32. **§8 kinds:** legend states B/E/2014 are the only kinds; `didactic` and `info` items mapped to E.
33. **(Optional) JS-CAMP-01 / JS-DAY in `lst`:** kept in `lst` (maintainer decision); §11 Q19 notes that `sport: other` camps currently get only the `js` module.

Additional consistency fixes made while applying the above: full content written out for OUTDOOR, EF1–EF6, LAKE excludes and docCheck; PBS_METHODS / PBS_RELATIONS given provisional term lists (seven methods only, see §11 Q15); `!` prefixes removed from the Exclude column; JS-DL-03 lead times read from their params; LST-ACT-02 overlap uses `js.minUnitMinutes`; milestone M-JS-LIEFERUNTERBRUCH reads `js.leihmaterialOutage`; §3.8 states the `campConfig.<field>` shorthand.
