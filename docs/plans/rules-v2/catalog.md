# Rule set v2 – research catalog (draft, not yet approved)

> Generated 2026-11-08 by a multi-agent research run over `co-co-docs` (9 PDFs) and 3 J+S tool modules; every source extraction was adversarially re-checked against the original. The section "Review corrections" at the end takes precedence over the catalog where they conflict.

**Source keys.** Every claim cites a source key and a page, in the form `[KEY p.N]`.

| Key | Source | Page convention | Weight |
|---|---|---|---|
| **MAN** | `co-co-docs\Manual Lagersport _ Trekking.pdf` (BASPO, edition 2026, available since 16.10.2026) | printed page | binding core: p. 21 Fig. 4 |
| **TOOL-V** | J+S tool module "Lagersport/Trekking Vorgaben" `6a87f378…` (updated 2026-10-15) | section name | binding, most detailed |
| **TOOL-G** | J+S tool module "Lagersport/Trekking Grundlagen" `6a60d154…` | section name | didactic, not binding |
| **TOOL-P** | J+S tool module "Eine gute J+S-Aktivität planen" `6a75d5f5…` (2026-10-14) | step name | didactic |
| **PBS27** | `2027_neuigkeiten_von_pbs_und_js_de.pdf` (PBS, Oct 2026) | slide number | binding where it quotes J+S |
| **EBB-C / EBB-L** | Checkliste Ergänzende Bewegungsblöcke für Coachs / für Lagerleitende (status 12/2025) | page | binding |
| **GST** | `100.01.de_Merkblatt Grundlagen Sportfachtechnik_LST.pdf` (09/2026) | page | mostly info |
| **LAGER** | `LS-T_Lager_d.pdf` (2014) | printed page | **2014, may be outdated** |
| **BERG** | `LS-T_Berg_d.pdf` (2014) | printed page = PDF page − 2 | **2014** |
| **WASSER** | `LS-T_Wasser_d.pdf` (2019) | printed page | didactic, partly binding |
| **WINTER** | `LS-T_Winter_d.pdf` (2019) | printed page = PDF page − 2 | didactic, partly binding |

**Not in the corpus, but referenced as binding:**
- Merkblatt "Unfallprävention und Sicherheitsanforderungen in LS/T" (jsle.ch/dMB1), referenced in [MAN p.43] and [PBS27 slide 11].
- "Leitfaden für J+S-Angebote" (jsle.ch/dLET), referenced in [MAN p.20] and [TOOL-V "Zum Schluss"].
- The jugendundsport.ch pages L, C and LT that the current pack cites.

Several open points below can only be settled with these documents.

**Severity policy used throughout:**
- `must` + `verified` only when a binding statement in J+S 2025/2026 material (MAN, TOOL-V, PBS27 quoting J+S, EBB-C/L) is confirmed **and** the check is deterministic on the data.
- A binding source plus keyword detection gives `should` + `heuristic`.
- A binding statement that appears only in a 2014 brochure gives at most `should` + `unverified` until the Merkblatt or Leitfaden confirms it.
- PBS-only and didactic recommendations give `hint` + `best-practice`.

---

## 1. Module structure

### 1.1 Packs and modules

| Pack / module | id | Applies when | Content |
|---|---|---|---|
| **J+S Lager allgemein** | `js` | every camp with `isJsCamp !== false` | Offer and NDS deadlines, J+S leaders and recognition, minimum participants, excluded sports (SpoFöV), data consistency eCamp↔MiData↔NDS, completeness |
| **Lagersport/Trekking – Kern** | `lst` | `isJsCamp` and `sport = 'lst'` (default for youth associations) | Offer, camp, J+S day and activity rules (MAN p.21 Fig. 4, TOOL-V), movement time (Bewegungszeit), times of day, Erscheinungsformen, detailed planning, safety considerations |
| ↳ **Lager** | `lst-lager` | always with `lst` | Camp life and organisation: day responsibles, camp dossier, camp safety concept, camp rules, bad-weather programme, night quiet. Sources mostly LAGER 2014 and MAN p.45/61. |
| ↳ **Unterwegs/Trekking** | `lst-trekking` | always with `lst` (every offer needs an Unternehmung; BERG p.2 says the brochure "gilt für alle Wanderungen") | Hikes, Unternehmung detection, route and walking-time documents, GPX, bike/inline, bivouac |
| ↳ **Berg** | `lst-berg` | coach confirms; suggested on MOUNTAIN hits, GPX highest point > 1000 m, or a camp address in the Alps/Pre-Alps | SAC scale, Sicherheitsbereich Berg, Umkehrzeit, reconnaissance, thunderstorms, old snow |
| ↳ **Wasser** | `lst-wasser` | coach confirms; suggested on WATER hits | Bathing supervision, white water, boats/rafts, Bachtrekking, lake swimming, SLRG |
| ↳ **Winter** | `lst-winter` | coach confirms; suggested when the camp starts Nov–Apr or WINTER keywords hit | Module obligation for Sicherheitsbereich Winter, the five basic rules, sledging runs, short days |
| ↳ **Ergänzende Bewegungsblöcke** | `lst-ebb` | suggested on EBB keyword hits | EBB A/B classification, marking, safety considerations, excluded sports |
| **PBS Best Practice** | `pbs` | `camp.organizer` / `hitobitoProvider` = PBS (db.scout.ch), or coach enables it | Today's BP-*, CMP-PROG-01, sleep hours, Wölfe ratio, PBS milestones, 8 methods / 5 relationships |

**Module states per camp:** `off | suggested | on`.
- `suggested` modules run their rules, but findings are capped at `hint` and carry a note such as "Modul Berg vorgeschlagen – bestätigen, um vollständig zu prüfen".
- This avoids false `should` findings from keyword noise and still makes the coach aware of a missing module.

### 1.2 How the coach activates modules

- **Where:** a new card "Regelmodule" in the coach-input view.
  - J+S yes/no (exists).
  - Sport: `lst` (default) / `other`.
  - Toggles: Berg / Wasser / Winter / EBB / PBS.
  - Each auto-suggestion shows its reason, for example "3 Aktivitäten mit Berg-Stichworten", "Lagerstart im Februar" or "GPX-Höchstpunkt 1950 m".
- **Activity tags:** the coach can tag single activities with `unternehmung`, `sb-berg`, `sb-wasser`, `sb-winter`, `ebb-a`, `ebb-b`, `keine-js-aktivitaet`, `ef1`…`ef6`.
  - A tag overrides keyword detection in both directions (adds or suppresses). This is the main tool against false positives.
- **Offer context:** three coach inputs make offer-level rules (TOOL-V "Das J+S-Angebot") decidable when co-co only sees one camp:
  - `angebotOther4DayCamp`: another camp in the same offer has ≥ 4 consecutive J+S days.
  - `angebotUnternehmungElsewhere`
  - `angebotEfCoveredElsewhere`

### 1.3 Adding further J+S sport modules later

Each sport becomes a pack folder `packs/<sport>/` (for example `js-schneesport`, `js-kanu`, `js-bergsteigen`) containing:
- a `pack.yaml` with `appliesWhen: { sport: … }` or `{ module: … }`;
- rules, keywords, params and predicates;
- optionally `extends: lst` to reuse helpers.

Typical uses:
- EBB A activities (EBB-C p.2: "Vorgaben der jeweiligen J+S-Sportart") would enable a sport module that brings its own leader recognitions and ratios.
- A stand-alone J+S ski camp (a different sport) would turn `lst` off and its own sport module on.

Prerequisites:
- The qualification enum is extended: `MidataQualKey` gains `schneesport`, `kanu`, `klettern`, `bergsteigen`, `nothilfe`, `blsAed`, `slrgSee`, `slrgFluss`, `sbBerg`, `sbWasser`, `sbWinter`.
- `qual_keys_for_label` in `coco-core/src/midata.rs` is mapped accordingly.

### 1.4 Required infrastructure changes

1. **Pack/module registry.**
   - `pack.yaml` gains `modules: [{id, title, appliesWhen, defaultState}]`.
   - Every rule YAML gets `module:` and `group:`. `ruleGroupOf()` reads `meta.group` instead of the id prefix.
   - `RuleGroup` becomes data-driven (`js | lst | lst-lager | lst-trekking | lst-berg | lst-wasser | lst-winter | lst-ebb | completeness | safety | best-practice | pbs`), with i18n keys `rules.catalog.group.*` and the filter in `FindingsView`/`RulesCatalogView` built from the registry.
   - The loader asserts **global** rule-id uniqueness across packs.
   - `PREDICATES` registry: one line per pack. Shared helpers move from `basis/predicates/{util,jsDays,deadlines}.ts` to `rules/lib/`.
2. **Per-camp activation.**
   - Dexie `version(n+1)` with a table `campRuleConfig { campIri, sport, modules{id→state}, activityTags{activityIri→tag[]}, angebot{…}, params{key→value}, updatedAt }`, covered by backup export/import.
   - The engine filters on `appliesWhen` and module state; `suggested` caps severity at `hint`.
   - Global `settings.rulePacks` stays as an admin override.
3. **Keyword lists as data.**
   - `packs/<pack>/keywords/*.yaml`, one list per set: include, `=exact`, `^prefix`, `$suffix` and exclude. Modules can **extend** base lists (`extends: basis.MOUNTAIN`).
   - The tokenizer gains phrase matching so multi-word entries such as "flying fox", "weiss-blau-weiss" and "plan b" work. Today "flying fox" can never match.
4. **Thresholds as params.**
   - `packs/<pack>/params.yaml` with `{key, value, unit, validFrom, validTo, source}`.
   - Predicates read `ctx.params.get('js.minDayMinutes')`.
   - Coach overrides per camp are stored in `campRuleConfig.params`; global overrides live in `settings.ruleParams`.
   - Findings computed with an overridden parameter show "Parameter angepasst: X (Standard Y)".
   - Message texts take the value from params; no more hard-coded "20 %".
5. **Versioning.**
   - The pack is versioned as `2026.2.0` (rules valid to 2026-12-31) together with `2027.1.0`. Practically, one pack with rule-level `validFrom`/`validTo` and param-level validity is simpler: the engine picks by camp start date.
   - Each rule gets `formerIds:` so renamed ids keep their overrides and `ruleState`.
6. **Sources registry.**
   - `packs/sources.yaml` holds `{key, title, version/date, url|file}`.
   - Rule YAML uses `sources: [{key, page, quote}]` instead of one `source` URL.
   - When a source document gets a new version, every rule citing it is flagged "erneut prüfen".
7. **`RuleInput`** gains `midata`, `nds`, `campConfig` and `activityTags`, so rules that read MiData or NDS declare it and are explained correctly in "Warum?".
8. **Texts.** All `_message` and detail texts move from TypeScript into YAML message templates with placeholders. This covers JS-DL-*, CMP-CON-* and "Angabe fehlt".
9. **Category model.** `CategoryClass` keeps LS/LA/LP/ES/NONE for 2026 and gains the notion "J+S-Aktivität" (LS ∪ LA) for 2027. Movement time comes from eCamp `YSPhysicalActivityDuration` (already in `content.ysPhysicalActivityDurationMinutes` and on schedule entries).
10. **Tests.** `packs.test.ts` drops the "length 1 / coco-basis" assertion. Every new rule needs a fixture test in `domain/rules/__tests__`.

---

## 2. Existing rules: decision per rule

Legend: **K** = keep, **M→x** = move to module x (the id stays, so `formerIds` is not needed), **R** = refine, **X** = retire (set `validTo`). ⚠ marks a severity/confidence that does not match the sources.

### 2.1 Group `js`

