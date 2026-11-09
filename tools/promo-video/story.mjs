/**
 * Story of the promo video («Drehbuch»): coach Falk coaches one summer camp, from the first look at GP and
 * DP to the NDS registration and the calendar. Each beat is one caption (kicker / title / sub) or a title
 * card, plus the narration. Narration is written in normal spelling; pronounce.mjs makes it speakable.
 * Plain language on purpose: no technical terms.
 */
export const BEATS = [
  // ---- Intro ----
  {
    id: 'intro',
    card: ['Für J+S-Coaches', 'co-co', 'Coach Cockpit – Lager coachen mit weniger Aufwand', 'Eine Geschichte aus dem Coach-Alltag'],
    voice: 'co-co. Das Coach Cockpit. Lager coachen, mit weniger Aufwand.',
  },
  {
    id: 'auftrag',
    card: ['Kapitel 1 · Der Auftrag', 'Falk coacht ein Sommerlager', 'Das Leitungsteam um Anna plant das Sommerlager der Abteilung in eCamp. Falk schaut Grobprogramm und Detailprogramm an, berät und gibt Rückmeldung – neben Job und Studium.', ''],
    voice: 'Das ist Falk. Er ist J+S-Coach in seiner Abteilung. Das Leitungsteam um Anna plant das Sommerlager in eCamp. Falk soll das Grobprogramm und das Detailprogramm anschauen, beraten und Rückmeldung geben. Und das alles neben Job und Studium.',
  },
  // ---- Kapitel 2: Start ----
  {
    id: 'login',
    kicker: 'Kapitel 2 · Los geht’s',
    title: 'Ein Login – und die Daten sind geschützt',
    sub: 'Falk meldet sich mit seinem eCamp-Konto an. Erst dann öffnet co-co seine Daten – auf dem Computer sind sie verschlüsselt gespeichert.',
    voice: 'Falk meldet sich mit seinem eCamp-Konto an. Erst dann öffnet co-co seine Daten. Auf dem Computer sind sie verschlüsselt gespeichert.',
  },
  {
    id: 'lager',
    kicker: 'Kapitel 2 · Los geht’s',
    title: 'Alle Lager auf einen Blick',
    sub: 'co-co zeigt jedes Lager, das Falk begleitet – mit Stand der Durchsicht und der nächsten Frist.',
    voice: 'co-co zeigt alle Lager, die Falk begleitet. Und was als Nächstes ansteht.',
  },
  {
    id: 'cockpit',
    kicker: 'Kapitel 2 · Los geht’s',
    title: 'Wo steht das Lager?',
    sub: 'co-co liest das ganze Programm aus eCamp und vergleicht es mit den Vorgaben von J+S und der Pfadi. Auf einen Blick: was dringend ist und was warten kann.',
    voice: 'co-co liest das ganze Programm aus eCamp und vergleicht es mit den Vorgaben von J+S und der Pfadi. Auf einen Blick sieht Falk, was dringend ist, und was warten kann.',
  },
  // ---- Kapitel 3: GP ----
  {
    id: 'gp',
    kicker: 'Kapitel 3 · Das Grobprogramm',
    title: 'Das GP: die ganze Lagerwoche auf einen Blick',
    sub: 'Jeder Block in der Farbe seiner Art – Lagersport, Lageraktivität, Lagerprogramm. Über jedem Tag steht, wie viel J+S-Zeit zusammenkommt.',
    voice: 'Das Grobprogramm, kurz GP. Die ganze Lagerwoche auf einen Blick. Jeder Block in der Farbe seiner Art: Lagersport, Lageraktivität, Lagerprogramm. Und über jedem Tag steht, wie viel J+S-Zeit zusammenkommt.',
  },
  {
    id: 'zuordnung',
    kicker: 'Kapitel 3 · Das Grobprogramm',
    title: 'Einmal bestätigen – dann zählt es',
    sub: 'co-co schlägt vor, welche Blöcke für J+S zählen. Falk prüft den Vorschlag und bestätigt. Jetzt rechnet das GP mit gültigen Lagertagen.',
    voice: 'Welche Blöcke zählen für J+S? co-co macht einen Vorschlag. Falk prüft ihn und bestätigt. Jetzt rechnet das GP mit gültigen Lagertagen.',
  },
  // ---- Kapitel 4: DP ----
  {
    id: 'dp',
    kicker: 'Kapitel 4 · Das Detailprogramm',
    title: 'Das DP: jede Aktivität im Detail',
    sub: 'Ein Klick auf einen Block zeigt Ablauf, Ziele, Verantwortliche und Sicherheitsüberlegungen – so, wie das Team sie in eCamp geplant hat.',
    voice: 'Ein Klick, und Falk ist im Detailprogramm, kurz DP. Hier stehen der Ablauf, die Ziele, wer verantwortlich ist, und welche Sicherheitsüberlegungen das Team gemacht hat.',
  },
  {
    id: 'module',
    kicker: 'Kapitel 4 · Das Detailprogramm',
    title: 'Die richtigen Regeln fürs richtige Lager',
    sub: 'co-co erkennt, was im Programm vorkommt – Wanderung, Wasser, Berg – und prüft genau die passenden Regeln. Dazu gibt es eine Checkliste mit Quellen.',
    voice: 'co-co erkennt, was im Programm vorkommt. Eine Wanderung. Baden am See. Und es prüft genau die Regeln, die dazu passen. Dazu gibt es eine Checkliste, mit Quellen.',
  },
  // ---- Kapitel 5: Durchsehen ----
  {
    id: 'triage',
    kicker: 'Kapitel 5 · Durchsehen',
    title: 'Zwanzig Minuten am Abend',
    sub: 'Punkt für Punkt geht Falk die Hinweise durch. Die passende Aktivität steht daneben, ein Feedback-Text ist schon vorgeschlagen. Übernehmen oder weglassen – und weiter.',
    voice: 'Am Abend nimmt sich Falk zwanzig Minuten Zeit. Punkt für Punkt. Die passende Aktivität steht gleich daneben, und ein Feedback-Text ist schon vorgeschlagen. Übernehmen, oder weglassen. Und weiter zum nächsten Punkt.',
  },
  {
    id: 'warum',
    kicker: 'Kapitel 5 · Durchsehen',
    title: '«Warum?» – nachvollziehbar statt Blackbox',
    sub: 'Bei einem Punkt ist Falk unsicher. co-co zeigt, welche Regel dahintersteckt, woher sie kommt und was genau geprüft wurde.',
    voice: 'Bei einem Punkt ist Falk unsicher. Ein Klick auf «Warum?» zeigt, welche Regel dahintersteckt, woher sie kommt, und was genau geprüft wurde. So kann Falk seine Rückmeldung gut begründen.',
  },
  // ---- Kapitel 6: Rückmeldung ----
  {
    id: 'feedback',
    kicker: 'Kapitel 6 · Rückmeldung geben',
    title: 'Feedback dort, wo das Team plant',
    sub: 'Falk schreibt seinen Hinweis zu einer Aktivität und stellt ihn mit einem Klick als Kommentar in eCamp – genau dorthin, wo das Team plant.',
    voice: 'Seinen Hinweis schreibt Falk direkt hier. Mit einem Klick erscheint er als Kommentar in eCamp. Genau dort, wo das Team plant.',
  },
  {
    id: 'sync',
    kicker: 'Kapitel 6 · Rückmeldung geben',
    title: 'Zwei Tage später',
    sub: 'Ein Klick zeigt, was das Team damit gemacht hat: Anna hat geantwortet, ein Punkt ist schon erledigt. Kein Nachfragen, kein Suchen im Chat.',
    voice: 'Zwei Tage später. Ein Klick, und Falk sieht, was das Team damit gemacht hat. Anna hat geantwortet. Ein Punkt ist schon erledigt. Kein Nachfragen, kein Suchen im Chat.',
  },
  {
    id: 'teilen',
    kicker: 'Kapitel 6 · Rückmeldung geben',
    title: 'Oder als Nachricht ans Team',
    sub: 'Alle Punkte als fertige E-Mail – jeder Aktivitätstitel führt mit einem Klick ins Programm in eCamp. Für WhatsApp kurz und knapp mit Blocknummern.',
    voice: 'Lieber als Nachricht ans ganze Team? co-co fasst alles zu einer E-Mail zusammen. Jeder Titel führt mit einem Klick direkt ins Programm. Und für WhatsApp gibt es eine kurze Version.',
  },
  // ---- Kapitel 7: Leitende (MiData) ----
  {
    id: 'midata-card',
    card: ['Kapitel 7 · Wer leitet was?', 'Die richtigen Leute am richtigen Ort', 'Für Wanderung und Wasser braucht es Leitende mit der passenden Ausbildung. Die stehen in MiData, der Mitgliederdatenbank der Pfadi.', 'co-co schaut nur nach – es verändert nichts'],
    voice: 'Für Wanderung und Wasser braucht es Leitende mit der passenden Ausbildung. Das steht nicht in eCamp, sondern in MiData, der Mitgliederdatenbank der Pfadi.',
  },
  {
    id: 'midata-pick',
    kicker: 'Kapitel 7 · Wer leitet was?',
    title: 'Das richtige Lager in MiData finden',
    sub: 'co-co schlägt den passenden Anlass aus MiData vor. Falk wählt ihn mit einem Klick und lädt die Zahlen.',
    voice: 'co-co schlägt den passenden Anlass aus MiData vor. Falk wählt ihn mit einem Klick und lädt die Zahlen. Wie viele Kinder, wie viele Leitende, und wie alt sie sind.',
  },
  {
    id: 'matrix',
    kicker: 'Kapitel 7 · Wer leitet was?',
    title: 'Wer hat welche Ausbildung?',
    sub: 'Die Übersicht zeigt für jede Leiterin und jeden Leiter, welche Ausbildung am Lagerbeginn gültig ist – und ob die Verantwortlichen der heiklen Aktivitäten dazu passen.',
    voice: 'Die Übersicht zeigt, wer welche Ausbildung hat, gültig am Lagerbeginn. Und ob die Verantwortlichen der heiklen Aktivitäten dazu passen. Ein klarer Punkt für das nächste Gespräch mit Anna.',
  },
  // ---- Kapitel 8: Anmeldung (NDS + Personen) ----
  {
    id: 'nds',
    kicker: 'Kapitel 8 · Die Anmeldung bei J+S',
    title: 'Stimmt alles in der NDS?',
    sub: 'Die NDS ist die Datenbank von J+S. co-co zeigt, ob das Lager angemeldet ist, wie viele Kinder geplant und wie viele effektiv dabei sind – und erinnert an die offene Anwesenheitskontrolle.',
    voice: 'Dann ist da noch die NDS, die Datenbank von J+S. co-co zeigt, ob das Lager angemeldet ist, wie viele Kinder geplant und wie viele effektiv dabei sind. Und es erinnert Falk an die offene Anwesenheitskontrolle.',
  },
  {
    id: 'personen',
    kicker: 'Kapitel 8 · Die Anmeldung bei J+S',
    title: 'Ist jedes Kind richtig angemeldet?',
    sub: 'Der Personen-Abgleich legt MiData und NDS nebeneinander: Wer fehlt in der NDS, wo ist etwas unklar? Dazu J+S-Alter und Ausbildungen jeder Person.',
    voice: 'Ist jedes Kind richtig angemeldet? Der Personen-Abgleich legt MiData und NDS nebeneinander. Clara fehlt in der NDS. Bei Ben ist etwas unklar. Dazu sieht Falk das J+S-Alter und die Ausbildungen jeder Person.',
  },
  {
    id: 'datenschutz',
    kicker: 'Datenschutz',
    title: 'Personendaten bleiben bei Falk',
    sub: 'Namen und Geburtsdaten bleiben auf diesem Computer, Geburtsdaten sind verdeckt – und nichts davon geht je an eine KI.',
    voice: 'Und das Wichtigste: Diese Personendaten bleiben auf Falks Computer. Geburtsdaten sind verdeckt. Und nichts davon geht je an eine KI.',
  },
  // ---- Kapitel 9–10 ----
  {
    id: 'selfcheck',
    kicker: 'Kapitel 9 · Das Team zieht mit',
    title: 'Das Team kann selbst vorprüfen',
    sub: 'Mit dem Selbstcheck prüft Anna ihr Lager vor der Abgabe selbst – mit denselben Regeln und einem Bericht zum Weitergeben.',
    voice: 'Und das Leitungsteam kann selbst vorarbeiten. Mit dem Selbstcheck prüft Anna ihr Lager vor der Abgabe. Mit denselben Regeln, und mit einem Bericht zum Weitergeben.',
  },
  {
    id: 'radar',
    kicker: 'Kapitel 10 · Bis zum Lagerstart',
    title: 'Keine Frist verpassen',
    sub: 'GP an den Coach, Lagermeldung, Material, Sicherheitskonzept, J+S-Anmeldung: alle Termine aller Lager an einem Ort.',
    voice: 'Bis zum Lagerstart gibt es viele Termine. Das GP an den Coach, die Lagermeldung, Material, das Sicherheitskonzept. co-co sammelt sie für alle Lager an einem Ort.',
  },
  {
    id: 'ics',
    kicker: 'Kapitel 10 · Bis zum Lagerstart',
    title: 'Direkt im Kalender',
    sub: 'Ein Klick – und alle Fristen stehen in Falks Kalender.',
    voice: 'Und mit einem Klick stehen alle Fristen in Falks Kalender.',
  },
  // ---- Outro ----
  {
    id: 'outro',
    card: ['co-co · Coach Cockpit', 'Weniger suchen. Mehr coachen.', 'Damit Falk Zeit hat für das, was zählt: das Gespräch mit dem Leitungsteam.', 'Deine Daten bleiben bei dir · verschlüsselt gespeichert · keine Personendaten an die KI'],
    voice: 'co-co, das Coach Cockpit. Weniger suchen, mehr coachen. Deine Daten bleiben bei dir, und Personendaten gehen nie an eine KI. Damit Falk Zeit hat für das, was zählt: das Gespräch mit dem Leitungsteam.',
  },
]
