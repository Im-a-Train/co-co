- **LST-WASSER-04 and the MiData mapping in §3.7 disagree with MB-UP S.5.** MB-UP S.5 says «Modul Wasser LS/T» and the I-Modul «Aufsichtsperson Wasser» each qualify for three settings: beaufsichtigtes Bad, unbeaufsichtigter Pool and unbeaufsichtigter See. The catalog maps both labels to `waterBath` only. Fix: map both labels to `waterBath`, `waterPoolUnsupervised` and `waterLake`. Keep «SLRG Basis Pool» / «Brevet Basis Pool» on `waterBath` only.
- **LST-WASSER-04 classifies supervised baths wrongly.** MB-UP S.5 defines «Beaufsichtigtes Bad (Hallenbad/Freibad/Seebad/Flussbad)». Today «Seebad» matches LAKE `$see` and resolves to `see`, because the strictest match wins.
  - Add `seebad`, `strandbad` and `flussbad` to POOL.
  - Make a POOL hit win over LAKE and RIVER when the term is a supervised bath.
  - Add a test: «Baden im Seebad» needs `waterBath`, not `waterLake`.
- **LST-WASSER-04 uses keyword groups that do not exist in §6.** It mentions «swimming or bathing words» and «unbeaufsichtigt» without a set. Define a set SWIM (`=baden, schwimm`) and a set UNSUPERVISED (`unbeaufsichtigt`), and list both in the rule's `keywords`.
- **The §3.3 YAML example references a param that does not exist.** It lists `params: [lst.waterSettingDefault]`, which is not in §7, so the loader would reject it. Remove it or add it to §7.
- **LST-SB-01 contradicts MB-UP S.4 on the SB Winter biwak.** MB-UP S.4 defines it as «Biwakübernachtungen, die im Zelt, **Iglu** usw. stattfinden, ohne dass ein Lagerhaus mit wintersicherer Zufahrt schnell erreicht werden kann». Correction B6 excludes IGLU, which goes against the source.
  - Trigger on BIWAK ∪ IGLU when `campForm !== 'haus'`.
  - Gate this path explicitly on `lst.winterMonths`. The current wording leaves it ambiguous, so a summer tent camp with a biwak would get «SB Winter».
  - Rewrite the test as «Iglunacht», February, `campForm: haus` → none; and with `zelt` → should.
- **The SB Berg trigger in LST-SB-01 is broader than MB-UP S.3.** The definition is «Mehrtägige Wanderungen mit Übernachtung im Biwak **oberhalb der Waldgrenze**». The third path, «BIWAK on an activity whose entries span ≥ 2 days», drops the treeline condition. Require both (multi-day and above the treeline, via GPX or phrase), or downgrade the multi-day-only path to hint.
- **The SB Winter camp case is never gated on season.** It appears in three places: the `lst-winter` onWhen trigger `winterSafeAccess === false`, LST-SB-02/03/04 (camp case) and CL-LST-04. A summer camp with `winterSafeAccess=false` would get a `must` «Sicherheitsbereich Winter». Gate the camp case on «camp overlaps `lst.winterMonths`». The trigger can only suggest the module; it switches it on only in winter months.
- **LST-WINTER-01 misses part of MB-UP S.4.** The source says «Lager im Winter finden in einem **Haus** … statt». Add a variant when `campForm ∈ {zelt, gemischt}` in winter months.
- **LST-WINTER-03 breaks the policy.** It is `should/verified`, but it selects activities by keyword (SNOWSHOE/WINTERHIKE) and suppresses by keyword (WINTER_SECURED). Policy says keyword detection means `heuristic`. Change it to `should/heuristic`, or make only `sb-winter`-tagged activities `verified`.
- **Several rules cite only a 2014 source but carry a higher confidence than allowed.** Policy allows at most «should + unverified, or lower» for LAGER/BERG-only rules. These need `confidence: unverified`, or a current source:

  | Rule | Current confidence | Only source |
  |---|---|---|
  | LST-TREK-03 | heuristic | BERG S.4 |
  | LST-TREK-07 | best-practice | BERG S.43 |
  | LST-BERG-04 | heuristic | BERG S.6, 33 |
  | LST-LAGER-06 | best-practice | LAGER S.40 |
  | CMP-DAY-01 | best-practice | LAGER S.8, 18 |
  | CMP-CAMP-01 | best-practice | LAGER S.18 |
  | BP-REST-01 | best-practice | LAGER S.18 (add [H] if PBS is the real basis) |

  Also make §11 Q14 match LST-TREK-02. Q14 calls its pace values unverified, but the rule is `should/heuristic`. Either lower the per-hit confidence to `unverified` when the default BERG pace is used, or drop LST-TREK-02 from Q14.