| id | Decision | Exact change and sources |
|---|---|---|
| **JS-CAMP-01** | **R, M→lst** ⚠ | Today it counts consecutive **calendar** days. The sources require consecutive **J+S days**:<br>• "≥ 4 aufeinanderfolgende J+S-Tage (oder mindestens 3 Tage, wenn innerhalb desselben Angebots zusätzlich ein Lager mit mindestens 4 aufeinanderfolgenden Tagen …)" [TOOL-V "Das J+S-Lager"]<br>• Camp ≥ 3 camp days and offer has one camp ≥ 4 [MAN p.21 Fig. 4; PBS27 slides 5–6]<br>New logic: longest run of `computeJsDays`-valid days (first and last day may be combined, see JS-DAY-04). Threshold `js.minConsecutiveJsDays` = 4, or 3 when `angebotOther4DayCamp = true`. If `isJsCamp` is set but no mapping is confirmed: hint "Mapping fehlt". must/verified from 2027-01-01; the 2026 variant (calendar days ≥ 4, source L) gets validTo 2026-12-31. |
| **JS-CAMP-02** | **K, M→js**, add citations | Threshold 12 confirmed: "minimale Lagerteilnehmendenanzahl von 12 Kinder und Jugendlichen im Alter von 5 bis 20 Jahren" [PBS27 slide 9]. Age 5–20 [PBS27 slide 9; MAN p.8]. Move `minParticipants = 12` and age 5–20 to params. Strictly this is LS/T-specific (slide 9 is about LS/T); keep it in `js` because LS/T is the only sport in scope and note it in the YAML. |
| **JS-DAY-01** | **R, M→lst** ⚠ | Sources: "Ein Lagertag wird dann als J+S-Tag angerechnet, wenn er insgesamt mindestens 4 Stunden J+S-Aktivitäten umfasst und mindestens 2 … sportlich-aktive Bewegungszeit" [TOOL-V]; "Es ist möglich, einen Tag ohne J+S-Aktivitäten zu planen, sofern die Mindestanzahl an J+S-Tagen eingehalten wird" [TOOL-V]; "Jeder Lagertag umfasst mindestens vier Stunden" [MAN p.21; PBS27 slide 6].<br>Interpretation: a day with some but < 240 min of J+S activities is **not a violation in itself**; it just does not count. New severity `should` (verified). Message: "Tag {date} zählt nicht als J+S-Tag ({minutes} min J+S-Aktivität, nötig 240)". The `must` moves to the count in JS-CAMP-01. Drop the "≥ 2 units" clause from 2027; JS-DAY-06 (times of day) replaces it. Keep `quantityOk` with ≥ 2 units for 2026. |
| **JS-DAY-02** | **K, M→lst** | "Die J+S-Aktivitäten dauern jeweils mindestens 30 Minuten" [MAN p.21; TOOL-V "Die J+S-Aktivität"; PBS27 slide 7]. Add citations. Param `js.minUnitMinutes = 30`. |
| **JS-DAY-03** | **R / X from 2027** ⚠ | No source in the corpus requires 30-minute gaps ("Sozialzeit"). None of MAN p.21, TOOL-V or PBS27 slides 5–8 mention it. For 2026 keep it with source L but downgrade to `should` / `unverified` until jugendundsport.ch/de/lager is re-checked. Set validTo 2026-12-31. From 2027 merged J+S blocks simply count as one activity. |
| **JS-DAY-04** | **K, M→lst**, add citation | Confirmed: "der erste und der letzte Tag … zusammengefasst und als ein einzelner J+S-Tag angerechnet …, sofern die Gesamtdauer … 4 Stunden ergibt" [TOOL-V "Das J+S-Lager"]. From 2027 drop the "≥ 2 units / gaps" clauses (see JS-DAY-03). Open: does the combined day also need 120 min of movement time? See §6. |
| **JS-DAY-05** (warm-up) | **M→lst, R** ⚠ | This is a recommendation, not J+S law: "Aufwärmen vor den Aktivitäten" [MAN p.55]; a three-part structure with an Einleitung such as Aufwärmen [MAN p.40; TOOL-P step 3 "Fast jede gute J+S-Aktivität…"]. Change from should/heuristic to **hint**/best-practice, source MAN p.55 and p.40. Keywords become data (see §4). Optionally accept the structure words "Einleitung", "Einstieg" and "Hauptteil". |
| **JS-DL-01** | **K, M→js**, mark open ⚠ | The only corpus source is "Bis spätestens 30 Tage vor Beginn des **ersten Lagers des Jahres eures Vereins** muss euer J+S-Coach ein J+S-Angebot eröffnen" [LAGER p.23, 2014]. The deadline refers to the club's first camp, not this camp. Keep must/verified (source L) but add a coach param `ndsRegistrationDueOverride` and note the LAGER source. Open question §6. |
| **JS-DL-02** | **K** ⚠ | The 30-day closing deadline is not in the corpus. LAGER p.4/45 says only that the coach closes the camp after the activity list is handed over (≤ 2 weeks). Keep it on source L; it needs re-verification. |
| **JS-DL-03** | **R** | Leihmaterial confirmed: "strikte 5 Wochen Bestellfirst" [PBS27 slide 16]. Landeskarten 21/35 days and the June–August rule are not in the corpus (LAGER p.3 says only "12–6 Wochen vorher Karten- und Leihmaterialbestellung") and stay on source L. Split the source per kind. Add JS-DL-04 (no delivery on weekends or public holidays). |
| **JS-LL-01** | **K, M→js**, add citation | "mindestens eine der Leiter*innen muss über den Zusatz «Lagerleiter*in» verfügen" [PBS27 slide 9]; LAGER p.6 (2014, "Modul Lagerleiter LS/T"). Stays must/verified. |
| **JS-STAFF-01** | **R** ⚠ | Split it:<br>(a) the minimum of 2 J+S leaders is now verified → new **JS-STAFF-02** (must, [PBS27 slide 9]);<br>(b) the 1:10 ratio is still not in the corpus. The only number is "subventionsrelevante Gruppengrösse … 16+16+16" [PBS27 slide 9]; the ratio itself lives in the Leitfaden [MAN p.20]. Keep should/conflict, param `js.maxParticipantsPerLeader = 10` overridable, open question §6. |
| **JS-FREE-01** | **X** ⚠ | Contradicts "Es ist möglich, einen Tag ohne J+S-Aktivitäten zu planen, sofern die Mindestanzahl an J+S-Tagen eingehalten wird" [TOOL-V]. validTo 2026-12-31. From 2027 JS-CAMP-01 covers it (the free day only matters if it breaks the consecutive run; see §6). |
| **JS-BWZ-27** | **R, M→lst** ⚠ | Today hint/unverified. Binding: "Mindestens zwei dieser vier Stunden müssen sportlich-aktive Bewegungszeit sein" [MAN p.21; TOOL-V; PBS27 slide 6]. Change to **must/verified, validFrom 2027-01-01**, scope day. Count only **J+S days** (days with ≥ 240 min J+S). Per activity only values ≥ 30 min count, otherwise 0 [TOOL-V "Sportlich-aktive Bewegungszeit": "Dieser muss mindestens 30 Minuten lang sein, ansonsten kann die Bewegungszeit nicht berücksichtigt werden"]. "No data at all" stays a camp hint ("Bewegungszeit nicht erfasst"). Param `js.minBwzDayMinutes = 120`. |

### 2.2 Group `completeness`

| id | Decision | Change and sources |
|---|---|---|
| CMP-ACT-01 | **K, M→lst**, add citation | Responsible person is a planning rubric [MAN p.39 "verantwortliche Person"; LAGER p.18; TOOL-P step 1]. should/best-practice stays. |
| CMP-ACT-02 | **R, M→lst** | Accept storyboard **or** notes text (the requirement is "schriftlich", not "Storyboard"). Binding: "[Detailplanung] erfolgt schriftlich gemäss den Weisungen von J+S" [MAN p.38–39]; "Alle Aktivitäten müssen schriftlich festgehalten werden" [LAGER p.21]. Change confidence best-practice → **verified**, severity stays `should` (empty storyboard ≠ no written plan). |
| CMP-ACT-03 | **R, M→lst** | Extend to every J+S activity (LS/LA), with two levels:<br>• risk activities (OUTDOOR/WATER/MOUNTAIN/ROPE/NIGHT/WINTER/FIRE) → `should`;<br>• other J+S activities → `hint`.<br>Sources: "Zu jeder J+S-Aktivität gehören auch Sicherheitsüberlegungen" [TOOL-P step 3]; [MAN p.39, p.45]; [LAGER p.21]. |
| CMP-LA-01 | **K until 2026-12-31** | The LA concept does not appear in the 2027 sources (MAN/TOOL-V speak only of "J+S-Aktivitäten"). Set validTo 2026-12-31 unless eCamp keeps LA thematic areas; open question §6. |
| CMP-DAY-01 | **M→lst-lager**, add citation | "empfiehlt es sich, für jeden Tag eine Tagesverantwortliche zu bestimmen" [LAGER p.8]. Grobprogramm component "Tag, Datum und Tagesverantwortliche" [LAGER p.18]. hint stays. |
| CMP-CAMP-01 | **K, M→js** | Grobprogramm contains "Name des J+S-Coachs" [LAGER p.18]. |
| CMP-MD-01, CMP-NDS-01, -03, CMP-CON-01…-10 | **K, M→js** | Data consistency, no change. Move threshold 0.2 to param `js.participantsDiffTolerance`; texts read the parameter. CMP-CON-05: add citation "mindestens alle zwei Jahre J+S-Anerkennung … verlängern" [MAN p.17 Tab. 2]. CMP-CON-09 (no birthday) supports the 5–20 rule [PBS27 slide 9]. |
| CMP-NDS-02 | **K, M→js**, add citation | Attendance list (AWK) is a leader duty [MAN p.17 Tab. 2]. should stays. |
| CMP-PROG-01 | **M→pbs** | PBS-internal progress labels. |

### 2.3 Group `safety`

| id | Decision | Change and sources |
|---|---|---|
| SAFE-WATER-01 | **M→lst-wasser, R** | Split into:<br>(a) missing responsible person → **should**, because "muss auch beim freien Spielen eine Leitungsperson gegenwärtig sein" [WASSER p.18];<br>(b) empty safety text → should [WASSER p.3, p.5];<br>(c) no responsible person with `wasser`/`slrg` → hint, because for normal bathing SLRG is only "benötigt" in the sense of a recommendation [LAGER p.22]; the stronger case is LST-WASSER-05.<br>Water keyword list extended (see §4). |
| SAFE-MTN-01 | **M→lst-trekking, R** → see LST-TREK-01 | Stronger source: "Folgende Unterlagen musst du deinem Coach für jede Wanderung zur Verfügung stellen: Kartenkopie mit geplanter Route, Marschzeitberechnung, Sicherheitskonzept" [BERG p.12]; [LAGER p.23 camp dossier]. Check each of the 3 parts separately (document/GPX linked, walking-time keywords, safety text) and name the missing ones. should/heuristic. |
| SAFE-MTN-02 | **M→lst-trekking, R** | Pace defaults from the BERG table "untrainierte Gruppe/Kinder 2–4 Lkm/h mit Gepäck, trainierte/Jugendliche 3–5" [BERG p.14]:<br>• `paceKidsLkmPerHour = 3` for Biber/Wölfe or minAge < 10;<br>• `paceLkmPerHour = 4` otherwise.<br>Descent: 150 Hm = 1 Lkm [BERG p.14]; set `includeDescent` default true. Compare against slot minus pauses (`pauseMinutesPerHour` param, default 10 for children [BERG p.21 "jede Stunde eine Pause"]). |
| SAFE-MTN-03 | **M→lst-berg, R** | Fire only for activities tagged `sb-berg`, or with T3+/alpine hits (LST-BERG detection), not for every MOUNTAIN hit. Check at **team** level: "mindestens ein Mitglied des Leitungsteams den Zusatz LS/T Sicherheitsbereich Berg" [LAGER p.11, 2014]; "Für Aktivitäten im Sicherheitsbereich ist es obligatorisch" [BERG p.2]. Severity should, confidence heuristic (the Sicherheitsbereich boundary is in the Merkblatt, not in the corpus). |
| SAFE-ROPE-01 | **M→lst-lager**, K | Rope building, Seilbahn and Abseilen are regular LS/T activities [TOOL-G EF1 slide 1; MAN p.26]; MAN p.64 safety symbol. Move 200 characters to param `lst.ropeMinSafetyChars`. Fix "flying fox" (phrase matching). |
| SAFE-NIGHT-01 | **M→lst-lager**, add citation | "In der Nacht erfordern einfache Geländespiele … mehr Sicherheitsüberlegungen" [LAGER p.22]; [MAN p.42]. Params `nightEndMinutes`, `minRestMinutes`. hint stays. |
| SAFE-WX-01 | **M→lst-lager, R** | Bad-weather variant is a planning rubric [MAN p.39] and minimum content of the camp dossier [LAGER p.23]. Extend the phrases: `sw-variante, schlechtwettervariante, alternative, ausweich, variante bei regen, indoor-variante`. should/heuristic stays. |
| SAFE-DOC-01 | **M→lst-lager, R** → LST-LAGER-01 | Camp safety concept: "Es muss dem Coach vor dem Lager in schriftlicher Form abgegeben werden" [LAGER p.22, 2014]; [MAN p.45, recommended]; [WINTER p.27]. Check existence first (document of kind "Sicherheitskonzept" or docCheck ≥ 3 items), then completeness. should/heuristic. |

