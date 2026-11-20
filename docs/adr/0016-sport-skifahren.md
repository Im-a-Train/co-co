# ADR 0016: J+S sport Skifahren and the shared module js-lager

- Status: accepted
- Date: 2026-11-20
- Builds on: [ADR 0011](0011-rule-set-v2.md) (rule set v2, modules), [ADR 0013](0013-resources-and-rule-edits.md) (Hilfsmittel)

## Context

co-co only knew camps registered as Lagersport/Trekking (LS/T); every other sport was `other` and got only the
general module `js`. Coaches also coach **Skilager** that are registered in the J+S sport **Skifahren**
(Kinder- und Jugendsport). For those camps the J+S camp rules (≥ 4 consecutive days, valid Lagertag = 2 units /
4 hours / 30 min each with social time and warm-up, arrival + departure day, trainingsfreie Tage) apply exactly as
in LS/T (Leitfaden, Webseite «Lager»), but the LS/T rules do not: no «Zusatz Lagerleiter», no Bewegungszeit
reporting, no Erscheinungsformen, no Sicherheitsbereiche / Expertenbewilligung. The camp-day rules lived in module
`lst`, so a ski camp could not be checked.

## Decision

- `campRuleConfig.sport` becomes `CampSport = 'lst' | 'ski' | 'other'`; the coach picks it in «Regelmodule».
- New module **`js-lager`** «J+S-Lagertage» (`appliesWhen: { jsCamp: true, sport: [lst, ski] }`, always on). It takes
  JS-CAMP-01, JS-DAY-01…06, JS-FREE-01 and CMP-ACT-01…03 from `lst` (rule ids unchanged, minor version bumped).
- New module **`ski`** «Skifahren» (`appliesWhen: { jsCamp: true, sport: [ski] }`, always on): SKI-01 (Helm, FIS /
  SKUS, Erste Hilfe, Material – Merkblatt Unfallprävention Skifahren und Snowboarden) and SKI-02 (freies Gelände:
  < 30° without emergency gear, ≤ 35° only with emergency gear and the J+S Sicherheitszusatz Freeride), both
  `kind: ai`; checklist CL-SKI-01…08; 9 Hilfsmittel from https://www.jugendundsport.ch/de/skifahren.
- JS-STAFF-02 (≥ 2 leaders with a valid recognition in the registered sport) counts MiData «Leiter LS/T» only for
  `lst`; for `ski`/`other` it uses the coach input «J+S-Leitende» (MiData has no Skifahren recognition).
  JS-STAFF-03 (subsidy group size 16 per leader) checks only `lst`.
- The 2027 Bewegungszeit day minimum (`js.minBwzDayMinutes`, sources PBS 2027 news and LS/T-Vorgaben) applies to
  sport `lst` only; `buildJsDayModel` receives the sport.
- Ski as an ergänzender Bewegungsblock in an LS/T camp stays covered by the generic LST-EBB-03.

## Consequences

- An LS/T camp behaves as before (same rule ids; the module filter shows the moved rules under «J+S-Lagertage»).
- Not known / open: the maximum group size per leader for Skifahren (Leitfaden table only printable, not in the
  web text) – checklist CL-SKI-08 asks the coach to compare. The category mapping still labels J+S units «LS/LA»;
  in a ski camp the coach maps ski training categories to LS (J+S unit).