- **JS-BWZ-02 variant `under30` is `must` without a binding violation.** TOOL-V only says the movement time «muss **ab** einer Dauer von 30 Minuten … ausgewiesen werden». A 20-minute value is not forbidden; it just does not count. §0.3 justifies `must` only by the presentation duty, which covers `step`. Downgrade `under30` to should (or hint) and adjust §0.3 (part a).
- **JS-FREE-01 in 2027 conflicts with TOOL-V 2027 and the §0.1 decision.** TOOL-V 2027 says «Tag ohne J+S-Aktivitäten möglich, sofern die Mindestanzahl an J+S-Tagen eingehalten wird», which contradicts the LEITFADEN cap, and JS-CAMP-01's 2027 message tells the coach free days are simply skipped. Per policy (sources contradict → `conflict`):
  - For camps from 2027-01-01, cap every JS-FREE-01 hit at hint with confidence `conflict` (variant `conflict2027`), or set `validTo 2026-12-31` and add a 2027 hint variant.
  - Update the §10 row «JS-FREE-01 cap» to match.
- **The §0.3 wording contradicts itself.** It says «The `must` sits on the count (JS-CAMP-01) and the cap check (JS-FREE-01 stays `should` …)». Reword: «The `must` sits on the count (JS-CAMP-01). JS-FREE-01 stays `should`, because the sources contradict each other for even camp lengths.»
- **JS-DAY-04 has a contradiction.** It fires only when at least one end day has J+S minutes > 0, but it also says «Combined total 0 → hint». Delete the second clause: total 0 gives no finding, matching LEITFADEN «Wenn am ersten und am letzten Lagertag … keine J+S-Aktivitäten stattfinden, zählen sie nicht».
- **§3.9.6 hard-codes thresholds.** It uses `240` and `120`. Use `js.minDayMinutes` and `js.minBwzDayMinutes` (skip the BWZ condition when null).
- **The «Kategorie-Zuordnung fehlt» hint has no owning rule.** §3.9.1 says «day rules then emit one camp hint» without naming who emits it. Assign it to JS-CAMP-01 variant `noMapping` only, and have the other day rules stay silent, so the same hint is not repeated.
- **Some params have no row for every year.** «A key with no matching row is a loader error», so:
  - `js.bwzStepMinutes` needs a `null` row for 2026.
  - `js.leihmaterialOutage` needs a `null` row from 2027-01-11, or must be read only inside JS-DL-06 and the milestone.
- **JS-DL-06 has three problems.**
  - `coachInputs.leihmaterialOrdered` is a boolean that defaults to `false` (`domain/campFacts/store.ts:32`), so `!= null` is always true. Use `=== true` (or a delivery date is set).
  - `validTo 2027-01-10` misses camps starting 2027-01-11…2027-01-17, whose window (start − 7) still overlaps the outage. Set `validTo 2027-01-17`, or drop the validity and rely on the overlap check.
  - `js.leihmaterialOutage` stores the start of the outage as `from`, but the predicate prose reuses `{from}` for the camp's delivery window. Rename one of them.