### 2.4 Group `best-practice`

| id | Decision | Note |
|---|---|---|
| BP-REST-01 | **M→pbs**, add citation | "aktive und ruhigere Aktivitäten abwechseln" [LAGER p.18]. |
| BP-SLEEP-01 | **M→pbs** | "genügend Schlaf" [MAN p.55] has no numbers; the hours per Stufe are PBS (H). |
| BP-WOLF-01 | **M→pbs** | PBS source only. |
| BP-WATER-01 | **M→lst-wasser, R** → LST-WASSER-05 | The 1-per-12 SLRG ratio exists only for raft and canoe camps [LAGER p.11, 2014]. For general bathing keep the PBS hint in `pbs`. |
| BP-VAR-01 | **M→lst**, add citation | "Ist mein Programm über den Tag und über das ganze Lager gesehen abwechslungsreich" [MAN p.38]. hint. |

---

## 3. New rules

Format: **id** · severity · confidence · scope · inputs. All titles and messages are German. `{…}` are placeholders.

### 3.1 Pack `js` (J+S Lager allgemein)

**JS-STAFF-02** · must · verified · camp · midata, coachInputs
- **Titel:** Mindestens zwei J+S-Leitende LS/T
- **Meldung:** «Es sind {count} J+S-Leitende LS/T mit gültiger Anerkennung erfasst – nötig sind mindestens 2.»
- **Prüfung:** MiData `qualificationKinds` key `leiterLsT`, `validLeaders` ≥ 2. Without MiData, fall back to coach input `jsLeadersCount`. If neither exists: hint "Angabe fehlt".
- **Quelle:** [PBS27 slide 9] "Zur Durchführung eines Lagers braucht es mind. 2 J+S-Leiter*innen LS/T".

**JS-EXCL-01** · should · heuristic · activity · –
- **Titel:** Von J+S ausgeschlossene Sportart
- **Meldung:** ««{activity}» enthält «{term}». Diese Sportart ist von J+S ausgeschlossen (Art. 6 Abs. 2 SpoFöV) und nicht bewilligungsfähig.»
- **Prüfung:** The EXCLUDED keyword list (§4) matches title, location, storyboard or notes. The tag `keine-js-aktivitaet` does not silence it, because the sport is excluded even outside J+S time. The coach can only dismiss it via override.
- **Quelle:** [EBB-C p.1; EBB-L p.1] "Motor- und Flugsportarten, … Canyoning, River Rafting und Wildwasserfahrten ab … Wildwasser III …, Bungee-Jumping → nicht zulässig".

**JS-DL-04** · hint · verified · camp · coachInputs
- **Titel:** Leihmaterial: keine Lieferung am Wochenende
- **Meldung:** «Lagerbeginn ist ein {weekday}. J+S-Leihmaterial wird an Samstagen, Sonn- und Feiertagen nicht geliefert – Liefertermin auf einen Werktag vorher legen.»
- **Prüfung:** Leihmaterial in use (`leihmaterialOrdered != null`) and the camp start date falls on Sat or Sun.
- **Quelle:** [PBS27 slide 16]; [LAGER p.24].

**JS-AGE-01** · hint · verified · camp · midata
- **Titel:** Teilnehmende ausserhalb 5–20 Jahre
- **Meldung:** «{n} Teilnehmende liegen ausserhalb des J+S-Alters 5–20 und zählen nicht für die Mindestzahl.»
- **Prüfung:** MiData `ageBands` outside [5, 20], counted at camp start. Aggregates only (red zone stays local).
- **Quelle:** [PBS27 slide 9] (from 2027-01-01 all camps open to ages 5–20); [MAN p.8].

**Deadline radar additions (milestones, not rules):**
- Jugendurlaub request ≥ 2 months before camp start [LAGER p.5].
- Detail programme to coach 12–6 weeks before [LAGER p.3].
- Lagerregeln 4–2 weeks before [LAGER p.3].
- Detailed parent information ≥ 3 weeks before [LAGER p.28].
- Evaluation 2–6 weeks after [LAGER p.45].

All are `unverified` (2014).

### 3.2 Module `lst` (core)

**JS-DAY-06** · must · verified · day · mapping, params (validFrom 2027-01-01)
- **Titel:** J+S-Aktivitäten auf mindestens zwei Tageszeiten
- **Meldung:** «Am {date} liegen alle J+S-Aktivitäten in einer Tageszeit ({slot}). Sie müssen auf mindestens zwei Tageszeiten (Morgen, Nachmittag, Abend) verteilt sein.»
- **Prüfung:** For each J+S day, each J+S unit counts toward every time window it overlaps by ≥ 30 min. This lenient reading avoids false positives. Default windows: Morgen < 12:00, Nachmittag 12:00–18:00, Abend ≥ 18:00 (param, coach-overridable). Fire if fewer than 2 windows are covered. Combined first/last day: evaluate the two days together.
- **Quelle:** [MAN p.21] "Die J+S-Aktivitäten werden auf mindestens zwei Tageszeiten verteilt"; [TOOL-V "Das J+S-Lager"] "müssen"; [PBS27 slide 7].
- ⚠ The time-window boundaries are not defined in the sources (§6). If the coach prefers caution, use `should` until they are clarified.

**JS-BWZ-02** · should · verified · activity · – (validFrom 2027-01-01)
- **Titel:** Bewegungszeit korrekt ausweisen
- **Meldung:** «Bewegungszeit von «{activity}» ({value} min): {problem}.» Problem variants:
  - «unter 30 min – wird nicht angerechnet»
  - «nicht in 15-Minuten-Schritten»
  - «länger als die Aktivität ({duration} min)»
  - «fehlt»
- **Prüfung:** Per J+S activity (or per schedule entry, if set there): value ≥ 30, value % 15 = 0, value ≤ entry duration. "Fehlt" fires only if the activity lies on a day that is short of the 120 minutes.
- **Quelle:** [TOOL-V "Sportlich-aktive Bewegungszeit"] "muss ab einer Dauer von 30 Minuten pro Aktivität und in 15-Minuten-Schritten auf dem Lagerprogramm ausgewiesen werden"; [MAN p.21].
- Severity is `should` and not `must`, because missing presentation does not invalidate the camp. Only the count in JS-BWZ-27 does.

**LST-ACT-01** · should · heuristic · activity · mapping
- **Titel:** J+S-Aktivität ohne Bewegung?
- **Meldung:** ««{activity}» ist als J+S-Aktivität kategorisiert, wirkt aber nicht aktiv und bewegungsorientiert («{term}»). Solche Programmpunkte zählen nicht als J+S-Aktivität.»
- **Prüfung:** The activity's category is LS/LA, the title matches the PASSIVE list (§4), and the storyboard has no MOVEMENT word. Suppressed by an override or by tagging the activity as J+S explicitly.
- **Quelle:** [TOOL-V "Aktiv und bewegungsorientiert"] (flip cards: Singen am Lagerfeuer, Film, Knoten am Tisch = nicht J+S); [MAN p.21].

**LST-ACT-02** · hint · heuristic · activity · mapping
- **Titel:** J+S-Aktivität nur für einen Teil der Gruppe?
- **Meldung:** ««{activity}» scheint sich nur an einen Teil der Gruppe zu richten («{term}»). J+S-Aktivitäten richten sich an alle Teilnehmenden.»
- **Prüfung:** A J+S activity whose title matches SUBGROUP (`nur `, `leiter`, `leitende`, `küchenteam`, `pio-`, `wölfe only`, `ausgewählte`, `freiwillig`), **and** no other J+S activity runs in parallel at the same time (parallel J+S blocks for subgroups count as "für alle").
- **Quelle:** [MAN p.21]; [TOOL-V "Die J+S-Aktivität"]; [PBS27 slide 7].

**LST-ACT-03** · hint · best-practice · activity · mapping
- **Titel:** Ziele der Aktivität fehlen
- **Meldung:** ««{activity}» hat keine Ziele. Ziele leiten sich aus Analyse, Erscheinungsformen und J+S-Zielen ab.»
- **Prüfung:** J+S activity with empty `learningObjectivesText`.
- **Quelle:** [TOOL-P step 2]; [MAN p.37] "Richte die Planung … nach Zielen aus".

**LST-ACT-04** · hint · best-practice · activity · mapping
- **Titel:** Detailplanung unvollständig
- **Meldung:** «Bei «{activity}» fehlen Rubriken der Detailplanung: {missing}.»
- **Prüfung:** For a J+S activity, check each of: Ort (`location`), Material (`materialText`), Schlechtwettervariante (SCHLECHTWETTER phrase in any text; only for OUTDOOR activities), Sicherheitsüberlegungen. The responsible person is excluded because CMP-ACT-01 already covers it.
- **Quelle:** [MAN p.39] "Name der Aktivität, Ort, Zeit, Ablauf, verantwortliche Person, Material, Schlechtwettervariante, Sicherheitsüberlegungen".

**LST-ANG-01** · should · heuristic · camp · campConfig, activityTags
- **Titel:** Keine Unternehmung im Programm
- **Meldung:** «Im Lager ist keine Unternehmung erkennbar (Aktivität ausserhalb des Lagerortes, z. B. Wanderung, Velotour, Schnitzeljagd). Ein J+S-Angebot braucht mindestens eine.»
- **Prüfung:** Look for an activity tagged `unternehmung`, or a J+S activity matching UNTERNEHMUNG (§4) whose location (if set) differs from the camp address or name. Skip if `angebotUnternehmungElsewhere`.
- **Quelle:** [TOOL-V "Das J+S-Angebot"] "Ein Angebot muss mindestens eine Unternehmung umfassen …"; [MAN p.21]; [PBS27 slide 5].

**LST-ANG-02** · hint · heuristic · camp · activityTags, campConfig
- **Titel:** Erscheinungsformen nicht alle sichtbar
- **Meldung:** «Für folgende Erscheinungsformen ist keine Aktivität erkennbar: {list}. Im Angebot müssen alle erlebbar werden.»
- **Prüfung:** Classify J+S activities into EF1–EF6 by tag first, then by EF keywords (§4). List the uncovered EFs. Skip if `angebotEfCoveredElsewhere`.
- **Severity:** only `hint`, because the requirement is binding [MAN p.21; TOOL-V; PBS27 slide 5] but sits at offer level and keyword classification is unreliable.
- **Quelle:** [MAN p.21; p.26–27 list]; [TOOL-G slides 1–6].

**LST-SAFE-01** · hint · verified · activity · mapping
- Covered by the CMP-ACT-03 extension (§2.2); listed here only as the source anchor [TOOL-P step 3].

### 3.3 Module `lst-lager`

