/**
 * Pronunciation dictionary for the narration (Piper voice de_DE-thorsten-high).
 * Story texts are written in normal spelling; `speakable()` swaps terms the German voice gets wrong
 * for phonetic spellings. Checked with Piper's phonemizer (tools/promo-video/README.md).
 * Order matters: longer terms first.
 */
export const PRONOUNCE = [
  ['Coach Cockpit', 'Coach-Kockpitt'],
  ['J+S', 'I und Ess'], // Swiss: «I und Ess», not «Jot und Es»
  ['co-co', 'Ko-Ko'],
  ['Co-Co', 'Ko-Ko'],
  ['eCamp', 'Ih-Kämp'],
  ['MiData', 'Mi-Data'],
  ['NDS', 'En-De-Es'],
  ['GP', 'Ge-Pe'],
  ['DP', 'De-Pe'],
  ['Detailprogramm', 'Detaiprogramm'],
  ['Checkliste', 'Tscheck-Liste'],
  ['Selbstcheck', 'Selbst-Tscheck'],
  ['Feedback', 'Fiedbäck'],
  ['E-Mail', 'Ih-Mejl'],
  ['Chat', 'Tschätt'],
  ['WhatsApp', 'Wotts-Äpp'],
  ['Leitungsteam', 'Leitungs-Tiem'],
  ['Team', 'Tiem'],
  ['coachen', 'kohtschen'],
  ['KI', 'künstliche Intelligenz'],
]

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const RULES = PRONOUNCE.map(([from, to]) => [new RegExp(`(?<![\\wÄÖÜäöü-])${esc(from)}(?![\\wÄÖÜäöü])`, 'g'), to])

/** Text as it should be fed to the TTS voice. */
export function speakable(text) {
  let out = text.replace(/J\+S-/g, 'I-und-Ess-') // compounds: «J+S-Zeit» -> «I-und-Ess-Zeit»
  for (const [re, to] of RULES) out = out.replace(re, to)
  return out
}
