/**
 * Dev-only promo scenario (`?mock=1&scenario=promo`): an invented, good-looking summer camp served through
 * the same fake eCamp API shape as the dev.ecamp3.ch dump (`__tests__/fixtures/devCampApi.ts`).
 * Generated from a compact program table below. Only imported by `mockTauri.ts`; no real persons.
 *
 * Same camp IRI as the dump (`/api/camps/70ca971c992f`) so every other mock keeps working; dates are
 * a July week in 2031 (Sat 12.-Fri 18.), the MiData mock derives its events from them.
 */
import type { ApiGet } from '@/domain/types'
import type { FakeApi } from '@/__tests__/fixtures/devCampApi'

const CAMP = '/api/camps/70ca971c992f'
const PERIOD = '/api/periods/7fa4564a5d5d'
const USER_IRI = '/api/users/9145944210a7'
const START = '2031-07-12'
const DAYS = 7

type Json = Record<string, unknown>
const href = (h: string) => ({ href: h })
const hex = (n: number) => (0xa1b2c3d4e5f6 + n * 0x1f3a7b5).toString(16).padStart(12, '0').slice(-12)
const q = encodeURIComponent

// ---- Content types (ids as in the dump) -------------------------------------------------------
const CT = {
  ColumnLayout: 'f17470519474',
  Storyboard: 'cfccaecd4bad',
  SafetyConsiderations: '44dcc7493c65',
  Notes: '4f0c657fecef',
  Material: '3ef17bd1df72',
  LearningObjectives: 'c462edd869f3',
  Storycontext: '318e064ea0c9',
} as const
const CT_ENDPOINT: Record<keyof typeof CT, string> = {
  ColumnLayout: 'column_layouts',
  Storyboard: 'storyboards',
  SafetyConsiderations: 'single_texts',
  Notes: 'single_texts',
  Material: 'material_nodes',
  LearningObjectives: 'single_texts',
  Storycontext: 'single_texts',
}

// ---- Categories -------------------------------------------------------------------------------
interface Cat { key: string; id: string; short: string; name: string; color: string; style: string }
const CATS: Cat[] = [
  { key: 'LS', id: hex(1), short: 'LS', name: 'Lagersport', color: '#E4572E', style: '1' },
  { key: 'LA', id: hex(2), short: 'LA', name: 'Lageraktivität', color: '#2A9D8F', style: 'A' },
  { key: 'LP', id: hex(3), short: 'LP', name: 'Lagerprogramm', color: '#8E6BBF', style: 'a' },
  { key: 'ES', id: hex(4), short: 'ES', name: 'Essen', color: '#E9A820', style: 'I' },
]

// ---- Leaders (match the MiData mock) ----------------------------------------------------------
interface Leader { nick: string; first: string; last: string; role: 'manager' | 'member'; id: string; userId: string }
const LEADERS: Leader[] = [
  { nick: 'Falk', first: 'Dora', last: 'Leiter', role: 'manager', id: hex(10), userId: '9145944210a7' },
  { nick: 'Otter', first: 'Emil', last: 'Experte', role: 'member', id: hex(11), userId: hex(21) },
  { nick: 'Mungo', first: 'Marco', last: 'Beispiel', role: 'member', id: hex(12), userId: hex(22) },
  { nick: 'Kiwi', first: 'Kira', last: 'Muster', role: 'member', id: hex(13), userId: hex(23) },
  { nick: 'Pixel', first: 'Pia', last: 'Test', role: 'member', id: hex(14), userId: hex(24) },
]
const leader = (nick: string) => LEADERS.find((l) => l.nick === nick)!

// ---- Progress labels --------------------------------------------------------------------------
const LABELS = [
  { id: hex(30), title: 'Idee', position: 1 },
  { id: hex(31), title: 'In Planung', position: 2 },
  { id: hex(32), title: 'Bereit', position: 3 },
]

// ---- Program table ----------------------------------------------------------------------------
interface Act {
  key: string
  title: string
  cat: 'LS' | 'LA' | 'LP' | 'ES'
  loc: string
  who: string[]
  /** [dayNumber, 'HH:MM', 'HH:MM', movementMinutes?] (movement time = J+S Bewegungszeit) */
  slots: [number, string, string, number?][]
  label: 0 | 1 | 2
  /** Storyboard rows "HH:MM|text|who". Empty = no storyboard. */
  plan?: string[]
  goal?: string
  safety?: string
  material?: string
  story?: string
  planB?: string
}