**LST-LAGER-01** · should · heuristic · camp · documents (replaces SAFE-DOC-01, `formerIds: [SAFE-DOC-01]`)
- **Titel:** Sicherheitskonzept fürs Lager
- **Meldung:** «Kein Sicherheitskonzept für das Lager gefunden.» or «Im Sicherheitskonzept fehlen: {missing}.»
- **Prüfung:** Pick the document of kind `sicherheitskonzept`, else the document with the most docCheck items. If none: should. Otherwise list the missing docCheck items. Also hint when risk activities (MOUNTAIN/WATER/WINTER/ROPE/EBB hits) are not named in the concept text: "Liste der Aktivitäten mit erhöhten Sicherheitsanforderungen".
- **Quelle:** [LAGER p.22] "muss dem Coach vor dem Lager in schriftlicher Form abgegeben werden … Liste aller Aktivitäten mit erhöhten Sicherheitsanforderungen"; [MAN p.45]; [WINTER p.27].

**LST-LAGER-02** · hint · unverified · camp · documents
- **Titel:** Lagerdossier unvollständig
- **Meldung:** «Im Lagerdossier fehlen voraussichtlich: {missing}.»
- **Prüfung:** For each part, look for evidence: Grobprogramm (eCamp, always ok); drei Schwerpunkte (coach checkbox); Detailprogramm (CMP-ACT-02 ratio ≥ 90 %); Routenplanung aller Unternehmungen (LST-TREK-01 clean); Sicherheitskonzept Lager (LST-LAGER-01); Lagerregeln (document `lagerregeln` or keyword); Lagerinformation TN (document `lagerinfo`); Schlechtwetterprogramm (SAFE-WX-01 clean).
- **Quelle:** [LAGER p.23] "Das Lagerdossier enthält im Minimum: …" (2014, so `unverified`).

**LST-LAGER-03** · hint · unverified · camp · documents
- **Titel:** Lagerregeln: Pflichtbereiche
- **Meldung:** «In den Lagerregeln fehlt ein Bezug zu: {missing}.»
- **Prüfung:** Lagerregeln document text contains the keyword groups Sicherheit (`sicherheit, feuer, gelände verlassen`), Suchtmittel (`alkohol, tabak, rauch, drogen, sucht`), Zusammenleben (`respekt, zusammen`), Elektronik (`handy, natel, smartphone, elektronisch`), Umwelt (`abfall, umwelt, natur`). Runs only if a Lagerregeln document exists.
- **Quelle:** [LAGER p.32–33] "Folgende Bereiche sind für ein Lager zwingend zu regeln"; ethics charter "Verzicht auf Tabak und Alkohol während des Sports" [MAN p.16].

**LST-LAGER-04** · hint · best-practice · day · –
- **Titel:** Kein täglicher Leiterhöck
- **Meldung:** «Am {date} ist kein Leiterhöck / Tagesrückblick im Programm.»
- **Prüfung:** No schedule entry with `höck, hoeck, leiterhöck, tagesrückblick, tagesrueckblick, leitersitzung` on a camp day (excluding the last day).
- **Quelle:** [LAGER p.20] "Plant täglich einen Höck ein"; [TOOL-P step 5 "Im Leitungsteam"].

**LST-LAGER-05** · hint · best-practice · camp · –
- **Titel:** Lagerregeln und Sicherheitsinfo am ersten Tag
- **Meldung:** «Am ersten Lagertag ist kein Programmpunkt zu Lagerregeln/Sicherheit erkennbar.»
- **Prüfung:** No entry on day 1 with `lagerregeln, regeln, lagerpakt, sicherheit, notfall, begrüssung`.
- **Quelle:** [LAGER p.31–32]; [LAGER p.37] "Informiert eure Lagerteilnehmenden am Anfang des Lagers über euer Sicherheitskonzept".

**LST-LAGER-06** · hint · best-practice · scheduleEntry · –
- **Titel:** Auf-/Abbau in der Nachtruhe
- **Meldung:** ««{activity}» (Auf-/Abbau) liegt zwischen 22:00 und 07:00.»
- **Prüfung:** Entry title matches `aufbau, abbau, lagerbau` and overlaps the window 22:00–07:00 (param).
- **Quelle:** [LAGER p.40].

**LST-LAGER-07** · hint · heuristic · activity · –
- **Titel:** Feuer: Waldbrandgefahr bedenken
- **Meldung:** ««{activity}» arbeitet mit Feuer. Sicherheitsüberlegungen zu Feuerstelle/Waldbrandgefahr fehlen.»
- **Prüfung:** FIRE keyword hit, and the safety text lacks `waldbrand, feuerverbot, feuerstelle, feuerschale, löschwasser, löschen`.
- **Quelle:** [MAN p.61] "befolge die Vorschriften bezüglich Waldbrandgefahr"; [MAN p.66].

### 3.4 Module `lst-trekking`

**LST-TREK-01** · should · heuristic · activity · documents (`formerIds: [SAFE-MTN-01]`)
- **Titel:** Planungsunterlagen zur Wanderung
- **Meldung:** «Für «{activity}» fehlen Unterlagen für den Coach: {missing} (Kartenkopie mit Route, Marschzeitberechnung, Sicherheitskonzept).»
- **Prüfung:** Activity tagged `unternehmung`, or matching HIKE (§4). Each part separately:
  - Route: linked GPX or map document, or the text contains `route, karte, kartenausschnitt`.
  - Walking time: GPX present, or the text contains `marschzeit, zeitberechnung, marschtabelle, lkm, leistungskilometer`.
  - Safety concept: safety text ≥ param chars.
- **Quelle:** [BERG p.12] "Folgende Unterlagen musst du deinem Coach für jede Wanderung zur Verfügung stellen"; [LAGER p.23].

**LST-TREK-02** · should · heuristic · activity · documents, settings (`formerIds: [SAFE-MTN-02]`)
- SAFE-MTN-02 with the refinements from §2.3.
- **Quelle:** [BERG p.14] (Lkm, rate table, "Je anspruchsvoller …, desto mehr Reserve musst du einplanen").

**LST-TREK-03** · hint · heuristic · activity · documents, coachInputs, midata
- **Titel:** Wanderung für Kinder zu lang
- **Meldung:** «Geschätzte Marschzeit von «{activity}» {h} h. Mit Kindern sollte die effektive Wanderzeit 2–3 h nicht überschreiten.»
- **Prüfung:** GPX `estimatedMinutes` > param 180, and the Stufe is Biber/Wölfe or MiData `minAge` < 10.
- **Quelle:** [BERG p.4] "Die effektive Wanderzeit sollte deshalb nicht länger als 2 bis 3 Stunden sein".

**LST-TREK-04** · should · heuristic · activity · –
- **Titel:** Umkehrzeit / Abbruchkriterien fehlen
- **Meldung:** «Für «{activity}» sind keine Umkehrzeit oder Abbruch-/Ausweichpunkte festgehalten.»
- **Prüfung:** HIKE or MOUNTAIN hit, and the safety text lacks UMKEHR (`umkehr, umkehrzeit, umkehrpunkt, abbruch, ausstieg, ausweich, spätestens um`) and has no time pattern `\b\d{1,2}[:.]\d{2}\b` near "umkehr".
- **Quelle:** [BERG p.6] "Definiere … zum welchem Zeitpunkt ihr spätestens umkehrt"; [BERG p.15] (Sicherheitskonzept "muss … beantworten"); [MAN p.45 risk matrix: "Wann muss ich eine Aktivität abbrechen"].

**LST-TREK-05** · hint · best-practice · activity · –
- **Titel:** Wanderung mit nur einer Leitungsperson
- **Meldung:** ««{activity}» hat {n} verantwortliche Person(en). Wanderungen sollten mindestens von einem Zweierteam geleitet werden (inkl. Schlusslicht).»
- **Prüfung:** HIKE hit and `responsibleIris.length < 2`.
- **Quelle:** [BERG p.7, p.18] "sollte mindestens ein Zweierteam sein"; "Jemand des Leitungsteams muss auf jeden Fall die Rolle des Schlusslichts übernehmen".

**LST-TREK-06** · should · heuristic · activity · –
- **Titel:** Notfallausrüstung unterwegs
- **Meldung:** «Im Material von «{activity}» fehlen Notfallausrüstung: {missing} (Apotheke, J+S-Notfallblatt, Telefon/Funk).»
- **Prüfung:** HIKE or UNTERNEHMUNG hit; `materialText` + safety text checked for each of `apotheke|erste hilfe|sanität`, `notfallblatt`, `handy|natel|telefon|funk`.
- **Quelle:** [BERG p.49] "musst du die entsprechende Ausrüstung mitnehmen. Dazu gehört eine Apotheke, Kommunikationsmittel …, das J+S-Notfallblatt"; [LAGER p.37] "Eine kleine Apotheke gehört bei jeder Aktivität … in den Rucksack"; [WINTER p.27].

**LST-TREK-07** · hint · heuristic · activity · coachInputs, midata
- **Titel:** Biwak mit jüngeren Kindern
- **Meldung:** ««{activity}» ist ein Biwak/Zelttrekking. Biwaks eignen sich primär für Jugendliche.»
- **Prüfung:** BIWAK hit, and the Stufe is Biber/Wölfe or `minAge` < 10.
- **Quelle:** [BERG p.43].

**LST-TREK-08** · hint · unverified · camp · –
- **Titel:** Velo-/Inline-Unternehmung: Vorbereitung
- **Meldung:** «Im Lager ist eine Velo-/Inline-Tour geplant. Vorher Fahrfähigkeiten testen, Fahrzeuge prüfen, Gruppenregeln besprechen.»
- **Prüfung:** BIKE hit, and no entry before it with `velocheck, fahrtest, veloparcours, reparatur`.
- **Quelle:** [LAGER p.11] "Vor dem Lager müssen die Fahrfähigkeiten … getestet werden" (2014).

### 3.5 Module `lst-berg`

**LST-BERG-01** · should · heuristic · activity · documents
- **Titel:** Tour ausserhalb Lagersport/Trekking
- **Meldung:** ««{activity}» enthält «{term}». Touren ab T4 (Alpinwandern, weiss-blau-weiss) oder mit alpinen Sicherungsmitteln (Seil, Anseilgurt) liegen ausserhalb von LS/T (ggf. EBB A Bergsport).»
- **Prüfung:** ALPINE list (§4) matches text or material, or the regex `\bT\s?[4-6]\b`.
- **Quelle:** [BERG p.10–11] "T4 – Alpinwandern … Ausserhalb von Lagersport/Trekking"; [BERG p.31] "dann befindet sich deine Tour eindeutig nicht mehr im Bereich von LS/T".

**LST-BERG-02** · hint · verified · activity · coachInputs, midata
- **Titel:** T3-Route mit Kindern
- **Meldung:** ««{activity}» ist als T3 angegeben. T3 ist gemäss SAC-Skala (J+S) nur für Jugendliche geeignet.»
- **Prüfung:** Regex `\bT\s?3\b`, and the Stufe is Biber/Wölfe or `minAge` < 10.
- **Quelle:** [BERG p.10] (table T3 "Geeignet für: Jugendliche"); this is a recommendation, hence `hint`.

**LST-BERG-03** · should · heuristic · camp · midata, activityTags (`formerIds: [SAFE-MTN-03]`)
- **Titel:** Sicherheitsbereich Berg ohne Anerkennung
- **Meldung:** «Aktivitäten im Sicherheitsbereich Berg geplant ({list}), aber niemand im Leitungsteam hat das Modul Sicherheitsbereich Berg.»
- **Prüfung:** Some activity is tagged `sb-berg` or has a T3/ALPINE hit, and MiData `berg` `validLeaders` = 0. Skip if `qualificationsReadable === false`.
- **Quelle:** [BERG p.2] "Für Aktivitäten im Sicherheitsbereich ist es obligatorisch"; [LAGER p.11].