- **JS-DL-05 escalates to `must` too early.** The source says «spätestens beim Abschluss des Angebots». `must` right after camp end is premature. It should be `must` only after the closing deadline (`angebot.lastActivityDate ?? end` + `js.ndsClosingDays`) or once the offer is closed in NDS. Between camp end and that deadline it should be should/hint. Add a test for that interval.
- **The JS-DL-04 holiday test does not test a holiday.** 2027-08-01 is a Sunday, so the holiday path is never exercised. Use 2027-05-06 (Auffahrt, a Thursday). The test 2027-07-05 (Monday) is correct.
- **LST-BERG-01 uses an undefined set.** It references a `T_HIGH` regex that is not in §6. Use ALPINE (it already contains `\bt\s?[4-6]\b`), or add a T_HIGH set.
- **Inline keyword terms break §3.12 (keywords out of TS).** Move them into sets:
  - LST-SB-01: `raft`, `^flussschwimm`, `^flusssurf` → e.g. SB_WASSER_EXTRA.
  - LST-WASSER-08: `schlucht` → e.g. GORGE.
  - LST-TREK-08: «inline term» → BIKE_INLINE.
  - LST-SB-01 / LST-ANG-01: the phrase «oberhalb der waldgrenze» is already in ANSPRUCHSVOLL; reference the set instead of repeating it.
- **EXCLUDED is missing «Bruchtests».** The catalog's own WEB-C citation says WEB-C «Verbotene Sportarten» lists «Bruchtests». Add `bruchtest`.
- **JS-EXCL-01's WW III exception is not cited.** The «Ausnahme im Kanusport Wildwasser gemäss Art. 3 Abs. 3 VSpoFöP» is stated literally in WEB-C «Verbotene Sportarten». Cite WEB-C for variant `ww` and shorten §11 Q12 to «content of the exception not detailed».
- **`EBB-C/L` is not a registry key.** It is cited in JS-EXCL-01 and in §3.9.1, so `sources[].key` will not resolve. Split it into `EBB-C` + `EBB-L`.
- **Two rules have no source.** CMP-MD-01 and CMP-NDS-01 cite «–», but CLAUDE.md requires a source URL per rule. Add [MD] and [WEB-C] respectively.
- **`activity|camp` is not a valid scope.** LST-SB-02/03/04 use it. Define one scope (`camp`, with per-activity targets for activity hits), or extend the schema to allow a scope list.
- **LST-SB-02 is ambiguous for mountain guides.** Say explicitly that an entry with `kind: bergfuehrer` satisfies the rule even when `approvedOn` is null (WEB-C: Bergführer activities «müssen nicht … geprüft werden»).
- **The «Angebotskontext» toggle label is wrong for 2026.** «Weiteres Lager ≥ 4 J+S-Tage im selben Angebot» does not match the 2026 LEITFADEN wording «mindestens 4 aufeinanderfolgenden Tagen». Use «≥ 4 Tage (ab 2027: J+S-Tage)».
- **The JS-AGE-01 message is misleading.** «ausserhalb des J+S-Alters (Jahrgänge {fromYear}–{toYear})» reads as if those were the excluded years. Reword to «… ausserhalb des J+S-Alters (J+S-Alter: Jahrgänge {fromYear}–{toYear})».
- **Day/camp rules that use `ctx.js` do not declare `activityTags`.** These are JS-CAMP-01, JS-DAY-*, JS-DAY-06, JS-FREE-01, JS-BWZ-*, LST-ACT-02 and LST-ACT-05; `isJsActivity` reads tags. Add `activityTags` to their `inputs`.
- **The §8 checklist uses kinds the legend does not define.** «didactic» and «info» appear in the Kind column, but the legend defines only B, E and 2014. Add them to the legend or map them (didactic → E, info → E).
- **Optional: JS-CAMP-01 and the JS-DAY rules sit in module `lst`.** For a camp with `sport: other`, the general J+S camp-length and day minima (LEITFADEN Art. 14, all sports) are then never checked. Consider moving the 2026 general part to `js` and keeping the 3-day offer-partner exception and the 2027 skip mode in `lst`.