const ACTS: Act[] = [
  {
    key: 'anreise', title: 'Anreise und Lagerbezug', cat: 'LP', loc: 'Bahnhof Musterhausen / Lagerplatz Waldhütte', who: ['Falk', 'Pixel'],
    slots: [[1, '13:00', '15:00']], label: 2,
    plan: ['13:00|Treffpunkt am Bahnhof, Gepäck verladen|Pixel', '13:30|Gang zum Lagerplatz, Zelte beziehen|Falk, Pixel', '14:30|Begrüssung, Lagerregeln und Sicherheitsinfo|Falk'],
    goal: '<p>Alle kommen gut an, kennen den Lagerplatz und die wichtigsten Regeln.</p>',
  },
  {
    key: 'bauten', title: 'Lagerbauten', cat: 'LA', loc: 'Lagerplatz Waldhütte', who: ['Mungo', 'Pixel'],
    slots: [[1, '15:30', '17:45', 60]], label: 2,
    plan: ['15:30|Einstimmen: Kennenlernspiel und Gruppen einteilen|Mungo', '15:45|Materialposten: Holz, Seile, Blachen|Pixel', '16:00|Gruppen bauen ihre Sitzecke und das Lagertor, Lagerregeln und Fairplay|Mungo, Pixel', '17:15|Rundgang und Abnahme der Bauten|Mungo'],
    goal: '<p>Die Kinder lernen Grundknoten und einfache Bünde kennen und bauen gemeinsam ihre Gruppenecke.</p><p>Ziel: Jede Gruppe hat am Abend einen Sitzplatz fürs Lagerfeuer.</p>',
    safety: '<p>Werkzeug (Beil, Säge) nur mit Leiter, Handschuhe tragen. Bünde und Seile werden vor Gebrauch geprüft, jede Verankerung und Sicherung wird von einem Leiter abgenommen. Bauten höchstens 1,5 m hoch. Erste-Hilfe-Set am Posten. Abbruch bei Gewitter.</p>',
    material: '<p>Rundholz, Seile, Blachen, Beile, Sägen, Handschuhe, Erste-Hilfe-Set.</p>',
    planB: '<p>Schlechtwetter: Knotenwerkstatt im Lagerhaus, Bau am nächsten Tag.</p>',
  },
  {
    key: 'feuer', title: 'Lagerfeuer und Singen', cat: 'LP', loc: 'Feuerstelle am Waldrand', who: ['Kiwi', 'Otter'],
    slots: [[1, '20:15', '21:30'], [5, '20:15', '21:30']], label: 1,
    plan: ['20:15|Feuer entzünden, Sitzordnung|Otter', '20:30|Lieder und Geschichte|Kiwi', '21:15|Abschlusslied, Feuer löschen|Otter'],
    goal: '<p>Gemeinsamer Ausklang, Gruppengefühl stärken.</p>',
    safety: '<p>Feuerstelle mit Steinen gesichert, Löscheimer und Decke bereit. Feuer wird nie unbeaufsichtigt gelassen. Brandschutz-Regeln vor Beginn erklären.</p>',
  },
  {
    key: 'bruecke', title: 'Seilbrücke bauen', cat: 'LS', loc: 'Waldlichtung beim Lagerplatz', who: ['Mungo', 'Otter'],
    slots: [[2, '09:00', '11:45', 105]], label: 2,
    plan: ['09:00|Einstimmen: Aufwärmspiel, wie trägt ein Seil?|Mungo', '09:20|Knoten üben: Mastwurf, Palstek, Kreuzbund|Otter', '10:00|Bau der Seilbrücke über die Senke in Gruppen|Mungo, Otter', '11:15|Probe mit Sicherung, Abbau|Mungo'],
    goal: '<p>Die Teilnehmenden bauen gemeinsam eine Seilbrücke über die Senke und lernen dabei Knoten, Zugkräfte und Sicherung.</p>',
    safety: '<p>Brücke max. 1 m über Boden, nur eine Person gleichzeitig, immer gesichert und mit Helm. Seile vor Gebrauch geprüft. Sicherung durch J+S-Leiter, Verankerung an zwei Bäumen mit Doppelsicherung. Ausrüstung kontrolliert, Rettungsplan am Posten. Abbruch bei Gewitter oder Wind.</p>',
    material: '<p>Kletterseile, Reepschnüre, Helme, Handschuhe, Karabiner, Erste-Hilfe-Set.</p>',
    planB: '<p>Schlechtwetter: Knotenwerkstatt im Lagerhaus, Brücke wird verschoben.</p>',
  },
  {
    key: 'gelaende', title: 'Geländespiel Wildnis', cat: 'LA', loc: 'Wald und Lichtung Hinterwald', who: ['Kiwi', 'Pixel'],
    slots: [[2, '14:00', '17:00', 120]], label: 2,
    plan: ['14:00|Einstimmen mit der Geschichte: Die Wildnis ruft, Aufwärmen|Kiwi', '14:20|Gruppen starten, Posten suchen|Pixel', '15:00|Fünf Posten: Tarnen, Spuren, Kompass, Feuerstein, Rätsel|Kiwi, Pixel', '16:30|Finale an der Lichtung, Siegerehrung|Kiwi'],
    goal: '<p>Spielerisch Orientierung, Teamarbeit und Naturwissen üben.</p>',
    safety: '<p>Spielgrenzen am Anfang klar markiert, Pfeifsignal für Abbruch, Leiter an jedem Posten. Wetterwarnung und Notfallnummern bei Leitung dabei. Alle Gruppen mit Handy oder Funk.</p>',
    material: '<p>Postenmaterial, Kompasse, Karten, Pfeifen, Funkgeräte, Erste-Hilfe-Set.</p>',
    story: '<p>Ein alter Trapper hat im Hinterwald seinen Schatz versteckt. Nur wer die Zeichen der Wildnis lesen kann, findet ihn.</p>',
    planB: '<p>Schlechtwetter: Postenlauf im Lagerhaus mit angepassten Aufgaben.</p>',
  },
  {
    key: 'nacht', title: 'Nachtspiel im Wald', cat: 'LP', loc: 'Waldweg zum Aussichtspunkt', who: ['Falk', 'Mungo'],
    slots: [[2, '21:00', '22:15']], label: 1,
    plan: ['21:00|Besammlung mit Stirnlampen|Falk', '21:15|Stilles Schleichen bis zum Aussichtspunkt|Mungo', '21:45|Sterne und Geschichte|Falk', '22:00|Rückweg, Zählen|Mungo, Falk'],
    goal: '<p>Die Dunkelheit als Erlebnis, ruhig und ohne Angst.</p>',
    safety: '<p>Nachtaktivität: Leiter vorne und hinten, Teilnehmerzählung bei jedem Halt, Stirnlampen für alle, Notfallhandy mit Empfang, Route tagsüber rekognosziert. Abbruch bei Gewitter.</p>',
  },
  {
    key: 'hoeck', title: 'Leiterhöck', cat: 'LP', loc: 'Leiterzelt', who: ['Falk'],
    slots: [[1, '21:45', '22:15'], [2, '22:30', '23:00'], [3, '21:15', '21:45'], [4, '21:45', '22:15'], [5, '21:45', '22:15'], [6, '21:45', '22:15']], label: 2,
    safety: '<p>Leitende bleiben bis zur Nachtruhe um 22:30 am Lagerplatz erreichbar, die Nachtwache wird am Leiterhöck bestimmt.</p>',
  },
  {
    key: 'ol', title: 'OL im Wald', cat: 'LS', loc: 'Hinterwald', who: ['Mungo'],
    slots: [[3, '09:00', '11:30', 90]], label: 2,
    plan: ['09:00|Einstimmen: Aufwärmlauf, Kartenkunde: Signaturen und Massstab|Mungo', '09:40|Kompass und Karte einnorden, Postenlauf in Dreiergruppen|Mungo', '11:00|Auswertung|Mungo'],
    goal: '<p>Karte lesen, Kompass einsetzen, im Gelände zurechtfinden.</p>',
    safety: '<p>Waldgrenzen markiert, Kinder in Dreiergruppen, Pfeife zum Notruf, Rückkehrzeit 11:15 verbindlich. Zecken-Check nach dem Lauf.</p>',
    material: '<p>Karten, Kompasse, Postenmaterial, Pfeifen.</p>',
    planB: '<p>Schlechtwetter: Der Lauf findet mit Regenjacken statt, bei Gewitter Abbruch.</p>',
  },
  {
    key: 'baden', title: 'Baden am See', cat: 'LA', loc: 'Waldsee (Badestelle)', who: ['Otter', 'Kiwi'],
    slots: [[3, '14:00', '16:30', 60]], label: 1,
    plan: ['14:00|Einstimmen und Gang zum See|Kiwi', '14:30|Badezonen erklären, Schwimmtest|Otter', '14:45|Freies Baden, Fairplay und Achtsamkeit im Wasser|Otter, Kiwi', '16:15|Zusammenpacken, Rückgang|Kiwi'],
    goal: '<p>Abkühlung nach dem warmen Tag, Spiel und Spass am Wasser.</p>',
    material: '<p>Badetücher, Sonnencreme, Erste-Hilfe-Set mit Rettungsdecke und Wärmekissen, Handy für den Notruf.</p>',
    planB: '<p>Schlechtwetter: Bei Regen oder Gewitter bleiben wir im Lager, Ersatz ist das Spielturnier im Lagerhaus.</p>',
  },
  {
    key: 'spiele', title: 'Spieleabend', cat: 'LP', loc: 'Lagerhaus', who: ['Pixel'],
    slots: [[3, '19:30', '21:00']], label: 1,
    plan: ['19:30|Spielstationen aufbauen|Pixel', '19:45|Bunter Spielabend in Gruppen|Pixel', '20:45|Aufräumen|Pixel'],
    goal: '<p>Lockerer Abend: Brettspiele, Kartenspiele und Quiz.</p>',
  },
  {
    key: 'wandern', title: 'Zweitageswanderung', cat: 'LS', loc: 'Aufstieg zum Hinterberg', who: ['Falk', 'Mungo', 'Otter'],
    slots: [[4, '08:30', '12:00', 150], [4, '13:00', '17:30', 180], [5, '08:30', '12:00', 150], [5, '13:00', '15:30', 120]], label: 1,
    plan: ['08:30|Einstimmen, Rucksack-Check, Abmarsch ab Lagerplatz|Falk', '10:00|Pause an der Quelle, Znüni|Otter', '12:00|Picknick auf der Wiese|Otter', '14:00|Aufstieg zum Hinterberg, Route auf der Karte|Mungo', '17:30|Ankunft Rastplatz, Zelte aufbauen|Falk', '08:30|Abstieg über den Höhenweg|Mungo', '15:30|Rückkehr ins Lager|Falk'],
    goal: '<p>Gemeinsame Wanderung mit Übernachtung im Biwak. Rucksack packen, Gruppe führen, Verantwortung übernehmen.</p>',
    safety: '<p>Routenwahl T2, Route tagsüber rekognosziert. Notfallkonzept mit Rega 1414, Erste-Hilfe-Set und Notfallapotheke bei Falk, Rettungsdecke und Biwaksack in jedem Rucksack, Handy für den Notruf. Umkehrzeit 15:00, Abbruch bei Gewitter. Gruppe immer mit Spitze und Schlusslicht, Wetterbericht am Vorabend.</p>',
    material: '<p>Rucksäcke, Wanderschuhe, Regenschutz, Karte, Kompass, Notfallapotheke, Rettungsdecke.</p>',
    planB: '<p>Schlechtwetter: Wir kürzen die Route, Abstieg über den Fahrweg.</p>',
  },
  {
    key: 'picknick', title: 'Picknick unterwegs', cat: 'ES', loc: 'Unterwegs', who: ['Otter'],
    slots: [[4, '12:00', '13:00'], [5, '12:00', '13:00']], label: 2,
  },
  {
    key: 'biwak', title: 'Sternenhimmel und Nachtruhe', cat: 'LP', loc: 'Rastplatz Hinterberg', who: ['Kiwi', 'Falk'],
    slots: [[4, '20:00', '21:30']], label: 1,
    plan: ['20:00|Feuer, Marshmallows|Kiwi', '20:30|Sternbilder erkennen|Falk', '21:15|Schlafsäcke, Nachtruhe|Kiwi, Falk'],
    goal: '<p>Draussen schlafen, Sterne beobachten, Ruhe geniessen.</p>',
    safety: '<p>Feuerstelle mit Steinen gesichert. Zelte und Biwaksäcke geprüft. Nachtwache durch zwei Leiter im Wechsel. Notfallapotheke, Rettungsdecke und Handy bei Falk. Abbruch bei Gewitter.</p>',
  },
  {
    key: 'erstehilfe', title: 'Erste Hilfe Posten', cat: 'LS', loc: 'Lagerhaus', who: ['Kiwi', 'Falk'],
    slots: [[6, '09:00', '11:30', 30]], label: 2,
    plan: ['09:00|Einstimmen: Lage beurteilen, Notruf absetzen|Kiwi', '09:40|Verbände, Pflaster, stabile Seitenlage|Falk', '10:30|Rollenspiel: Unfall im Lager|Kiwi, Falk'],
    goal: '<p>Alle Teilnehmenden kennen die wichtigsten Erste-Hilfe-Massnahmen und trauen sich zu zu helfen.</p>',
    safety: '<p>Übungsmaterial, keine echten Verletzungen. Die Notrufnummer 144 und Rega 1414 sind an der Wand.</p>',
    material: '<p>Verbandsmaterial, Dreiecktücher, Übungspuppe, Notfallkarten.</p>',
  },
  {
    key: 'olympiade', title: 'Lagerolympiade', cat: 'LS', loc: 'Sportwiese beim Lagerplatz', who: ['Pixel', 'Otter', 'Kiwi'],
    slots: [[6, '14:00', '17:00', 60]], label: 2,
    plan: ['14:00|Einstimmen: Eröffnung mit Fahnen und Aufwärmen|Pixel', '14:20|Disziplinen: Staffellauf, Sackhüpfen, Tauziehen, Ballstafette|Otter, Kiwi', '16:30|Rangverkündigung|Pixel'],
    goal: '<p>Bewegung und Fairplay, Gruppen messen sich in fünf Disziplinen.</p>',
    safety: '<p>Ebene Wiese, Steine und Löcher abgesucht, Trinkpausen, Sonnenschutz. Abbruch bei Gewitter.</p>',
    material: '<p>Fahnen, Seile, Säcke, Bälle, Stoppuhren, Siegerpreise.</p>',
  },
  {
    key: 'bunt', title: 'Bunter Abend', cat: 'LP', loc: 'Lagerhaus', who: ['Kiwi', 'Pixel'],
    slots: [[6, '19:30', '21:30']], label: 1,
    plan: ['19:30|Begrüssung, Moderation|Kiwi', '19:45|Gruppenauftritte, Sketche und Lieder|Pixel', '21:00|Rangverkündigung, Dank|Kiwi'],
    goal: '<p>Jede Gruppe zeigt einen eigenen Beitrag. Abschlussfest des Lagers.</p>',
  },
  {
    key: 'abschluss', title: 'Abschlussspiel und Aufräumen', cat: 'LA', loc: 'Lagerplatz Waldhütte', who: ['Falk'],
    slots: [[7, '09:00', '11:30', 60]], label: 0,
    plan: ['09:00|Einstimmen: Aufwärmen mit Achtsamkeitsübung|Falk', '09:30|Abschlussspiel mit Fairplay-Punkten|Falk', '10:00|Aufräumaktion: Lagerplatz putzen|Falk', '11:00|Abschlusskreis und Tagesrückblick|Falk'],
    goal: '<p>Lagerplatz sauber hinterlassen, gemeinsam zurückblicken.</p>',
    safety: '<p>Beim Putzen und Packen Handschuhe tragen, Werkzeug und Abfall nur mit Leiter. Gelände vor der Abreise gemeinsam abgesucht.</p>',
    material: '<p>Abfallsäcke, Handschuhe, Besen, Packlisten.</p>',
    planB: '<p>Schlechtwetter: Wir räumen zuerst das Lagerhaus, Zelte trocknen am Schluss.</p>',
  },
  {
    key: 'abreise', title: 'Abreise', cat: 'LP', loc: 'Bahnhof Musterhausen', who: ['Falk', 'Pixel'],
    slots: [[7, '13:30', '14:30']], label: 0,
  },
  {
    key: 'zmorge', title: 'Zmorge', cat: 'ES', loc: 'Lagerhaus / Küche', who: ['Otter'],
    slots: [[2, '07:30', '08:15'], [3, '07:30', '08:15'], [4, '07:30', '08:15'], [5, '07:00', '07:45'], [6, '07:30', '08:15'], [7, '07:30', '08:15']], label: 2,
  },
  {
    key: 'zmittag', title: 'Zmittag', cat: 'ES', loc: 'Lagerhaus / Küche', who: ['Otter'],
    slots: [[2, '12:00', '13:00'], [3, '12:00', '13:00'], [6, '12:00', '13:00'], [7, '12:00', '13:00']], label: 2,
  },
  {
    key: 'znacht', title: 'Znacht', cat: 'ES', loc: 'Lagerhaus / Küche', who: ['Otter'],
    slots: [[1, '18:00', '19:00'], [2, '18:00', '19:00'], [3, '18:00', '19:00'], [4, '18:00', '19:00'], [5, '18:00', '19:00'], [6, '18:00', '19:00']], label: 2,
  },
]