**LST-BERG-04** · should · heuristic · activity · –
- **Titel:** Rekognoszierung der Wanderung
- **Meldung:** «Für «{activity}» ist keine Rekognoszierung festgehalten. Wanderungen in alpinen/voralpinen Gebieten, im Jura und im Ausland müssen rekognosziert werden.»
- **Prüfung:** HIKE hit, coach input `region` ∈ {voralpen, alpen, jura, ausland} (or not set, then `hint`), and no `reko, rekognos, erkundet` in any text.
- **Quelle:** [BERG p.13]; [WASSER p.6]; [WINTER p.11].

**LST-BERG-05** · hint · heuristic · activity · –
- **Titel:** Gewitterrisiko am Nachmittag
- **Meldung:** ««{activity}» (Berg/Wasser) endet um {end} im Sommer. Gewitter treten meist nachmittags auf – rechtzeitige Rückkehr und Abbruchkriterium planen.»
- **Prüfung:** MOUNTAIN/WATER hit, entry in June–September ending after param 16:00, and no `gewitter` in the safety text.
- **Quelle:** [BERG p.6, p.33] "Bei Gewitterneigung muss die Tour rechtzeitig beendet werden"; [WASSER p.36].

**LST-BERG-06** · hint · heuristic · activity · documents
- **Titel:** Altschnee / Schneefall möglich
- **Meldung:** «Höchster Punkt von «{activity}» {m} m ü. M. im {month}. Mit Altschnee bzw. Schneefall rechnen; Variante bei Nebel/Schnee planen.»
- **Prüfung:** GPX `highestPoint` > 2000 and month Mar–Jun; or > 1000 and month Apr/May/Oct/Nov; and no `schnee`/`nebel` in the text.
- **Quelle:** [BERG p.6, p.33].

### 3.6 Module `lst-wasser`

**LST-WASSER-01** · should · heuristic · activity · – (part of the SAFE-WATER-01 refinement; `formerIds: [SAFE-WATER-01]`)
- See §2.3.
- **Quelle:** [WASSER p.18] "muss auch beim freien Spielen eine Leitungsperson gegenwärtig sein".

**LST-WASSER-02** · should · heuristic · activity · –
- **Titel:** Wildwasser über Grad II
- **Meldung:** ««{activity}» ({term}): In LS/T finden Wasseraktivitäten nur in Wildwasser I und II statt; ab Grad III ist River Rafting von J+S ausgeschlossen.»
- **Prüfung:** Regex `(ww|wildwasser)\s*(iii|iv|v|vi|[3-6])`, or `rafting|river rafting` without "EBB".
- **Quelle:** [WASSER p.8]; [EBB-C p.1].

**LST-WASSER-03** · should · heuristic · activity · –
- **Titel:** Nur offene, unsinkbare Boote
- **Meldung:** ««{activity}» erwähnt «{term}». In LS/T sind nur offene und unsinkbare Boote zulässig (keine geschlossenen Kajaks/Spritzdecke).»
- **Prüfung:** CLOSED_BOAT list: `spritzdecke, eskimorolle, wildwasserkajak, geschlossenes kajak`.
- **Quelle:** [WASSER p.22].

**LST-WASSER-04** · hint · verified · activity · –
- **Titel:** Floss: Bewilligung und Uferzone
- **Meldung:** «Floss bei «{activity}»: Flösse ab 2,50 m Länge brauchen eine Bewilligung des kantonalen Schifffahrtsamts; auf Seen nur in der Uferzone (150 m).»
- **Prüfung:** FLOSS hit, and the text lacks `bewilligung, schifffahrtsamt, 2,5, 2.5, uferzone`.
- **Quelle:** [WASSER p.23] (VKS-Richtlinie Nr. 140); [WASSER p.20].

**LST-WASSER-05** · should · unverified · camp · midata, coachInputs (`formerIds: [BP-WATER-01]` for the raft/canoe case)
- **Titel:** Floss-/Kanulager: Wasser-Qualifikationen
- **Meldung:** «Floss-/Kanuaktivitäten geplant. Nötig: mind. 1 Person mit Zusatz Sicherheitsbereich Wasser ({sb}/1) und 1 SLRG-Brevet See/Fluss pro 12 TN ({slrg}/{need}) plus 1 Person mit BLS/AED.»
- **Prüfung:** BOAT/FLOSS hit, `need = ceil(participants/12)`; MiData `wasser` and `slrg` counts. The BLS/AED key is missing today, so it is only mentioned in the message.
- **Quelle:** [LAGER p.11] (2014, so `unverified`).

**LST-WASSER-06** · should · heuristic · activity · –
- **Titel:** Bachtrekking: Pflichtpunkte
- **Meldung:** «Für das Bachtrekking «{activity}» fehlen in den Sicherheitsüberlegungen: {missing} (Wetterbericht, Ausstiegsmöglichkeiten, Rekognoszierung, Kraftwerk/Schwall).»
- **Prüfung:** BACHTREKKING hit. Keyword groups: `wetter|meteo|gewitter`, `ausstieg|abbruch`, `reko|rekognos`, `kraftwerk|schwall|wasserstand`.
- **Quelle:** [WASSER p.13] "Es ist daher Pflicht, vor jedem Bachtrekking den Wetterbericht einzuholen"; [WASSER p.15] (Kraftwerk "müssen"); [WASSER p.16] "Erst wenn eine klare Planung vorliegt und die Rekognoszierung durchgeführt wurde".

**LST-WASSER-07** · should · heuristic · activity · –
- **Titel:** Seeschwimmen ohne Begleitboot
- **Meldung:** «Bei «{activity}» (Strecke im See) muss mindestens eine Leitungsperson die Gruppe im Boot oder mit Rettungsbrett begleiten.»
- **Prüfung:** LAKE_SWIM hit (`seeüberquerung, seequerung, streckenschwimmen, see schwimmen, über den see`), and the text lacks `begleitboot, boot, rettungsbrett, sup`.
- **Quelle:** [WASSER p.19].

**LST-WASSER-08** · hint · heuristic · activity · –
- **Titel:** Springen ins Freigewässer
- **Meldung:** ««{activity}» erwähnt Springen. Vom Springen in Freigewässer wird abgeraten; falls doch: Kriterien (klares, tiefes Wasser, keine Felsblöcke, umgehbar) festhalten.»
- **Prüfung:** WATER hit together with `spring, sprung, klippensprung, brückensprung`.
- **Quelle:** [WASSER p.36].

**LST-WASSER-09** · should · heuristic · activity · –
- **Titel:** Angeseilt im Fluss
- **Meldung:** ««{activity}» kombiniert Seil und Fliessgewässer. Man darf sich nie angeseilt in einen Fluss begeben; Boote nie mit Leinen verbinden.»
- **Prüfung:** River words (`fluss, bach, aare, reuss, rhein, flussfahrt`) together with `anseil, angeseilt, seilsicherung, boote verbinden, zusammengebunden`.
- **Quelle:** [WASSER p.35, p.21].

**LST-WASSER-10** · hint · heuristic · activity · –
- **Titel:** Apotheke für Wasseraktivitäten
- **Meldung:** «Für «{activity}» fehlen in Material/Sicherheit Rettungsfolie bzw. Wärmekissen.»
- **Prüfung:** WATER hit (not pool), and the text lacks `rettungsfolie, rettungsdecke, wärmekissen`.
- **Quelle:** [WASSER p.33] "gehören Rettungsfolien und Gel-Wärmekissen unbedingt dazu".

### 3.7 Module `lst-winter`

**LST-WINTER-01** · should · heuristic · camp · midata, campConfig, activityTags
- **Titel:** Modul Sicherheitsbereich Winter erforderlich
- **Meldung:** «Geplant: {list}. Dafür muss im Leitungsteam jemand das J+S-Modul Sicherheitsbereich Winter haben – aktuell niemand.»
- **Prüfung:** The camp falls in winter months (param Nov–Apr) or the Winter module is on. Trigger if any holds:
  - coach `winterSafeAccess = false`;
  - an activity tagged `sb-winter`;
  - SNOWSHOE hit with GPX > param 3 h or an "anspruchsvoll" tag;
  - BIWAK hit plus "kein Lagerhaus" (coach `campForm ≠ haus`) or `winterSafeAccess = false`.
  
  Then fire if MiData `winter` `validLeaders` = 0.
- **Quelle:** [WINTER p.2] "Für folgende Aktivitäten ist das genannte Modul allerdings obligatorisch: Lager in abgelegenen Gebieten ohne wintersichere Zufahrt; Biwakübernachtungen ohne Lagerhaus und ohne wintersichere Zufahrt; Anspruchsvolle Schneeschuhwanderungen"; [BERG p.6] "Für Wanderungen im Winter gelten die Bestimmungen des Sicherheitsbereichs Winter"; [LAGER p.14].

**LST-WINTER-02** · should · heuristic · activity · –
- **Titel:** Winterwanderung: fünf Grundregeln
- **Meldung:** «In den Sicherheitsüberlegungen zu «{activity}» fehlen Bezüge zu den fünf Grundregeln: {missing} (Hangneigung < 30°, Lawinenbulletin Stufe 1–2, unter 1800 m, 3×3, Ausweichvariante).»
- **Prüfung:** SNOWSHOE/WINTERHIKE hit. Keyword groups: `hang|neigung|30°`, `lawinenbulletin|lawinen|slf|gefahrenstufe`, `1800|höhe`, `3x3|3×3`, `ausweich|variante|plan b`.
- **Severity:** `should` and not `must`: the brochure frames the rules as "empfehlen wir dir, … strikt einzuhalten" [WINTER p.2], although p.14 has a mandatory yes-list.
- **Quelle:** [WINTER p.10–11, p.14].

**LST-WINTER-03** · should · heuristic · activity · documents
- **Titel:** Winterwanderung über 1800 m
- **Meldung:** «Höchster Punkt von «{activity}» {m} m ü. M. – Winteraktivitäten unterhalb von 1800 m halten.»
- **Prüfung:** SNOWSHOE/WINTERHIKE hit in winter months and GPX `highestPoint` > param 1800.
- **Quelle:** [WINTER p.11] Grundregel 3.

**LST-WINTER-04** · should · heuristic · activity · –
- **Titel:** Schlittel-/Gleitpiste: Sicherheit
- **Meldung:** «Für «{activity}» fehlen: {missing} (Pistentest durch Leitende, Sicherheitszone/Auslauf, Aufsicht an Start/Auslauf, Helm).»
- **Prüfung:** SLED hit. Keyword groups: `test|getestet`, `sicherheitszone|auslauf`, `aufsicht|posten|start`, `helm`. Plus `responsibleIris < 2` → missing "Aufsicht".
- **Quelle:** [WINTER p.19] "Die Piste muss vom Leitenden getestet werden, bevor sie … frei gegeben wird"; "Das Helmtragen wird sehr empfohlen".

**LST-WINTER-05** · hint · heuristic · scheduleEntry · –
- **Titel:** Outdoor-Aktivität nach Einbruch der Dunkelheit
- **Meldung:** ««{activity}» endet um {end}, Sonnenuntergang ca. {sunset}. Im Winter sind die Tage kurz.»
- **Prüfung:** OUTDOOR/HIKE/SNOWSHOE hit in winter months; end time later than the parameterised sunset table (CH at about 46.8° N, monthly values) plus 15 min. Night sledging additionally triggers "nur bei genügender Sicht".
- **Quelle:** [WINTER p.20, p.27]; [WINTER p.19] (night runs).

**LST-WINTER-06** · hint · verified · activity · –
- **Titel:** Zeit- und Ortsplan hinterlegen
- **Meldung:** «Für «{activity}» ist keine Rückmeldezeit / Vertrauensperson mit Zeit- und Ortsplan festgehalten.»
- **Prüfung:** SNOWSHOE/BIWAK/HIKE hit in winter, and the text lacks `rückmeld, vertrauensperson, kontaktperson, zeitplan, zurückmelden`.
- **Quelle:** [WINTER p.27] "Hinterlege bei einer Vertrauensperson einen Zeit- und Ortsplan …"; [BERG p.16] (coach informed).

### 3.8 Module `lst-ebb`

