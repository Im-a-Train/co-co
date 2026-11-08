/**
 * Records a German promo video of co-co: the app in mock mode (?mock=1, no real data) plus the public
 * MiData test instance (pbs.puzzle.ch, sign-in page only, no login). Captions, title cards and a
 * visible cursor are drawn by an overlay injected into every page, so the recording needs no editing.
 *
 * Usage (from the repo root):
 *   (the script starts vite on PROMO_PORT if nothing is running there)
 *   node tools/promo-video/record.mjs [outDir]
 * Env: PROMO_PORT (default 1437), PROMO_MIDATA_URL (default https://pbs.puzzle.ch/de/users/sign_in)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const PORT = Number(process.env.PROMO_PORT || 1437)
const APP = `http://localhost:${PORT}/?mock=1`
const MIDATA = process.env.PROMO_MIDATA_URL || 'https://pbs.puzzle.ch/de/users/sign_in'
const CAMP = '70ca971c992f'
const OUT = resolve(process.argv[2] || join(repo, 'promo-out'))
const W = 1600 // CSS viewport
const H = 900
const SCALE = 1.2 // device scale factor -> 1920x1080 video
const VW = Math.round(W * SCALE)
const VH = Math.round(H * SCALE)
const FPS = 25
const FFMPEG = process.env.PROMO_FFMPEG || findPlaywrightFfmpeg()

function findPlaywrightFfmpeg() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.LOCALAPPDATA || join(homedir(), '.cache'), 'ms-playwright')
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith('ffmpeg-')).sort().reverse() : []
  for (const d of dirs) for (const f of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac']) if (existsSync(join(base, d, f))) return join(base, d, f)
  throw new Error('No ffmpeg found. Run: npx playwright-core install ffmpeg (or set PROMO_FFMPEG)')
}
mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------------------------------------
// Overlay (runs in every document). Only CSSOM styles, so a strict CSP on a site does not block it.
const overlayInit = () => {
  const BLUE = '#1f5f8b'
  const S = (el, s) => Object.assign(el.style, s)
  const mk = (tag, s, parent) => {
    const el = document.createElement(tag)
    if (s) S(el, s)
    if (parent) parent.appendChild(el)
    return el
  }
  function build() {
    if (window.__promo || !document.documentElement) return
    const root = mk('div', { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647', fontFamily: 'Roboto, "Segoe UI", Arial, sans-serif' }, document.documentElement)

    // Caption
    const cap = mk('div', {
      position: 'absolute', left: '50%', bottom: '28px', transform: 'translate(-50%, 30px)', opacity: '0',
      transition: 'opacity .45s ease, transform .45s ease', maxWidth: '1180px', width: 'max-content',
      background: 'rgba(15, 35, 52, 0.92)', color: '#fff', borderRadius: '16px', padding: '16px 28px 18px',
      boxShadow: '0 12px 40px rgba(0,0,0,.35)', borderLeft: '6px solid #f0b429',
    }, root)
    const capKicker = mk('div', { fontSize: '15px', letterSpacing: '.12em', textTransform: 'uppercase', color: '#f0b429', fontWeight: '700', marginBottom: '4px' }, cap)
    const capTitle = mk('div', { fontSize: '30px', fontWeight: '700', lineHeight: '1.2' }, cap)
    const capSub = mk('div', { fontSize: '20px', marginTop: '6px', color: '#d6e4ee', lineHeight: '1.35' }, cap)

    // Title card
    const card = mk('div', {
      position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: `radial-gradient(circle at 30% 20%, #2e7cb3 0%, ${BLUE} 45%, #0e2f47 100%)`, color: '#fff',
      opacity: '0', transition: 'opacity .6s ease', textAlign: 'center', padding: '0 80px',
    }, root)
    const cardKicker = mk('div', { fontSize: '22px', letterSpacing: '.2em', textTransform: 'uppercase', color: '#f0b429', fontWeight: '700' }, card)
    const cardTitle = mk('div', { fontSize: '88px', fontWeight: '800', margin: '14px 0 10px', letterSpacing: '-.01em' }, card)
    const cardSub = mk('div', { fontSize: '32px', color: '#d6e4ee', maxWidth: '1200px', lineHeight: '1.35' }, card)
    const cardFoot = mk('div', { fontSize: '20px', color: '#a9c4d8', marginTop: '36px' }, card)

    // Cursor + highlight ring
    const cursor = mk('div', {
      position: 'absolute', left: `${innerWidth / 2}px`, top: `${innerHeight / 2}px`, width: '26px', height: '26px', marginLeft: '-13px', marginTop: '-13px',
      borderRadius: '50%', background: 'rgba(240, 180, 41, .55)', border: '3px solid #fff', boxShadow: '0 2px 10px rgba(0,0,0,.4)',
      transition: 'left .7s cubic-bezier(.4,0,.2,1), top .7s cubic-bezier(.4,0,.2,1), transform .15s ease', opacity: '0',
    }, root)
    const ring = mk('div', {
      position: 'absolute', border: '4px solid #f0b429', borderRadius: '12px', boxShadow: '0 0 0 9999px rgba(10,25,40,.28)',
      opacity: '0', transition: 'all .5s ease',
    }, root)

    window.__promo = {
      caption(kicker, title, sub) {
        capKicker.textContent = kicker || ''
        capTitle.textContent = title || ''
        capSub.textContent = sub || ''
        capSub.style.display = sub ? 'block' : 'none'
        S(cap, { opacity: '1', transform: 'translate(-50%, 0)' })
      },
      hideCaption() { S(cap, { opacity: '0', transform: 'translate(-50%, 30px)' }) },
      card(kicker, title, sub, foot) {
        cardKicker.textContent = kicker || ''
        cardTitle.textContent = title || ''
        cardSub.textContent = sub || ''
        cardFoot.textContent = foot || ''
        S(card, { opacity: '1' })
        S(cursor, { opacity: '0' })
      },
      cardInstant() { S(card, { transition: 'none', opacity: '1' }); void card.offsetWidth; S(card, { transition: 'opacity .6s ease' }) },
      hideCard() { S(card, { opacity: '0' }) },
      cursor(x, y) { S(cursor, { opacity: '1', left: `${x}px`, top: `${y}px` }) },
      press() { S(cursor, { transform: 'scale(.7)' }); setTimeout(() => S(cursor, { transform: 'scale(1)' }), 180) },
      ring(r) { S(ring, { opacity: '1', left: `${r.x - 8}px`, top: `${r.y - 8}px`, width: `${r.width + 16}px`, height: `${r.height + 16}px` }) },
      hideRing() { S(ring, { opacity: '0' }) },
    }
    // Start with the title card already covering the page on the intro URL and on the MiData site.
    if (location.hostname !== 'localhost' || /promoIntro=1/.test(location.search)) window.__promo.cardInstant()
  }
  if (document.documentElement) build()
  else {
    const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); build() } })
    mo.observe(document, { childList: true })
  }
}

// ---------------------------------------------------------------------------------------------
/**
 * Screen recorder: CDP screencast JPEG frames, repeated at a constant frame rate into ffmpeg (VP9, CRF).
 * Better quality than Playwright's recordVideo (realtime VP8/VP9 at ~1 Mbit/s).
 */