// ---- Builders ---------------------------------------------------------------------------------
function dateOf(dayNumber: number): string {
  const d = new Date(`${START}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dayNumber - 1)
  return d.toISOString().slice(0, 10)
}
const wall = (day: number, hm: string) => `${dateOf(day)}T${hm}:00+00:00`
function numberFmt(style: string, n: number): string {
  switch (style) {
    case 'A': return String.fromCharCode(64 + n)
    case 'a': return String.fromCharCode(96 + n)
    case 'I': return ['I', 'II', 'III', 'IV', 'V', 'VI'][n - 1] ?? String(n)
    default: return String(n)
  }
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export function buildPromoCamp(): Record<string, Json> {
  const dayIds = Array.from({ length: DAYS }, (_, i) => hex(100 + i))
  const catById = (key: string) => CATS.find((c) => c.key === key)!

  // schedule entries (sorted per day by start for numbering)
  interface Flat { act: Act; actId: string; day: number; s: string; e: string; bwz?: number }
  const flat: Flat[] = []
  ACTS.forEach((act, i) => {
    for (const [day, s, e, bwz] of act.slots) flat.push({ act, actId: hex(200 + i), day, s, e, bwz })
  })
  flat.sort((a, b) => a.day - b.day || a.s.localeCompare(b.s))
  const counters = new Map<string, number>()
  const entries: Json[] = flat.map((f, i) => {
    const cat = catById(f.act.cat)
    const ck = `${f.day}/${cat.key}`
    const n = (counters.get(ck) ?? 0) + 1
    counters.set(ck, n)
    const id = hex(400 + i)
    return {
      _links: { self: href(`/api/schedule_entries/${id}`), period: href(PERIOD), activity: href(`/api/activities/${f.actId}`), day: href(`/api/days/${dayIds[f.day - 1]}`) },
      left: 0, width: 1, ysPhysicalActivityDurationMinutes: f.bwz ?? null, id,
      start: wall(f.day, f.s), end: wall(f.day, f.e),
      dayNumber: f.day, scheduleEntryNumber: n, number: `${f.day}.${numberFmt(cat.style, n)}`,
    }
  })

  // content nodes
  const nodes: Json[] = []
  let nodeCounter = 0
  const rootOf = new Map<string, string>()
  const node = (type: keyof typeof CT, rootId: string, data: Json, position: number): void => {
    const id = hex(1000 + nodeCounter++)
    const sub = `/api/content_node/${CT_ENDPOINT[type]}`
    nodes.push({
      _links: { self: href(`${sub}/${id}`), root: href(`/api/content_node/column_layouts/${rootId}`), parent: href(`/api/content_node/column_layouts/${rootId}`), children: [], contentType: href(`/api/content_types/${CT[type]}`) },
      data, slot: '1', position, instanceName: null, id, contentTypeName: type,
    })
  }
  ACTS.forEach((act, i) => {
    const rootId = hex(600 + i)
    rootOf.set(act.key, rootId)
    nodes.push({
      _links: { self: href(`/api/content_node/column_layouts/${rootId}`), root: href(`/api/content_node/column_layouts/${rootId}`), parent: null, children: [], contentType: href(`/api/content_types/${CT.ColumnLayout}`) },
      data: { columns: [{ slot: '1', width: 12 }] }, slot: null, position: 0, instanceName: null, id: rootId, contentTypeName: 'ColumnLayout',
    })
    let pos = 1
    if (act.story) node('Storycontext', rootId, { html: act.story }, pos++)
    if (act.goal) node('LearningObjectives', rootId, { html: act.goal }, pos++)
    if (act.plan) {
      const sections: Json = {}
      act.plan.forEach((row, k) => {
        const [t, text, who] = row.split('|')
        sections[`00000000-0000-4000-8000-${hex(5000 + i * 20 + k)}`] = { column1: t, column2Html: `<p>${esc(text)}</p>`, column3: who ?? '', position: k }
      })
      node('Storyboard', rootId, { sections }, pos++)
    }
    if (act.safety) node('SafetyConsiderations', rootId, { html: act.safety }, pos++)
    if (act.material) node('Material', rootId, { html: act.material }, pos++)
    if (act.planB) node('Notes', rootId, { html: act.planB }, pos++)
  })

  // activities
  const activities: Json[] = ACTS.map((act, i) => {
    const id = hex(200 + i)
    const rootId = rootOf.get(act.key)!
    const label = LABELS[act.label]
    return {
      _links: {
        self: href(`/api/activities/${id}`),
        scheduleEntries: href(`/api/schedule_entries?activity=${q(`/api/activities/${id}`)}`),
        camp: href(CAMP), category: href(`/api/categories/${catById(act.cat).id}`), progressLabel: href(`/api/activity_progress_labels/${label.id}`),
        comments: href(`/api/activities/${id}/comments`),
        activityResponsibles: href(`/api/activity_responsibles?activity=${q(`/api/activities/${id}`)}`),
        rootContentNode: href(`/api/content_node/column_layouts/${rootId}`),
        contentNodes: href(`/api/content_nodes?root=${q(`/api/content_node/column_layouts/${rootId}`)}`),
      },
      title: act.title, location: act.loc, id,
    }
  })

  const responsibles: Json[] = []
  ACTS.forEach((act, i) => {
    act.who.forEach((nick, k) => {
      const id = hex(800 + i * 4 + k)
      responsibles.push({
        _links: { self: href(`/api/activity_responsibles/${id}`), activity: href(`/api/activities/${hex(200 + i)}`), campCollaboration: href(`/api/camp_collaborations/${leader(nick).id}`) },
        id,
      })
    })
  })

  const days: Json[] = dayIds.map((id, i) => ({
    _links: { self: href(`/api/days/${id}`), period: href(PERIOD) },
    dayOffset: i, id, number: i + 1, start: `${dateOf(i + 1)}T00:00:00+00:00`, end: `${dateOf(i + 2)}T00:00:00+00:00`,
  }))
  const rotation = ['Falk', 'Otter', 'Mungo', 'Kiwi', 'Pixel', 'Falk', 'Otter']
  const dayResponsibles: Json[] = dayIds.map((dayId, i) => {
    const id = hex(900 + i)
    return { _links: { self: href(`/api/day_responsibles/${id}`), day: href(`/api/days/${dayId}`), campCollaboration: href(`/api/camp_collaborations/${leader(rotation[i]).id}`) }, id }
  })

  const categories: Json[] = CATS.map((c) => ({
    _links: { self: href(`/api/categories/${c.id}`), camp: href(CAMP) },
    short: c.short, name: c.name, color: c.color, numberingStyle: c.style, id: c.id,
  }))
  const labels: Json[] = LABELS.map((l) => ({ _links: { self: href(`/api/activity_progress_labels/${l.id}`), camp: href(CAMP) }, position: l.position, title: l.title, id: l.id }))

  const collabs: Json[] = LEADERS.map((l) => ({
    _links: { self: href(`/api/camp_collaborations/${l.id}`), user: href(`/api/users/${l.userId}`), camp: href(CAMP) },
    _embedded: { user: { _links: { self: href(`/api/users/${l.userId}`), profile: href(`/api/profiles/${l.userId}`) }, id: l.userId, displayName: l.nick, color: null, abbreviation: null } },
    inviteEmail: null, status: 'established', role: l.role, color: null, abbreviation: null, id: l.id,
  }))
  const profiles: Json[] = LEADERS.map((l) => ({
    _links: { self: href(`/api/profiles/${l.userId}`) }, nickname: l.nick, firstname: l.first, surname: l.last, id: l.userId,
  }))

  const actId = (key: string) => hex(200 + ACTS.findIndex((a) => a.key === key))
  const comment = (n: number, key: string, author: string, text: string, createTime: string, parent: number | null = null, resolved = false): Json => {
    const id = hex(1500 + n)
    return {
      _links: {
        self: href(`/api/comments/${id}`), camp: href(CAMP), activity: href(`/api/activities/${actId(key)}`),
        parent: parent === null ? null : href(`/api/comments/${hex(1500 + parent)}`), children: [],
        author: href(`/api/camp_collaborations/${leader(author).id}`), resolvedBy: resolved ? href(`/api/camp_collaborations/${leader('Falk').id}`) : null,
      },
      authorDisplayName: author, textHtml: text, orphanDescription: null, resolvedAt: resolved ? '2031-05-20T18:00:00+00:00' : null, id, createTime,
    }
  }
  const comments: Json[] = [
    comment(1, 'baden', 'Otter', '<p>Wir sollten noch die Sicherheitsüberlegungen für die Badestelle ergänzen (Badeaufsicht, Schwimmtest).</p>', '2031-05-18T19:02:11+00:00'),
    comment(2, 'wandern', 'Mungo', '<p>Route ist rekognosziert, Marschzeit mit Pausen etwa 6 Stunden.</p>', '2031-05-19T20:15:00+00:00'),
    comment(3, 'bruecke', 'Kiwi', '<p>Helme für alle bestellt.</p>', '2031-05-17T17:30:00+00:00', null, true),
  ]

  const period = {
    _links: { self: href(PERIOD), days: href(`${PERIOD}/days`), scheduleEntries: href(`${PERIOD}/schedule_entries`), camp: href(CAMP) },
    description: 'Hauptlager', start: START, end: dateOf(DAYS), hitobitoId: null, id: '7fa4564a5d5d',
  }
  const camp: Json = {
    _links: { self: href(CAMP), campCollaborations: href(`/api/camp_collaborations?camp=${q(CAMP)}`), periods: href(`/api/periods?camp=${q(CAMP)}`) },
    _embedded: { periods: [structuredClone(period)] },
    isShared: false, sharedSince: null, isPrototype: false, shortTitle: 'SoLa 2031', title: 'Sommerlager Wildnis', motto: 'Wildnis, wir kommen!',
    addressName: 'Lagerplatz Waldhütte', addressStreet: null, addressZipcode: '8000', addressCity: 'Musterhausen',
    organizer: 'Abteilung Musterhausen', kind: null, coachName: 'Falk', courseNumber: null, courseKind: null, trainingAdvisorName: null,
    hitobitoProvider: null, hitobitoEventId: null, id: '70ca971c992f',
  }

  const list = (self: string, items: Json[]): Json => ({ _links: { self: href(self) }, totalItems: items.length, _embedded: { items } })
  return {
    camp,
    periods: list(`/api/periods?camp=${q(CAMP)}`, [period]),
    days: list(`/api/days?period.camp=${q(CAMP)}`, days),
    dayResponsibles: list(`/api/day_responsibles?day.period=${q(PERIOD)}`, dayResponsibles),
    scheduleEntries: list(`/api/schedule_entries?period=${q(PERIOD)}`, entries),
    activities: list(`/api/activities?camp=${q(CAMP)}`, activities),
    activityResponsibles: list(`/api/activity_responsibles?activity.camp=${q(CAMP)}`, responsibles),
    campCollaborations: list(`/api/camp_collaborations?camp=${q(CAMP)}`, collabs),
    categories: list(`/api/categories?camp=${q(CAMP)}`, categories),
    progressLabels: list(`/api/activity_progress_labels?camp=${q(CAMP)}`, labels),
    contentNodes: list(`/api/content_nodes?camp=${q(CAMP)}`, nodes),
    comments: list(`/api/comments?camp=${q(CAMP)}`, comments),
    profiles: list(`/api/profiles?user.collaborations.camp=${q(CAMP)}`, profiles),
    materialLists: list(`/api/material_lists?camp=${q(CAMP)}`, []),
  }
}

/** Fake ApiGet over the promo camp (same shape as `createDevCampApi`). */
export function createPromoCampApi(): FakeApi {
  const calls: string[] = []
  const d = buildPromoCamp()
  const collections: [RegExp, Json][] = [
    [/^\/api\/periods\?/, d.periods],
    [/^\/api\/days\?/, d.days],
    [/^\/api\/day_responsibles\?/, d.dayResponsibles],
    [/^\/api\/schedule_entries\?/, d.scheduleEntries],
    [/^\/api\/activities\?/, d.activities],
    [/^\/api\/activity_responsibles\?/, d.activityResponsibles],
    [/^\/api\/camp_collaborations\?/, d.campCollaborations],
    [/^\/api\/categories\?/, d.categories],
    [/^\/api\/activity_progress_labels\?/, d.progressLabels],
    [/^\/api\/content_nodes\?/, d.contentNodes],
    [/^\/api\/comments\?/, d.comments],
    [/^\/api\/profiles\?/, d.profiles],
    [/^\/api\/material_lists\?/, d.materialLists],
  ]
  const apiGet = (async (path: string) => {
    calls.push(path)
    const clean = decodeURIComponent(path)
    if (clean === CAMP) return structuredClone(d.camp)
    if (clean.startsWith('/api/camps?')) return { _embedded: { items: [structuredClone(d.camp)] }, totalItems: 1, _links: { self: { href: path } } }
    for (const [re, body] of collections) if (re.test(clean)) return structuredClone(body)
    throw new Error(`HTTP 404 (promo api): ${path}`)
  }) as ApiGet
  return { apiGet, calls }
}

export const PROMO_USER_IRI = USER_IRI