**LST-EBB-01** · should · heuristic · activity · activityTags
- **Titel:** Ergänzender Bewegungsblock nicht gekennzeichnet
- **Meldung:** ««{activity}» ist vermutlich ein EBB {A|B} («{term}»). EBB müssen im Grobprogramm klar gekennzeichnet sein – inkl. J+S-Sportart (EBB A) bzw. Anbieter (EBB B).»
- **Prüfung:** EBB_A or EBB_B hit (or tag), and the title does not contain `ebb`.
- **Quelle:** [EBB-L p.1] "EBB sind im Grobprogramm klar gekennzeichnet"; [EBB-L p.2] (example «EBB ‹J+S-Skifahren› – LS Pistenmorgen», «EBB ‹Firma Musterseil› – LS Seilpark»).

**LST-EBB-02** · should · heuristic · activity · activityTags
- **Titel:** EBB ohne Sicherheitsüberlegungen
- **Meldung:** «Für den EBB «{activity}» fehlen dokumentierte Sicherheitsüberlegungen{detail}.»
- **Prüfung:**
  - EBB A: safety text empty.
  - EBB B: safety text empty, or lacking the groups `instruktion|einführung|briefing`, `begleit|betreu|aufsicht`, `anbieter|geprüft|seriös`, `fähigkeit|gruppe`. Missing groups go into `{detail}`.
- **Quelle:** [EBB-C p.2; EBB-L p.2] "sind zu dokumentieren und einzuhalten … Prüfung Anbieter …"; failing the checklist means "kann die Aktivität nicht bewilligt werden".

**LST-EBB-03** · hint · verified · activity · activityTags
- **Titel:** EBB A: Prüfung durch Sportart-Coach
- **Meldung:** ««{activity}» ist ein EBB A ({sport}). Ein LS/T-Coach kann die Aktivität nicht prüfen; Leitende mit Anerkennung der Sportart und ggf. Coach/Expert*in dieser Sportart nötig.»
- **Prüfung:** Tag `ebb-a` or EBB_A hit, and MiData has no matching sport key. Today that is always true for sports other than `slrg`/`berg`.
- **Quelle:** [EBB-C p.2] "nicht durch eine*n J+S-Lagersport/Trekking-Coach geprüft werden kann"; [EBB-L p.2].

### 3.9 Module `pbs`

**PBS-METH-01** · hint · unverified · camp · activityTags
- **Titel:** Pfadimethoden und Beziehungen
- **Meldung:** «Für folgende Pfadi-Methoden/Beziehungen ist kein Programmpunkt erkennbar: {list}. Ein Pfadilager, das alle 8 Methoden und 5 Beziehungen berücksichtigt, erfüllt die J+S-Vorgabe der Erscheinungsformen.»
- **Prüfung:** Keyword or tag mapping of the PBS method and relationship terms (list from the Pfadiprofil, not in the corpus, so `unverified`).
- **Quelle:** [PBS27 slides 3, 5, 7].

Plus the moved BP-*, CMP-PROG-01 and the milestones.

### 3.10 Coach checklist (binding, not checkable from data)

Shown as a per-camp checklist; the coach ticks items off and they feed the report.

| # | Item | Source |
|---|---|---|
| 1 | EBB: clarify with the camp leadership whether EBB are planned; coach informed | EBB-C p.1; EBB-L p.1 |
| 2 | EBB A: rules of the sport (Leitfaden, Manual, MB-Unfallprävention, control rules) met; extra coach/expert organised | EBB-C p.2; EBB-L p.2 |
| 3 | EBB B: provider reputable, qualified, with safety standards (checked and documented) | EBB-C p.2; EBB-L p.2 |
| 4 | When in doubt, the EBB is not carried out | EBB-L p.2 |
| 5 | Sicherheitsbereich Berg/Wasser/Winter: J+S expert LS/T consulted where required | LAGER p.4 (2014, check against the Merkblatt) |
| 6 | Responsible leader has mountain experience for demanding hikes | BERG p.7 |
| 7 | Bivouac outside federal hunting ban areas and protected areas; Wildruhezonen checked | BERG p.44; WINTER p.18; MAN p.61 |
| 8 | Hut overnight: self-catering agreed with the hut warden | BERG p.44 |
| 9 | Stove practised before the Unternehmung; never cook in the tent; above the tree line use a stove | BERG p.40 |
| 10 | Raft ≥ 2.5 m: permit from the cantonal navigation office | WASSER p.23 |
| 11 | Stream below a power plant: operator informed | WASSER p.15 |
| 12 | Cantonal water rules and protected-area signs observed | WASSER p.9 |
| 13 | Tent camp: flood, rockfall, debris-flow and storm hazards discussed with the landowner; decided with club leadership and coach | LAGER p.13 |
| 14 | Written rental contract signed by adults | LAGER p.13 |
| 15 | Camp rules cover the 5 mandatory areas; consequences without lasting harm | LAGER p.32–33 |
| 16 | Mixed camps: separate showers and changing areas; several leaders present; only medical professionals examine the intimate area | LAGER p.33, p.36 |
| 17 | Only the "Sanität" leader hands out medicine; prescribed medication not stopped | LAGER p.38 |
| 18 | Participant info sheets confidential and destroyed after the camp | LAGER p.27 |
| 19 | Drinks available at all times; drinking water quality | LAGER p.34–35 |
| 20 | Accidents and illnesses needing a doctor reported to parents; crisis team informed when emergency services are involved | LAGER p.38–39 |
| 21 | Rega report for all participants (coach) | LAGER p.23 (process with NDS today?); MAN p.45 |
| 22 | Leihmaterial: check on receipt and report defects within 1 working day; delivery site reachable by truck | PBS27 slide 16 |
| 23 | Material ordered through the coach; contact person on the order; camp leadership liable | LAGER p.24 |
| 24 | Attendance list (AWK) kept; activity plan kept for 5 years | MAN p.17 |
| 25 | Ethics charter observed; no tobacco or alcohol during sport | MAN p.9, p.16 |
| 26 | Nothilfekurs before the modules "Lager hauptleiten" and "Sicherheitsbereich" (relevant when planning training) | GST p.2 |
| 27 | Winter: questions answered with "Ja" before every hike (responsibility, experience, conditions, alternative) | WINTER p.14 |
| 28 | Safety concept for a demanding hike discussed in the team and given to all leaders in writing | BERG p.16 |

---

## 4. Keyword lists (German, as pack data)

Syntax as today: stem = token contains; `=` exact (+e/en/n/s); `^` prefix; `$` suffix; `!` exclusion prefix. New: `"…"` phrase.

**UNTERNEHMUNG** (lst-trekking)
- `wanderung, wandern, ^wanderlager, hike, hajk, haik, ^velotour, ^radtour, ^fahrradtour, schnitzeljagd, postenlauf, ^flusswanderung, ^bachtrekking, ^schneeschuhtour, ^schneeschuhwanderung, ausflug, ^tagesausflug, unternehmung, trekking, ^zelttrekking, ^sternwanderung, "unterwegs sein", ^etappe, ^pilger`
- `"OL"`/`orientierungslauf` only when the location differs from the camp site.
- Excludes: `!wanderweg-schild`. Source: TOOL-V; MAN p.26; TOOL-G slide 2; BERG p.3.

**HIKE** (berg/trekking): UNTERNEHMUNG ∩ walking: `wanderung, wandern, hike, hajk, haik, ^bergwanderung, ^gipfel, ^tageswanderung, marsch, ^nachtwanderung, ^bachtrekking, ^schneeschuh`.

**MOUNTAIN** (extends the base list):
- `+ bergtour, ^bergwander, gipfel, grat, =pass, ^passübergang, sac, =hütte, ^berghütte, ^alp, aufstieg, abstieg, ^schrofen, ^geröll, ^schneefeld`

**ALPINE** (out of LS/T): `alpinwander, "weiss-blau-weiss", gletscher, firn, klettersteig, ^via ferrata, steigeisen, pickel, ^anseilen, angeseilt, klettergurt, anseilgurt, hochtour, =t4, =t5, =t6` (BERG p.8–11, p.31).

**WATER** (extends the base list):
- `+ ^seeüberquer, ^streckenschwimm, ^flussschwimm, ^bachtrekking, floss, flösse, ^kanadier, ^schlauchboot, =raft, sup, ^stand-up, ^wasserspiel, ^staudamm, ^dämme, ^planschen, =freibad, =hallenbad, =strandbad, =seebad`
- Classes:
  - `POOL` = `hallenbad, freibad, erlebnisbad, badi, schwimmbad`
  - `RIVER` = `fluss, bach, =aare, =reuss, =rhein, =limmat, =emme, ^flussfahrt`
  - `LAKE` = `=see, $see, weiher`
  - `FLOSS` = `floss, flösse, ^flossbau`
  - `BOAT` = `kanu, kanadier, kajak, boot, raft, sup`
  - `BACHTREKKING` = `bachtrekking, flusstrekking, ^bachwanderung, schlucht`
- Excludes (as today): `+ !seepferdchen, !seele`. Source: WASSER p.6–23; MAN p.31.

**WINTER**: `schnee, ^schneeschuh, iglu, ^schneehöhle, quinzhee, ^schneebiwak, ^winterwander, schlitteln, schlitten, ^bob, airboard, ^lawine, ^schneeburg, ^schneeskulptur, ^schneeball, ^wintercamp, ^winterlager` (WINTER p.2–20).
- `SNOWSHOE` = `^schneeschuh, ^winterwander`
- `SLED` = `schlitteln, schlitten, ^bob, airboard, ^gleiten, ^schlittelpiste`

**BIWAK**: `biwak, bivouac, ^blachenzelt, "übernachtung draussen", ^zelttrekking, ^iglunacht, "unter freiem himmel"` (BERG p.42–44).

**ROPE** (fixed): `seil, pionier, abseil, hochseil, "flying fox", flyingfox, ^seilbrücke, ^seilbahn, ^pionierbau, =knoten` · excludes `!seilziehen, !seilspringen, !seilspiel, !seilpark` (seilpark goes to EBB B).

**FIRE**: `=feuer, ^feuerstelle, ^lagerfeuer, bräteln, ^grill, ^kochen über, ^feuerschale, =glut, ^feuer machen, ^feuer entfachen` · excludes `!feuerwehr, !feuerwerk` (MAN p.61, p.66).

**BIKE**: `velo, fahrrad, ^radtour, bike, inline, skates, ^trotti` (`trotti` alone with "abfahrt" → EBB B).

**EBB_A** (EBB-C/L p.1 table):
- Schneesport: `ski, ^skifahr, ^pistenmorgen, =piste, snowboard, biathlon, ^skispring`
- Bergsport: `sportklettern, kletterhalle, ^bergsteig, hochtour, skitour`
- Wasser: `^kanusport, rettungsschwimm, ^schwimmtraining, ^schwimmkurs, rudern, segeln, windsurf, wasserball, wasserspring, ^wasserfahren, pontonier, triathlon, ^synchronschwimm`
- Pferd: `reiten, voltige, pferd`
- Schiessen: `armbrust, bogenschiess, luftgewehr, ^gewehr, pistole, sportschiess`

Excludes `!skilift-spiel`. ⚠ Conflict: canoe, swimming and bathing (see §6). `kanu` and `baden` stay in WATER (LS/T), not EBB A.

**EBB_B**: `seilpark, hochseilgarten, kletterpark, ^sommerrodel, rodelbahn, ^trottinett-abfahrt, trottiabfahrt, "river rafting", rafting, ^lasertag, ^trampolinhalle, ^bowling? (no, not a sport block), anbieter, ^eintritt` (EBB-C/L p.1 "weitere").
- `anbieter` and `eintritt` act only as a booster combined with a sport word.

**EXCLUDED** (SpoFöV Art. 6 Abs. 2): `canyoning, bungee, ^gleitschirm, paragliding, deltaseg, fallschirm, tandemflug, motocross, ^go-kart, =kart, quad, ^motorboot, jetski, boxen, kickbox, thaibox, =mma, "wildwasser iii", "ww iii", "ww 3", "wildwasser 3"` · excludes `!boxenstopp, !kartenlesen, !karte, !kartoffel`.