async function startRecorder(page, file) {
  const ff = spawn(FFMPEG, [
    '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-vf', `scale=${VW}:${VH},format=yuv420p`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28',
    '-deadline', 'good', '-cpu-used', '5', '-row-mt', '1', '-threads', '8', '-g', String(FPS * 2), '-an', '-y', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((res, rej) => ff.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))))
  let cdp = null
  let last = null
  async function attach() {
    cdp = await page.context().newCDPSession(page)
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      last = Buffer.from(data, 'base64')
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW, maxHeight: VH, everyNthFrame: 1 })
  }
  await attach()
  while (!last) await new Promise((r) => setTimeout(r, 20))
  const t0 = Date.now()
  let written = 0
  const timer = setInterval(() => {
    const due = Math.floor(((Date.now() - t0) / 1000) * FPS)
    while (written < due) { ff.stdin.write(last); written++ }
  }, 1000 / FPS / 2)
  return {
    /** Re-attach after a cross-site navigation (new renderer, screencast stops). */
    async reattach() { await cdp.detach().catch(() => {}); await attach() },
    async stop() {
      clearInterval(timer)
      await cdp.send('Page.stopScreencast').catch(() => {})
      ff.stdin.end()
      await done
      return written / FPS
    },
  }
}

async function isUp() {
  try { return (await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(3000) })).ok } catch { return false }
}
let server = null
async function ensureServer() {
  if (await isUp()) return
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  server = spawn(cmd, ['vite', '--port', String(PORT), '--strictPort'], { cwd: join(repo, 'apps', 'desktop'), stdio: 'ignore', shell: process.platform === 'win32' })
  for (let i = 0; i < 120; i++) {
    if (await isUp()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('vite dev server did not start')
}

async function main() {
  console.log('starting server / browser')
  await ensureServer()
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  // Warm-up context (not recorded) so Vite's dependency optimisation is done before filming.
  {
    const warm = await browser.newContext({ viewport: { width: W, height: H } })
    const p = await warm.newPage()
    await p.goto(`${APP}#/lager/${CAMP}/uebersicht`)
    await p.waitForSelector('.v-application', { timeout: 30000 })
    await p.waitForTimeout(3000)
    await warm.close()
  }

  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: SCALE, locale: 'de-CH', timezoneId: 'Europe/Zurich',
  })
  await ctx.addInitScript(overlayInit)
  const page = await ctx.newPage()
  const wait = (ms) => page.waitForTimeout(ms)
  const P = (fn, ...a) => page.evaluate(([f, args]) => window.__promo?.[f]?.(...args), [fn, a])
  const caption = async (kicker, title, sub, hold = 0) => { await P('caption', kicker, title, sub); if (hold) await wait(hold) }
  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector('.v-overlay--active'), null, { timeout: 6000 }).catch(() => {})
  }
  const nav = async (hash) => {
    await settle()
    await page.goto(`${APP}#${hash}`)
    await page.waitForSelector('.v-application', { timeout: 15000 })
    await wait(1200)
  }
  const tab = (name) => nav(`/lager/${CAMP}/${name}`)
  async function pointAt(locator, { ring = false } = {}) {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
    const b = await locator.boundingBox({ timeout: 5000 })
    if (!b) throw new Error('no bounding box')
    await P('cursor', b.x + b.width / 2, b.y + b.height / 2)
    if (ring) await P('ring', b)
    await wait(800)
    return b
  }
  async function click(locator, opts = {}) {
    const loc = locator.first()
    await pointAt(loc, opts)
    await P('press')
    await loc.click({ timeout: 5000, ...opts.click })
    await wait(opts.after ?? 700)
  }
  async function highlight(locator, ms = 2200) {
    try { await pointAt(locator.first(), { ring: true }); await wait(ms) } catch { /* optional */ }
    await P('hideRing')
  }
  async function scrollTo(y, ms = 1600) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y)
    await wait(ms)
  }
  async function scene(name, fn) {
    console.log(`scene ${name}`)
    await P('hideCaption')
    await wait(450)
    try { await fn() } catch (e) { console.warn(`scene "${name}" partly failed: ${String(e.message || e).split('\n')[0]}`) }
    await P('hideRing')
  }

  // ---------------- 1. Intro ----------------
  const INTRO = ['J+S-Lagercoaching', 'co-co', 'Das Coach Cockpit für eCamp-Lager: prüfen, verstehen, Feedback geben.', 'Die heissesten Features im Überblick']
  await page.goto('data:text/html,<body style="margin:0;background:%230e2f47"></body>')
  await page.waitForFunction(() => !!window.__promo)
  await P('card', ...INTRO)
  const rec = await startRecorder(page, join(OUT, 'co-co-promo.webm'))
  await wait(1500)
  await page.goto(`${APP}&promoIntro=1#/lager`)
  await page.waitForFunction(() => !!window.__promo)
  await P('card', ...INTRO)
  await page.waitForSelector('.v-application', { timeout: 15000 })
  await wait(3000)
  await P('hideCard')
  await wait(900)

  // ---------------- 2. Meine Lager ----------------
  await scene('lager', async () => {
    await caption('Meine Lager', 'Alle deine Lager auf einen Blick', 'Mit deinem eigenen eCamp-Login – Rolle, Review-Status, Befunde und nächste Frist.', 1800)
    await highlight(page.locator('tbody tr').first(), 2200)
    await click(page.locator('tbody tr'), { after: 1500 })
  })

  // ---------------- 3. Cockpit ----------------
  await scene('uebersicht', async () => {
    await caption('Cockpit', 'Das ganze Lager in Sekunden geprüft', 'Regelpaket «co-co Basis 2026.1»: J+S-Kernregeln, Vollständigkeit, Sicherheit und PBS-Best-Practice.', 1500)
    await highlight(page.locator('.v-card', { hasText: 'Soll-Befunde' }).first(), 2200)
    await scrollTo(560, 1800)
    await caption('Cockpit', 'Die wichtigsten Befunde zuerst', 'Jeder Befund mit Quelle, Schweregrad und Verlässlichkeit – ein Klick zum Feedback.', 3000)
    await scrollTo(0, 1000)
  })

  // ---------------- 4. Raster ----------------
  await scene('raster', async () => {
    await tab('raster')
    await caption('Lagertag-Rechner', 'J+S-Zeit pro Tag – Lücken sofort sichtbar', 'Wochenraster mit gültigen J+S-Tagen und Sozialzeit direkt aus dem eCamp-Programm.', 3600)
  })

  // ---------------- 5. Befunde durchgehen ----------------
  await scene('triage', async () => {
    await tab('befunde')
    await page.waitForSelector('.triage-item', { timeout: 8000 })
    await caption('Befunde durchgehen', 'Triage im Flow – ganz mit der Tastatur', 'F speichert das Feedback, I ignoriert, J/K blättert. co-co springt zum nächsten offenen Befund.', 1500)
    await highlight(page.locator('[data-testid="triage-editor"]'), 2000)
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    for (const key of ['f', 'i']) {
      await caption('Befunde durchgehen', key === 'f' ? 'Taste F – Feedback gespeichert, weiter' : 'Taste I – ignoriert, weiter', 'Fortschritt und Status bleiben pro Lager gespeichert.')
      await page.keyboard.press(key)
      await wait(1800)
    }
    await highlight(page.locator('[data-testid="triage-progress"]'), 1600)
  })

  // ---------------- 6. Warum? ----------------
  await scene('warum', async () => {
    const panel = page.locator('[data-testid="finding-explain"]').first()
    await caption('Neu: «Warum?»', 'Jeder Befund ist erklärbar', 'Regel und Version, Regelpaket, verwendete Angaben und geprüfte Werte – transparent statt Blackbox.')
    await click(panel.getByRole('button', { name: 'Warum?' }), { after: 900 })
    await highlight(page.locator('[data-testid="finding-explain-body"]'), 3800)
  })

  // ---------------- 7. Feedback + eCamp-Kommentare ----------------
  await scene('feedback', async () => {
    await tab('feedback')
    await caption('Feedback', 'Lob, Auflage, Anregung oder Frage', 'Für das ganze Lager oder eine Aktivität – Vorlagen pro Review-Zeitpunkt, teilen per WhatsApp, Mail oder Text.', 2600)
    await click(page.getByRole('button', { name: 'Aktivitäts-Punkt' }), { after: 900 })
    await click(page.locator('.v-select'), { after: 700 })
    await click(page.locator('.v-overlay--active .v-list-item'), { after: 600 })
    await page.locator('.v-card textarea').first().pressSequentially('Bitte Sicherheitsüberlegungen und Schlechtwettervariante ergänzen.', { delay: 28 })
    await wait(500)
    await click(page.getByRole('button', { name: 'Speichern', exact: true }), { after: 1000 })
    const card = page.getByTestId('feedback-item').filter({ hasText: 'Schlechtwettervariante' })
    await caption('Neu: Kommentar-Sync', 'Direkt als eCamp-Kommentar posten', 'Das Feedback landet genau bei der Aktivität – dort, wo das Leitungsteam plant.')
    await click(card.getByRole('button', { name: 'In eCamp posten' }), { after: 1500 })
    await caption('Neu: Kommentar-Sync', 'Antworten und Erledigtes zurückholen', 'Ein Klick synchronisiert: Was in eCamp erledigt oder beantwortet wurde, sieht der Coach sofort.')
    await click(page.getByTestId('sync-comments'), { after: 1500 })
    await highlight(page.getByTestId('chip-resolved').first(), 2000)
    await click(page.getByTestId('chip-replies'), { after: 1200 })
    await highlight(page.getByTestId('reply-list').first(), 2400)
  })

  // ---------------- 8. MiData: Testumgebung ----------------
  await scene('midata-card', async () => {
    await P('hideCaption')
    await P('card', 'Neu', 'MiData-Anbindung', 'Teilnehmende, Leitende und Qualifikationen – direkt aus der MiData der PBS.', 'Nur lesend · mit deinem eigenen Login · Rote Zone')
    await wait(3800)
  })
  await scene('midata-site', async () => {
    await page.goto(MIDATA, { waitUntil: 'commit', timeout: 30000 })
    await page.waitForFunction(() => !!window.__promo, null, { timeout: 30000 })
    await rec.reattach()
    await P('card', 'Neu', 'MiData-Anbindung', 'Teilnehmende, Leitende und Qualifikationen – direkt aus der MiData der PBS.', 'Nur lesend · mit deinem eigenen Login · Rote Zone')
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 })
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
    await wait(400)
    await P('hideCard')
    await wait(800)
    await caption('MiData-Testumgebung', 'pbs.puzzle.ch – die Integrationsinstanz der PBS-MiData', 'Hier wird die Anbindung getestet. co-co nutzt dein eigenes Konto – oder übernimmt die Sitzung aus dem eCamp-Login.', 1500)
    const form = page.locator('form').first()
    await highlight(form, 3200)
    await caption('MiData-Testumgebung', 'Kein Backend, keine Kopie deiner Daten', 'co-co spricht direkt mit MiData. Personendaten bleiben in Rust auf deinem Gerät – nie in der UI, nie bei der KI.', 4200)
  })

  // ---------------- 9. MiData in co-co ----------------
  await scene('midata-settings', async () => {
    await page.goto(`${APP}#/einstellungen`)
    await rec.reattach()
    await page.waitForSelector('[data-testid="midata-settings"]', { timeout: 10000 })
    await wait(1000)
    await caption('Einstellungen', 'MiData verbinden – automatisch per eCamp-OAuth', 'Wer sich bei eCamp mit MiData anmeldet, ist auch in co-co gleich verbunden. Alternativ per Service-Token.')
    await highlight(page.getByTestId('midata-settings'), 3600)
  })
  await scene('midata-angaben', async () => {
    await tab('angaben')
    await page.waitForSelector('[data-testid="midata-card"]', { timeout: 8000 })
    await caption('Lager-Angaben', 'MiData-Anlass verknüpfen und laden', 'co-co schlägt passende Anlässe vor – mit Abteilung, Region und Datumsabgleich.')
    const pick = page.getByTestId('midata-pick')
    if (await pick.count()) {
      await click(pick, { after: 900 })
      await page.getByTestId('midata-event-4101').waitFor({ timeout: 5000 })
      await wait(1400)
      await click(page.getByTestId('midata-event-4101'), { after: 900 })
    }
    await click(page.getByTestId('midata-refresh'), { after: 1200 })
    await page.waitForSelector('[data-testid="midata-summary"]', { timeout: 8000 })
    await caption('Rote Zone · nur Zahlen', 'Teilnehmende, J+S-Alter, Leitende', 'In der Oberfläche landen nur Aggregate – keine Namen von Teilnehmenden, keine Geburtsdaten.')
    await highlight(page.getByTestId('midata-summary'), 3000)
    await click(page.getByTestId('midata-adopt-open'), { after: 900 })
    await caption('Rote Zone · nur Zahlen', 'Mit einem Klick in die Lager-Angaben übernehmen', 'Die Regeln rechnen damit sofort weiter – z. B. Betreuungsverhältnis und SLRG-Abdeckung.')
    await wait(1200)
    await click(page.getByTestId('adopt-apply'), { after: 1200 })
    const matrix = page.getByTestId('qual-matrix')
    await caption('Qualifikationen', 'Wer darf was? Die Qualifikationsmatrix', 'Lagerleiter, LS/T, Wasser, Berg, Winter, SLRG – gültig am Lagerbeginn, abgeglichen mit den sicherheitsrelevanten Aktivitäten.')
    await highlight(matrix, 4800)
  })

  // ---------------- 10. Selbstcheck ----------------
  await scene('selfcheck', async () => {
    await tab('selbstcheck')
    await page.waitForSelector('[data-testid="selfcheck-start"]', { timeout: 8000 })
    await caption('Neu: Selbstcheck', 'Lagerleitende prüfen ihr Lager vor der Abgabe', 'Entwurfsrunden mit Fortschritt und Bericht – ohne die offiziellen Review-Runden zu berühren.', 1500)
    await page.waitForFunction(() => !document.querySelector('[data-testid="selfcheck-start"]')?.hasAttribute('disabled'), null, { timeout: 8000 })
    await click(page.getByTestId('selfcheck-start'), { after: 800 })
    await page.locator('[data-testid="selfcheck-note"] textarea').first().pressSequentially('Entwurf vor der Abgabe', { delay: 35 })
    await click(page.getByTestId('selfcheck-confirm'), { after: 1500 })
    await highlight(page.getByTestId('selfcheck-report'), 3200)
  })

  // ---------------- 11. Fristen-Radar ----------------
  await scene('radar', async () => {
    await nav('/fristen')
    await caption('Neu: Fristen-Radar', 'Nie wieder eine Frist verpassen', 'Überfällig, diese Woche, nächste 4 Wochen, später – für alle deine Lager, inklusive PBS-Meilensteine.', 1500)
    await highlight(page.locator('[data-testid^="radar-head-"]').first().locator('xpath=..'), 2600)
    await caption('Neu: Fristen-Radar', 'Als Kalender exportieren (.ics)', 'Alle Fristen in Outlook, Google oder Apple Kalender – mit Quelle (J+S-Regel oder Hering).')
    await highlight(page.getByTestId('export-ics'), 2400)
    await highlight(page.getByTestId('milestone-row').first(), 2200)
  })

  // ---------------- 12. Outro ----------------
  await P('hideCaption')
  await P('card', 'co-co · Coach Cockpit', 'Weniger suchen. Mehr coachen.', 'eCamp · MiData · NDS · J+S- und PBS-Regeln – in einer Desktop-App.', 'Kein eigenes Backend · Daten bleiben auf deinem Gerät · KI optional und abgeschaltet')
  await wait(5500)

  const seconds = await rec.stop()
  await ctx.close()
  await browser.close()
  console.log(`Video: ${join(OUT, 'co-co-promo.webm')} (${seconds.toFixed(1)} s, ${VW}x${VH})`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => { if (server) server.kill(); process.exit() })