**PASSIVE** (not a J+S activity, TOOL-V flip cards): `=film, kino, ^filmabend, ^singen, ^singabend, ^liederabend, basteln, bastel, jass, ^brettspiel, ^gesellschaftsspiel, quiz, vortrag, ^vorlesen, ^gottesdienst, siesta, nachtruhe, ^znacht, ^zmittag, ^zmorge, ^znüni, ^zvieri, ämtli, abwasch, duschen, höck, ^leiterhöck, packen` · `"knoten am tisch"`.

**MOVEMENT** (cancels PASSIVE): `spiel, lauf, rennen, stafette, ^geländespiel, sport, turnier, tanz, bauen, ^lagerbau, wanderung, ^postenlauf, ^fangis, ^versteck`.

**SCHLECHTWETTER_PHRASES** (extended): `+ sw-variante, schlechtwettervariante, regenalternative, indoor-variante, ausweichprogramm, "bei nässe", "falls es regnet", "plan b"`.

**WARMUP** (lst): today's list `+ einleitung, einstieg, ^einstimmen, ^aufwärmspiel, mobilisation, "warm machen"`.

**Erscheinungsformen** (TOOL-G slides 1–6; MAN p.26–27):
- **EF1** Outdoor-/Lagerbautechniken: `biwak, iglu, seil, knoten, ^seilbrücke, ^seilbahn, abseil, ^lagerbau, ^aufbau, ^abbau, pionier, ^feuer, ^werkzeug, morsen, ^übermittlung, "erste hilfe", ^unfallorganisation, ^alarmierung, zelt, blache, sarasani`
- **EF2** Sicher unterwegs: `wanderung, ^velotour, ^fahrradtour, schatzsuche, bachtrekking, orientierungslauf, =ol, kompass, karte, ^kartenlesen, gps, ^höhenmesser, kroki, ^krokier, route, ^streckenplanung, ^rucksack packen, unternehmung, ^risikobeurteilung`
- **EF3** Spiel und Sport: `geländespiel, ^spielturnier, turnier, olympiade, stafette, ^sportblock, volleyball, alaskaball, ^hindernisparcours, ^fangis, ^ballspiel, ^spiele entwickeln`
- **EF4** Bedürfnisse/Ideen: `sinnesparcours, achtsamkeit, ^prävention, ^grenzen, ^gesundheit, ^mitbestimmung, atelier, ^wunschprogramm, ^lagerparlament, theater`
- **EF5** Gemeinschaft: `^gruppenchallenge, ^kommunikationsspiel, kooperation, ^lagerregeln, fairplay, "fair-play", inklusion, diversität, toleranz, ^teamspiel, ^vertrauensspiel`
- **EF6** Natur/Umwelt: `upcycling, recycling, ^waldexkursion, flora, fauna, ^wetterkunde, ^sternkunde, sterne, ^nachhaltig, insekten, ^kleinstruktur, ^aufräumaktion, "clean walk", naturschutz, ^tierspuren, ^pflanzen`

**UMKEHR**, **NOTFALL** (`notfall, notfallblatt, notfallnummer, =144, =1414, =117, =118, =112, rega, alarmier, apotheke, sanität, spital`): `NOTFALL` is shared with docCheck.

**SUBGROUP**: see LST-ACT-02.

---

## 5. Changes for 2027 (validFrom / validTo)

| Date | Rule | Change | Source |
|---|---|---|---|
| 2026-12-31 (validTo) | JS-FREE-01 | retired (days without J+S are allowed) | TOOL-V |
| 2026-12-31 | JS-DAY-03 | 30-minute gap rule ends (no 2027 source) | – (only L) |
| 2026-12-31 | JS-CAMP-01 (calendar-day variant), JS-DAY-01/-04 (≥ 2-unit variant) | replaced by the J+S-day variant | TOOL-V; MAN p.21 |
| 2026-12-31 (provisional) | CMP-LA-01 | LA concept missing from 2027 sources | MAN p.21; open |
| 2027-01-01 | JS-CAMP-01 v2 | ≥ 4 consecutive J+S days, or ≥ 3 with an offer partner | TOOL-V; MAN p.21; PBS27 slide 6 |
| 2027-01-01 | JS-DAY-01 v2 | should, "zählt nicht als J+S-Tag" | TOOL-V |
| 2027-01-01 | JS-DAY-06 (new) | ≥ 2 times of day | MAN p.21; TOOL-V; PBS27 slide 7 |
| 2027-01-01 | JS-BWZ-27 | hint/unverified → **must/verified**, ≥ 120 min per J+S day | MAN p.21; TOOL-V; PBS27 slide 6 |
| 2027-01-01 | JS-BWZ-02 (new) | per activity ≥ 30 min, 15-minute steps | TOOL-V |
| 2027-01-01 | LST-ACT-01/-02, LST-ANG-01/-02 | new LS/T model (aktiv/bewegungsorientiert, für alle, Unternehmung, EF) | MAN p.21; TOOL-V; PBS27 slides 5, 7 |
| 2027-01-01 | JS-CAMP-02 / JS-AGE-01 | target groups merged: 5–20, one recognition; threshold 12 unchanged | PBS27 slide 9 |
| 2027-01-01 | MiData mapping | "LS/T Kinder" and "LS/T Jugendliche" both → `leiterLsT` (label "J+S-Leiter*in Lagersport/Trekking") | PBS27 slide 9 |
| from 2026-01-01 (status 12/2025) | LST-EBB-* | EBB checklists apply now; EBB counts toward the 4 hours | EBB-C/L p.1 |
| no change | JS-DL-03 Leihmaterial 35 days | confirmed "strikte 5 Wochen" | PBS27 slide 16 |

**Pack versions:**
- `2026.2.0`: citations and refinements; current rules keep `validTo 2026-12-31`.
- `2027.1.0`: the new rules above. Both come from the same pack data; the engine selects by camp start.

---

## 6. Open questions and conflicts between sources

1. **"Jeder Lagertag ≥ 4 h" vs. "Tag ohne J+S möglich".** MAN p.21 and PBS27 slide 6 say each camp day has ≥ 4 h. TOOL-V allows days without J+S activities as long as the minimum number of J+S days holds. Proposal: TOOL-V is newer and more precise, so JS-DAY-01 becomes `should`. Needs confirmation.
2. **Does a free day break the run of consecutive J+S days?** TOOL-V requires "4 aufeinanderfolgende J+S-Tage" and also allows free days. If a free day in the middle splits the run, a 5-day camp with a free day 3 fails. Ask J+S or BASPO.
3. **Combined first/last day:** does the combined day also need ≥ 120 min of movement time? TOOL-V is silent. The TOOL-V example (3 h + 1½ h) shows "ergibt 4 Stunden" means ≥ 4 h.
4. **Time-of-day boundaries** (Morgen/Nachmittag/Abend) are not defined [MAN p.21; TOOL-V]. Is the rule per day or per camp? (TOOL-V places it in the J+S-day paragraph.) Proposal: param plus lenient overlap counting.
5. **30-minute gap (Sozialzeit)** (JS-DAY-03): no source in the corpus. Check jugendundsport.ch/de/lager or the Leitfaden.
6. **NDS deadlines:** LAGER p.23 (2014) ties the 30 days to the club's first camp of the year. JS-DL-02 (closing +30 days) and Landeskarten 21/35 days are not in the corpus. Verify against the Leitfaden.
7. **Leader/participant ratio** (JS-STAFF-01, 1:10) is not in the corpus. PBS27 slide 9 gives only 16+16+16 (subsidy group size). The Leitfaden (jsle.ch/dLET) is missing.
8. **The Merkblatt "Unfallprävention und Sicherheitsanforderungen in LS/T"** (jsle.ch/dMB1) is missing, although it holds the binding boundary between normal area and Sicherheitsbereich for Berg/Wasser/Winter and the list of allowed activities [MAN p.43; PBS27 slide 11; BERG p.2]. Until it is read, all SB rules stay at most `should`/`heuristic`.
9. **LS/LA in 2027:** the new sources talk only about "J+S-Aktivität" and "Bewegungszeit". LAGER p.21 (2014): "maximal zwei Stunden LA" is not implemented and not confirmed for 2026. Does eCamp keep the LA thematic areas (CMP-LA-01)? Should the mapping be reduced to J+S / not J+S?
10. **EBB A vs. regular LS/T water activities:** EBB A lists "Kanusport" and "Schwimmen" [EBB-C/L p.1]. WASSER p.6 and p.22 and LAGER p.11 treat bathing, open canoes/Kanadier and canoe camps as LS/T. Proposal: technique and sport training (Kanusport, Schwimmkurs) → EBB A; group experience in open boats or bathing → LS/T. Needs confirmation from the Merkblatt.
11. **River rafting:** EBB B lists "River Rafting-Tour" with a provider. Excluded from WW III. WASSER p.8 allows LS/T only in WW I–II. A provider tour on WW I–II = EBB B, from WW III = excluded. Check confirmation.
12. **2014 brochures** (LAGER, BERG): module names ("Modul Lagerleiter LS/T", "Zusatz SB Berg"), SPORTdb (now NDS), expert requirements (LAGER p.4), Voilà, "alpine Wanderrouten" (LAGER p.11, undefined) and the raft/canoe SLRG ratio 1:12 (LAGER p.11) may be outdated. All are `unverified` until checked against the Merkblatt or Leitfaden.
13. **Winter basic rules:** WINTER p.2 calls them a recommendation ("empfehlen … strikt einzuhalten"), yet they decide when the module is mandatory ("Anspruchsvolle Schneeschuhwanderungen (fünf Grundregeln)"). It is unclear whether a hike that breaks the rules is allowed with the module or forbidden.
14. **Wildwasser I–II** [WASSER p.8] is worded descriptively, without "nur". Treated as the scope limit.
15. **Movement-time example** in TOOL-V (3 h Schnitzeljagd with 6×5 min running = 1.5 h) does not add up. Do not use it as a test fixture.
16. **Offer-level rules** (≥ 4-day camp, Unternehmung, all EF) need knowledge of other camps in the same offer. Today this is only possible via coach input; later perhaps via NDS `offerBusinessId` (several camps).
17. **Validity of the new model:** the Manual has been available since 16.10.2026 [PBS27 slide 4], TOOL-V was updated 15.10.2026, and PBS27 is titled "Neuigkeiten 2027". Only the target-group merger has an explicit date of 1.1.2027 [PBS27 slide 9]. Assumption: the whole new model applies from 2027-01-01. Confirm.
18. **Rega number:** WINTER p.27 gives 1414 (Valais 144), BERG p.46 gives 112. Extend docCheck `EMERGENCY_NUMBERS` with 112.
19. **Gender-based recommendations** (BERG p.7; LAGER p.5, p.33) need red-zone gender data. Per CLAUDE.md never via AI; even locally, only as a coach checklist item, never a rule.
20. **Nothilfekurs** [GST p.2] is a prerequisite for modules, not a camp rule. Concluding that SB leaders hold a Nothilfekurs is an inference only. Add MiData key `nothilfe` only for the qualification overview.
21. **PBS 8 methods / 5 relationships** [PBS27 slide 5]: the term list comes from the Pfadiprofil, which is not in the corpus.
22. **MAN page numbering:** the extractor notes say "printed = PDF + 1"; the verifier found PDF index = printed. The `S.` citations above follow the verified printed numbers.

---

# Review corrections

I checked the catalog against the extractions and re-opened three sources with pdftotext: MAN PDF pp. 21, 22 and 31, and WASSER PDF p. 10.

## A. Spot checks against the source PDFs
- **MAN page numbering:** Fig. 4 is on PDF p. 21 and PDF p. 22 carries the printed page number "22", so PDF page = printed page. The note in the MAN extraction ("printed = PDF + 1") is wrong. The catalog's `MAN p.N` citations are correct, and §6.22 can be closed.
- **MAN p.21, times of day:** the sentence is "Die J+S-Aktivitäten werden auf mindestens zwei Tageszeiten verteilt: Morgen, Nachmittag oder Abend." It sits in the *Aktivität* block and does not say "pro Lagertag". The extractions for MAN and PBS27 slide 7 paraphrase it as "eines Lagertags", which is not in the text. In TOOL-V the sentence sits in the Lager paragraph. §6.4 stays open, and JS-DAY-06 must not cite MAN for "pro Tag".
- **MAN p.31:** says only "unter Einhaltung der entsprechenden Sicherheitsbestimmungen spezifische Aktivitätsformen anbieten". It does **not** say that bathing, dam building and so on belong to the *Sicherheitsbereich* Wasser. The extraction's key `lst-wasser-baden-sicherheitsbereich` (and the Berg/Winter equivalents) overstate this. Do not use MAN p.31 to justify SB qualification rules.
- **WASSER p.8:** "In Lagersport/Trekking finden Aktivitäten in Wildwasser I und II statt." There is no "nur", so §6.14 is right. The WASSER extraction marked this as `mandatory` with "nur"; that is wrong.

## B. Logic contradictions inside the catalog
1. **JS-BWZ-27 against JS-DAY-01.** TOOL-V defines a J+S day as ≥ 4 h J+S activities **and** ≥ 2 h movement time (Bewegungszeit). With that definition, a day under 120 min of movement time simply "does not count", the same reasoning used to downgrade JS-DAY-01.
   - Make JS-BWZ-27 `should`/verified with the message "Tag zählt nicht als J+S-Tag".
   - Leave the `must` only on the count in JS-CAMP-01.
2. **JS-CAMP-01 day test.** `computeJsDays` must test **both** 240 min J+S **and** ≥ 120 min movement time, counting only per-activity values ≥ 30 min. As written, §2.1 tests only the 240 min.
3. **EBB count toward the 4 h** [EBB-C/L p.1]. EBB-tagged or EBB-detected activities must be treated as J+S activities when computing J+S days and the times-of-day rule. Today this appears only in the §5 table, not in the engine or category model (§1.4 item 9).
4. **LST-WASSER-02 contradicts EBB B.**
   - Problem: bare `rafting` fires "ab Grad III ausgeschlossen", but a provider rafting tour on WW I–II is a permitted EBB B (EBB-C/L p.1).
   - Fix: fire only on a grade ≥ III, and send bare `rafting` to LST-EBB-01.
5. **Canyoning against Bachtrekking.**
   - Problem: EXCLUDED has `canyoning`, while BACHTREKKING has `schlucht`. BERG p.3 says Bachtrekking "inkl. Schluchten" is LS/T.
   - Fix: keep `schlucht` out of any exclusion path. Add a hint, not an exclusion, when abseiling or jumping is combined with `schlucht`.
6. **Winter module trigger catches Iglu.**
   - Problem: WINTER p.2 explicitly allows Iglu overnights, light snowshoe hikes and snow games **without** the module. BIWAK contains `^iglunacht`, and LST-WINTER-01 fires on BIWAK plus "kein Lagerhaus".
   - Fix: exclude iglu/schneehaus from that trigger.
7. **Tourist areas need a suppression path.** WINTER p.2 says that "innerhalb von Dörfern und Skigebieten, auf … Winterwanderwegen und Schneeschuhtrails" activities may deviate from the five basic rules. LST-WINTER-02 and LST-WINTER-03 need a suppression keyword or tag (`winterwanderweg`, `schneeschuhtrail`, `skigebiet`).
8. **LST-EBB-01 check is weaker than its message.** The check tests only for `ebb` in the title. EBB-L p.2 requires the J+S sport name (EBB A) or the provider name (EBB B) as well. Add a second condition: the title contains `ebb` but no sport or provider term → name what is missing.
9. **JS-DL-04 checks the wrong date.**
   - Problem: it checks the camp start, but the delivery date is not the camp start. The source also excludes public holidays, which the check ignores.
   - Fix: use a coach input `leihmaterialDeliveryDate` with a weekday and holiday check, or downgrade to heuristic.
10. **JS-CAMP-02 and JS-AGE-01 count the same thing.** Slide 9 requires 12 participants **aged 5–20**. When MiData ages exist, JS-CAMP-02 should count only participants aged 5–20. Out-of-range participants can then turn the `must` red; JS-AGE-01 then only explains why.

## C. Severity or confidence not backed by the catalog's own policy
- **JS-DL-01** stays `must`/verified on LAGER p.23 (2014) only, which breaks the stated policy.
  - Downgrade to `should`/unverified until source L or the Leitfaden is re-checked.
  - JS-DL-02 and the Landeskarten 21/35-day part of JS-DL-03 are not in the corpus either; mark them `unverified` with the source "L (nicht im Korpus)".
- **JS-STAFF-01 (1:10):** there is no binding statement in the corpus, and TOOL-V refers to the Leitfaden for the Betreuungsverhältnis. `should`/conflict over-claims; use `hint`/unverified until the Leitfaden is read.
- **2014-only binding sources labelled `heuristic`.** Per policy, these should be `unverified` (or the policy should state that heuristic ⊇ unverified):
  - LST-LAGER-01 (LAGER p.22; MAN p.45 is only "recommended")
  - LST-TREK-01, LST-TREK-02, LST-TREK-04
  - LST-BERG-01, LST-BERG-03
  - SAFE-MTN-03
- **`verified` on rules whose detection is keyword or regex based.** Per policy, verified requires a deterministic check, so these become `heuristic`:
  - LST-WASSER-04, LST-BERG-02, LST-WINTER-06, LST-EBB-03, LST-SAFE-01, JS-DL-04
- **JS-BWZ-02:** the presentation rule ("ist … in 15-Minuten-Schritten auszuweisen", MAN p.21, PBS27 slide 6) is binding, and the ≥ 30 and %15 checks are deterministic.
  - Either make those two checks `must` or record the policy exception explicitly.
  - Also, "fehlt" should not depend on the day being short. The source asks for the value on every J+S activity (MAN p.21 says "für jede J+S-Aktivität separat").
- **JS-DAY-02 (≥ 30 min per activity):** binding (MAN p.21, TOOL-V, PBS27 slide 7) and deterministic. State `must`/verified explicitly for both 2026 and 2027; the catalog leaves the severity unstated.
- **JS-DAY-06:** with undefined window boundaries and the per-day reading not settled in MAN (see A), the default should be `should`, not `must`.

## D. Dropped requirements, to add as rules or checklist items
**J+S / LS/T core**
- **Per-activity Erscheinungsformen:** each J+S activity "zielt auf die Erscheinungsformen ab" [MAN p.21; PBS27 slide 7]. Add a `hint`/heuristic when an activity matches no EF tag or keyword. This is distinct from the offer-level LST-ANG-02.
- **"sinnvoll aufgebaut" and "auf Bedürfnisse abgestimmt"** [MAN p.21; TOOL-V; PBS27 slide 7]: binding but not checkable. Add both to the coach checklist (§3.10).
- **Scope note:** the Fig. 4 rules apply to LS/T in Nutzergruppe 3 [MAN p.21 caption]. Put this in `pack.yaml` `appliesWhen` and the description.
- **Leihmaterial:** cleaned before return [MAN p.17 Tab. 2]. Add to checklist #22.
- **Lagerleitung and coach informed about all detail programmes** [LAGER p.21, mandatory]. Add to the checklist.

**Missing deadline-radar milestones** (from LAGER p.3, 4, 23, 45; all `unverified`):
- Grobprogramm to the coach 4–3 months before.
- Lagerdossier to the coach 6–4 weeks before (LAGER p.23: "muss … abgeben").
- Final participant list 4–2 weeks before.
- Attendance list (AWK) and participant list to the coach ≤ 2 weeks after.
- Lagerabrechnung ≤ 2 weeks after.
- Lawinenbulletin read daily in the week before a winter camp [WINTER p.13].

**Missing coach-checklist items**
- Whole leader team knows the club's crisis concept before the camp [LAGER p.39, "muss"].
- TN-Infoblatt filled in by all participants **and** leaders [LAGER p.27, mandatory]; #18 covers only confidentiality.
- J+S-Notfallblatt filled in before the camp and handed out to the team [LAGER p.7/31/39].
- A Sanitätsverantwortliche named [LAGER p.7].
- Boat or raft crew can swim [WASSER p.20, "muss"].
- Weirs are never run; carry around them [WASSER p.21, "dürfen nicht"].
- Bivouac above the tree line only with a bivouac bag and in safe fair weather [BERG p.42, "unbedingt"].
- If a risk cannot be reduced to an acceptable level, do not carry out the activity [BERG p.31].
- Steinschlag and Schneefeld rules [BERG p.32, "darf nicht"].
- Meeting points and times agreed for when the group spreads out [BERG p.17].
- Snowshoe groups of more than 12 split into subgroups, each led by a leader [WINTER p.16].
- Municipality of the activity site contacted [MAN p.61].
- Deputy for the Lagerleitung [LAGER p.6].

**EBB**
- Add a "Wohlergehen" keyword group to LST-EBB-02 [EBB-C/L p.2, "Massnahmen … dokumentiert"]. Also add "Gesamtverantwortung bleibt bei J+S-Leitenden" to its message.
- EBB A may also be led by someone with "einer für die Aktivität entsprechenden Ausbildung" [EBB-L p.2]. LST-EBB-03's message is too strict.

**Rule candidates**
- **Abbruch-/Absagekriterien** for every risk activity, not only hikes [MAN p.44–45 risk matrix; WASSER p.17 "bei Gewitter bricht sie ab"]. Extend LST-TREK-04 to WATER, WINTER and ROPE at `hint`.
- **Apotheke "bei jeder Aktivität und in jeder Gruppe"** [LAGER p.37, mandatory]. LST-TREK-06 limits this to hikes; add a camp-level hint or a checklist item.
- **Snowshoe activity with more than 12 participants and `responsibleIris` < ceil(n/12)** [WINTER p.16]: hint.

## E. Citation fixes
- **JS-DAY-06:** MAN p.21 does not say "pro Tag" (see A). Cite TOOL-V "Das J+S-Lager" for the per-day reading, or keep it neutral.
- **SAFE-WATER-01(c) / BP-WATER-01:** fine. But drop any reliance on MAN p.31 for a "Sicherheitsbereich Wasser includes bathing" reading.
- **LST-WASSER-02:** cite EBB-C/L p.1 for the exclusion from WW III. WASSER p.8 is descriptive (see A).
- **JS-DL-03:** split the citation per kind: Leihmaterial → PBS27 slide 16; Landeskarten → L (not in corpus); LAGER p.3 → milestone only.

## F. Gaps in the "not in corpus" list and partly read sources
- **Not in corpus**, add to the list:
  - The J+S web page "Sicherheit in Lagersport/Trekking". EBB-C/L p.1 and PBS27 slides 8 and 10 cite it as **binding** for EBB A/B classification.
  - The brochure "Lagersport/Trekking – Grundlagen". EBB-C/L p.1 uses it to define what counts as a regular LS/T activity, and LAGER p.21 uses it for LS/LA.
  - The Lernbaustein "Planung einer Wanderung" (jsle.ch/dMDQ) and the J+S Marschzeit/Marschtabelle template [MAN p.39; BERG p.12/14].
- **Partly read** (record in `sources.yaml`):
  - MAN printed pp. 46–47 (safety-management and Ampelschema graphics) and the Fig. 4 image.
  - PBS27 slides 3, 13 and 15 (graphics, video).
  - TOOL-V images (Angebot.png, Lager.png, Activites.svg).
  - TOOL-P linked modules "Sicherheit in der Planung" and "Innovieren", not fetched.
  - The cudesch "Sicherheitskonzepte" and Notfallinformationsblatt referenced on PBS27 slide 12.
- The policy statement "Several open points can only be settled with these documents" should also list the web page "Sicherheit in LS/T" for open points 10 and 11 (EBB A/B boundary, rafting).