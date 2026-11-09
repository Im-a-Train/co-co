/**
 * Records the German promo video of co-co as a short story (coach «Falk» coaches one camp), see story.mjs.
 *
 * Stage: a small wrapper page (served by a route on the dev server origin) shows the app in an iframe on
 * top and a caption strip below it, so captions never cover the app. Title cards cover the whole stage.
 * Navigation is visible: tabs and side menu are clicked with the (drawn) cursor; the element in focus is
 * scrolled to the middle of the screen. The app runs in mock mode with the promo scenario (invented data).
 *
 * Each beat waits for its narration (durations from tts.py), and its start time goes to timeline.json,
 * so mix.mjs can lay the voice clips exactly under the picture. See README.md for the full pipeline.
 *
 *   node tools/promo-video/record.mjs [outDir]     (voice clips expected in <outDir>/voice)
 * Env: PROMO_PORT (default 1437), PROMO_SCENARIO (default promo), PROMO_VOICE_DIR, PROMO_FFMPEG
 */
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { BEATS } from './story.mjs'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const PORT = Number(process.env.PROMO_PORT || 1437)
const SCENARIO = process.env.PROMO_SCENARIO ?? 'promo' // mock scenario with a nice camp week (src/dev)
const ORIGIN = `http://localhost:${PORT}`
const APP = `${ORIGIN}/?mock=1${SCENARIO ? `&scenario=${SCENARIO}` : ''}`
const STAGE = `${ORIGIN}/__promo__/stage.html`
const CAMP = '70ca971c992f'
const OUT = resolve(process.argv[2] || join(repo, 'promo-out'))
const W = 1820 // CSS size of the whole stage
const H = 1024
const STRIP = 140 // caption strip below the app
const APP_H = H - STRIP // the app itself: 1820 x 884
const VW = 1920 // video size
const VH = 1080
const SCALE = VW / W
const FPS = 25
const FFMPEG = process.env.PROMO_FFMPEG || findPlaywrightFfmpeg()

function findPlaywrightFfmpeg() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.LOCALAPPDATA || join(homedir(), '.cache'), 'ms-playwright')
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith('ffmpeg-')).sort().reverse() : []
  for (const d of dirs) for (const f of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac']) if (existsSync(join(base, d, f))) return join(base, d, f)
  throw new Error('No ffmpeg found. Run: npx playwright-core install ffmpeg (or set PROMO_FFMPEG)')
}
mkdirSync(OUT, { recursive: true })

const STAGE_HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>co-co promo</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0f2334}
#app{display:block;border:0;width:100%;height:${APP_H}px;background:#f3f4f6}</style></head>
<body><iframe id="app" name="app" src="about:blank"></iframe></body></html>`

// ---------------------------------------------------------------------------------------------
// Overlay (runs in every document). Top frame (stage): caption strip + title cards. App frame: cursor + ring.
const overlayInit = (cfg) => {
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
    const isStage = window === window.top
    const root = mk('div', { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647', fontFamily: 'Roboto, "Segoe UI", Arial, sans-serif' }, document.documentElement)
    const api = {}
    if (isStage) {
      // Caption strip (always there, text fades)
      const strip = mk('div', {
        position: 'absolute', left: '0', right: '0', bottom: '0', height: `${cfg.strip}px`, boxSizing: 'border-box',
        background: '#0f2334', borderTop: '4px solid #f0b429', padding: '14px 56px', color: '#fff',
      }, root)
      const capInner = mk('div', { opacity: '0', transition: 'opacity .4s ease' }, strip)
      const capKicker = mk('div', { fontSize: '14px', letterSpacing: '.12em', textTransform: 'uppercase', color: '#f0b429', fontWeight: '700', marginBottom: '3px' }, capInner)
      const capTitle = mk('div', { fontSize: '27px', fontWeight: '700', lineHeight: '1.2' }, capInner)
      const capSub = mk('div', { fontSize: '18px', marginTop: '5px', color: '#d6e4ee', lineHeight: '1.35' }, capInner)
      // Title card
      const card = mk('div', {
        position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: `radial-gradient(circle at 30% 20%, #2e7cb3 0%, ${BLUE} 45%, #0e2f47 100%)`, color: '#fff',
        opacity: '0', transition: 'opacity .6s ease', textAlign: 'center', padding: '0 80px',
      }, root)
      const cardKicker = mk('div', { fontSize: '22px', letterSpacing: '.2em', textTransform: 'uppercase', color: '#f0b429', fontWeight: '700' }, card)
      const cardTitle = mk('div', { fontSize: '88px', fontWeight: '800', margin: '14px 0 10px', letterSpacing: '-.01em' }, card)
      const cardSub = mk('div', { fontSize: '32px', color: '#d6e4ee', maxWidth: '1300px', lineHeight: '1.35' }, card)
      const cardFoot = mk('div', { fontSize: '20px', color: '#a9c4d8', marginTop: '36px' }, card)
      Object.assign(api, {
        caption(kicker, title, sub) {
          capKicker.textContent = kicker || ''
          capTitle.textContent = title || ''
          capSub.textContent = sub || ''
          S(capInner, { opacity: '1' })
        },
        hideCaption() { S(capInner, { opacity: '0' }) },
        card(kicker, title, sub, foot) {
          cardKicker.textContent = kicker || ''
          cardTitle.textContent = title || ''
          cardSub.textContent = sub || ''
          cardFoot.textContent = foot || ''
          S(card, { opacity: '1' })
        },
        cardInstant() { S(card, { transition: 'none', opacity: '1' }); void card.offsetWidth; S(card, { transition: 'opacity .6s ease' }) },
        hideCard() { S(card, { opacity: '0' }) },
      })
    } else {
      // Cursor + highlight ring inside the app
      const cursor = mk('div', {
        position: 'absolute', left: `${innerWidth / 2}px`, top: `${innerHeight / 2}px`, width: '26px', height: '26px', marginLeft: '-13px', marginTop: '-13px',
        borderRadius: '50%', background: 'rgba(240, 180, 41, .55)', border: '3px solid #fff', boxShadow: '0 2px 10px rgba(0,0,0,.4)',
        transition: 'left .7s cubic-bezier(.4,0,.2,1), top .7s cubic-bezier(.4,0,.2,1), transform .15s ease', opacity: '0',
      }, root)
      const ring = mk('div', {
        position: 'absolute', border: '4px solid #f0b429', borderRadius: '12px', boxShadow: '0 0 0 9999px rgba(10,25,40,.25)',
        opacity: '0', transition: 'all .5s ease',
      }, root)
      Object.assign(api, {
        cursor(x, y) { S(cursor, { opacity: '1', left: `${x}px`, top: `${y}px` }) },
        hideCursor() { S(cursor, { opacity: '0' }) },
        press() { S(cursor, { transform: 'scale(.7)' }); setTimeout(() => S(cursor, { transform: 'scale(1)' }), 180) },
        ring(r) { S(ring, { opacity: '1', left: `${r.x - 8}px`, top: `${r.y - 8}px`, width: `${r.width + 16}px`, height: `${r.height + 16}px` }) },
        hideRing() { S(ring, { opacity: '0' }) },
      })
    }
    window.__promo = api
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
  const cdp = await page.context().newCDPSession(page)
  let last = null
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    last = Buffer.from(data, 'base64')
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW, maxHeight: VH, everyNthFrame: 1 })
  while (!last) await new Promise((r) => setTimeout(r, 20))
  const t0 = Date.now()
  let written = 0
  const timer = setInterval(() => {
    const due = Math.floor(((Date.now() - t0) / 1000) * FPS)
    while (written < due) { ff.stdin.write(last); written++ }
  }, 1000 / FPS / 2)
  return {
    /** Seconds since the first recorded frame. */
    time() { return (Date.now() - t0) / 1000 },
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
  try { return (await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(3000) })).ok } catch { return false }
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
  const byId = Object.fromEntries(BEATS.map((b) => [b.id, b]))
  const voiceDir = process.env.PROMO_VOICE_DIR || join(OUT, 'voice')
  const durFile = join(voiceDir, 'durations.json')
  const durations = existsSync(durFile) ? JSON.parse(readFileSync(durFile, 'utf8')) : {}
  if (!Object.keys(durations).length) console.warn(`no ${durFile}: timing by text length, video without voice`)

  console.log('starting server / browser')
  await ensureServer()
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  // Warm-up context (not recorded) so Vite's dependency optimisation is done before filming.
  {
    const warm = await browser.newContext({ viewport: { width: W, height: APP_H } })
    const p = await warm.newPage()
    await p.goto(`${APP}#/lager/${CAMP}/uebersicht`)
    await p.waitForSelector('.v-application', { timeout: 30000 })
    await p.waitForTimeout(3000)
    await warm.close()
  }

  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, locale: 'de-CH', timezoneId: 'Europe/Zurich' })
  await ctx.route(STAGE, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STAGE_HTML }))
  await ctx.addInitScript(overlayInit, { strip: STRIP })
  const page = await ctx.newPage()
  await page.goto(STAGE)
  const app = page.frame({ name: 'app' })
  if (!app) throw new Error('app frame missing')

  const wait = (ms) => page.waitForTimeout(ms)
  /** Stage overlay (captions, cards). */
  const P = (fn, ...a) => page.evaluate(([f, args]) => window.__promo?.[f]?.(...args), [fn, a])
  /** App overlay (cursor, ring). */
  const A = (fn, ...a) => app.evaluate(([f, args]) => window.__promo?.[f]?.(...args), [fn, a]).catch(() => {})
  const settle = async () => {
    await app.waitForFunction(() => !document.querySelector('.v-overlay--active'), null, { timeout: 6000 }).catch(() => {})
  }
  const TOP_BAR = 64
  /** Scrolls the element to the middle of the app (tall ones to the top), moves the cursor there, optionally rings it. */
  async function pointAt(locator, { ring = false } = {}) {
    await locator.waitFor({ state: 'visible', timeout: 6000 })
    await locator.evaluate((el, topBar) => {
      const tall = el.getBoundingClientRect().height > innerHeight * 0.75
      el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'smooth' })
      if (tall) setTimeout(() => window.scrollBy({ top: -(topBar + 24), behavior: 'smooth' }), 350)
    }, TOP_BAR)
    await wait(750)
    const b = await locator.boundingBox({ timeout: 5000 })
    if (!b) throw new Error('no bounding box')
    const y1 = Math.max(b.y, TOP_BAR + 6)
    const y2 = Math.min(b.y + b.height, APP_H - 6)
    const r = { x: b.x, y: y1, width: b.width, height: Math.max(20, y2 - y1) }
    await A('cursor', r.x + r.width / 2, r.y + Math.min(r.height / 2, 120))
    if (ring) await A('ring', r)
    await wait(650)
    return r
  }
  /** First visible match (the app keeps hidden duplicates, e.g. in the side menu). */
  const vis = (locator) => locator.filter({ visible: true }).first()
  async function click(locator, opts = {}) {
    const loc = vis(locator)
    await pointAt(loc, opts)
    await A('press')
    await loc.click({ timeout: 5000 })
    await wait(opts.after ?? 700)
  }
  async function highlight(locator, ms = 2200) {
    try { await pointAt(vis(locator), { ring: true }); await wait(ms) } catch (e) { console.warn('  highlight skipped:', String(e.message || e).split('\n')[0]) }
    await A('hideRing')
  }
  async function scrollTo(y, ms = 1600) {
    await app.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y)
    await wait(ms)
  }
  /** Visible navigation: click a camp tab. */
  async function closeDrawers() {
    const scrim = app.locator('.v-navigation-drawer__scrim').filter({ visible: true })
    if (await scrim.count()) { await scrim.first().click({ force: true }).catch(() => {}); await wait(500) }
  }
  async function tab(name) {
    await closeDrawers()
    await settle()
    await scrollTo(0, 500)
    await click(app.locator('.v-tab').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`, 'i') }), { after: 1100 })
  }
  /** Visible navigation: click an entry of the side menu. */
  async function side(name) {
    await settle()
    await click(app.locator('.v-navigation-drawer .v-list-item').filter({ hasText: name }), { after: 1100 })
  }

  // ---- Beats: caption/card + narration timing ----------------------------------------------
  let rec = null
  let active = null
  const timeline = []
  async function finishBeat(pad = 0.5) {
    if (!active) return
    const left = active.t + active.dur + pad - rec.time()
    active = null
    if (left > 0) await wait(left * 1000)
  }
  /** Shows the beat's caption or title card and starts its narration; waits for the previous one first. */
  async function beat(id) {
    const b = byId[id]
    if (!b) throw new Error('unknown beat ' + id)
    await finishBeat()
    if (b.card) {
      await P('hideCaption')
      await P('card', ...b.card)
      await A('hideCursor')
    } else {
      await P('caption', b.kicker, b.title, b.sub)
    }
    const t = rec.time()
    const dur = durations[id] ?? Math.max(4, b.voice.length / 14)
    timeline.push({ id, t: Number(t.toFixed(3)), dur })
    active = { t, dur }
    console.log(`beat ${id} @ ${t.toFixed(1)} s (${dur.toFixed(1)} s)`)
  }
  async function scene(name, fn) {
    try { await fn() } catch (e) { console.warn(`scene "${name}" partly failed: ${String(e.message || e).split('\n')[0]}`) }
    await A('hideRing')
    await finishBeat()
  }
  async function captionOff() { await P('hideCaption'); await wait(300) }

  // ---------------- Pre-roll (not recorded): title card up, NDS connection on, app on «Verbindung» ----------------
  await P('cardInstant')
  await P('card', ...byId.intro.card)
  await app.goto(`${APP}#/einstellungen`)
  await app.waitForSelector('[data-testid="nds-settings"]', { timeout: 20000 })
  await wait(800)
  {
    const sw = app.getByTestId('nds-enable').locator('input')
    if (!(await sw.isChecked().catch(() => true))) await sw.check().catch(() => {})
    await wait(500)
  }
  await app.goto(`${APP}#/verbindung`)
  await app.waitForSelector('.v-application', { timeout: 15000 })
  await wait(1500)

  // ---------------- Intro + Kapitel 1 ----------------
  rec = await startRecorder(page, join(OUT, 'co-co-promo.silent.webm'))
  await scene('intro', () => beat('intro'))
  await scene('auftrag', () => beat('auftrag'))
  await P('hideCard')
  await wait(700)

  // ---------------- Kapitel 2 ----------------
  await scene('login', async () => {
    await beat('login')
    await highlight(app.locator('.v-alert', { hasText: 'angemeldet' }), 2200)
    await highlight(app.locator('.v-card', { hasText: 'Sitzung' }), 2400)
    await finishBeat(0)
    await click(app.locator('.v-btn', { hasText: 'Meine Lager' }), { after: 1000 })
  })
  await scene('lager', async () => {
    await beat('lager')
    await highlight(app.locator('tbody tr').first(), 2500)
    await finishBeat(0)
    await click(app.locator('tbody tr'), { after: 1200 })
  })
  await scene('cockpit', async () => {
    await beat('cockpit')
    await highlight(app.locator('.v-card', { hasText: 'Muss-Befunde' }), 1500)
    await highlight(app.locator('.v-card', { hasText: 'Soll-Befunde' }), 1500)
    await highlight(app.locator('.v-chip', { hasText: 'MiData' }), 1800)
  })

  // ---------------- Kapitel 3: GP ----------------
  await scene('gp', async () => {
    await captionOff()
    await tab('GP')
    await beat('gp')
    await highlight(app.locator('.wg-block', { hasText: 'Seilbrücke' }), 2200)
    await highlight(app.locator('.wg-block', { hasText: 'Zweitageswanderung' }), 2200)
    await scrollTo(380, 2200)
  })
  await scene('zuordnung', async () => {
    await beat('zuordnung')
    const panel = app.getByTestId('grid-mapping-panel')
    const title = panel.locator('.v-expansion-panel-title').first()
    if (await title.count()) {
      const open = await panel.locator('.v-expansion-panel--active').count()
      if (!open) await click(title, { after: 800 })
    }
    await highlight(app.getByTestId('mapping-table'), 1600)
    await click(app.getByTestId('mapping-confirm'), { after: 700 })
    await highlight(app.getByTestId('mapping-confirmed'), 1100)
    await A('hideCursor')
    await scrollTo(0, 1600)
  })

  // ---------------- Kapitel 4: DP ----------------
  await scene('dp', async () => {
    await captionOff()
    await tab('DP')
    await beat('dp')
    await click(app.locator('tbody tr').filter({ hasText: 'Seilbrücke' }), { after: 1200 })
    const drawer = app.locator('.v-navigation-drawer--active').last()
    for (const y of [220, 460]) {
      await drawer.evaluate((el, top) => {
        const sc = el.querySelector('.v-navigation-drawer__content') || el
        sc.scrollTo({ top, behavior: 'smooth' })
      }, y).catch(() => {})
      await wait(2000)
    }
    await finishBeat(0)
    await click(drawer.locator('button:has(.mdi-close)'), { after: 600 })
  })

  // ---------------- Kapitel 5: Durchsehen ----------------
  await scene('triage', async () => {
    await captionOff()
    await tab('Befunde')
    await app.waitForSelector('.triage-item', { timeout: 8000 })
    await beat('triage')
    await highlight(app.locator('.triage-item').first(), 1600)
    await highlight(app.locator('[data-testid="triage-editor"]'), 2400)
    await app.locator('body').click({ position: { x: 5, y: 5 } })
    await wait(600)
    await page.keyboard.press('f')
    await wait(1800)
    await page.keyboard.press('i')
    await wait(1200)
    await highlight(app.locator('[data-testid="triage-progress"]'), 1200)
  })
  await scene('warum', async () => {
    await beat('warum')
    const panel = app.locator('[data-testid="finding-explain"]').first()
    await click(panel.getByRole('button', { name: 'Warum?' }), { after: 900 })
    await highlight(app.locator('[data-testid="finding-explain-body"]'), 5000)
  })

  // ---------------- Kapitel 6: Rückmeldung ----------------
  await scene('feedback', async () => {
    await captionOff()
    await tab('Feedback')
    await beat('feedback')
    await click(app.getByRole('button', { name: 'Aktivitäts-Punkt' }), { after: 800 })
    await click(app.locator('.v-select'), { after: 600 })
    const items = app.locator('.v-overlay--active .v-list-item')
    const wanted = items.filter({ hasText: /Baden/ }).first()
    await click((await wanted.count()) ? wanted : items.first(), { after: 500 })
    await app.locator('.v-card textarea').first().pressSequentially('Bitte Sicherheitsüberlegungen ergänzen: Wer schwimmt, wer schaut zu?', { delay: 12 })
    await wait(400)
    await click(app.getByRole('button', { name: 'Speichern', exact: true }), { after: 900 })
    const card = app.getByTestId('feedback-item').filter({ hasText: 'wer schaut zu' })
    await click(card.getByRole('button', { name: 'In eCamp posten' }), { after: 900 })
    await highlight(card, 900)
  })
  await scene('sync', async () => {
    await beat('sync')
    await click(app.getByTestId('sync-comments'), { after: 1000 })
    await highlight(app.getByTestId('chip-resolved'), 1400)
    await click(app.getByTestId('chip-replies'), { after: 600 })
    await highlight(app.getByTestId('reply-list'), 2600)
  })
  await scene('teilen', async () => {
    await beat('teilen')
    const preview = app.locator('.v-card', { hasText: 'Vorschau' }).last()
    await click(preview.getByRole('tab', { name: /e-mail/i }), { after: 600 })
    await highlight(preview, 3800)
    await click(preview.getByRole('tab', { name: /whatsapp/i }), { after: 600 })
    await highlight(preview, 2200)
  })

  // ---------------- Kapitel 7: Lager-Angaben, top to bottom ----------------
  await scene('midata-card', async () => {
    await captionOff()
    await tab('Angaben')
    await app.waitForSelector('[data-testid="midata-card"]', { timeout: 10000 })
    await beat('midata-card')
  })
  await scene('midata-pick', async () => {
    await P('hideCard')
    await wait(700)
    await beat('midata-pick')
    const pick = app.getByTestId('midata-pick')
    if (await pick.count()) {
      await click(pick, { after: 900 })
      await app.getByTestId('midata-event-4101').waitFor({ timeout: 5000 })
      await highlight(app.getByTestId('midata-event-4101'), 1200)
      await click(app.getByTestId('midata-event-4101'), { after: 700 })
    }
    await click(app.getByTestId('midata-refresh'), { after: 800 })
    await app.waitForSelector('[data-testid="midata-summary"]', { timeout: 8000 })
    await highlight(app.getByTestId('midata-summary'), 2500)
  })
  await scene('matrix', async () => {
    await beat('matrix')
    await highlight(app.getByTestId('qual-matrix'), 7000)
  })
  await scene('nds', async () => {
    await beat('nds')
    const pick = app.getByTestId('nds-pick')
    if (await pick.count()) {
      await click(pick, { after: 900 })
      await click(app.getByTestId('nds-camp-camp-9001'), { after: 700 })
    }
    await click(app.getByTestId('nds-refresh'), { after: 900 })
    await app.waitForSelector('[data-testid="nds-summary"]', { timeout: 8000 })
    await highlight(app.getByTestId('nds-summary'), 3500)
    await highlight(app.getByTestId('nds-awk-open'), 2500)
  })
  await scene('module', async () => {
    await beat('module')
    await highlight(app.getByTestId('module-lst-wasser-effective'), 2000)
    await highlight(app.getByTestId('module-lst-berg-effective'), 2000)
  })

  // ---------------- Kapitel 8: Personen ----------------
  await scene('personen', async () => {
    await captionOff()
    await tab('Personen')
    await app.getByTestId('persons-banner').waitFor({ timeout: 8000 })
    await beat('personen')
    await click(app.getByTestId('persons-load-midata'), { after: 900 })
    await app.getByTestId('persons-row').first().waitFor({ timeout: 8000 })
    await click(app.getByTestId('persons-load-nds'), { after: 900 })
    await app.getByTestId('persons-chip-state-missing_in_nds').waitFor({ timeout: 8000 })
    await highlight(app.getByTestId('persons-row').filter({ hasText: 'fehlt in NDS' }), 2200)
    await highlight(app.getByTestId('persons-row').filter({ hasText: 'unklar' }), 2000)
  })
  await scene('datenschutz', async () => {
    await beat('datenschutz')
    await highlight(app.getByTestId('persons-banner'), 3000)
    await highlight(app.getByTestId('persons-birth'), 2000)
  })

  // ---------------- Kapitel 9: Checkliste + Selbstcheck ----------------
  await scene('checkliste', async () => {
    await captionOff()
    await tab('Checkliste')
    await beat('checkliste')
    await highlight(app.getByText('Grobprogramm an den Coach').first().locator('xpath=ancestor::*[contains(@class,"v-list-item") or contains(@class,"d-flex")][1]'), 2200)
    await highlight(app.locator('[data-testid^="checklist-group-"]'), 3000)
  })
  await scene('selfcheck', async () => {
    await captionOff()
    await tab('Selbstcheck')
    await app.waitForSelector('[data-testid="selfcheck-start"]', { timeout: 8000 })
    await beat('selfcheck')
    await app.waitForFunction(() => !document.querySelector('[data-testid="selfcheck-start"]')?.hasAttribute('disabled'), null, { timeout: 8000 })
    await click(app.getByTestId('selfcheck-start'), { after: 800 })
    await app.locator('[data-testid="selfcheck-note"] textarea').first().pressSequentially('Entwurf vor der Abgabe', { delay: 30 })
    await click(app.getByTestId('selfcheck-confirm'), { after: 1500 })
    await highlight(app.getByTestId('selfcheck-report'), 3000)
  })

  // ---------------- Kapitel 10: Hilfsmittel + Fristen ----------------
  await scene('hilfsmittel', async () => {
    await captionOff()
    await side('Hilfsmittel')
    await beat('hilfsmittel')
    const search = app.locator('.v-text-field', { hasText: 'Volltextsuche' }).locator('input')
    await click(search, { after: 300 })
    await search.pressSequentially('Wasser', { delay: 90 })
    await wait(1200)
    await highlight(app.locator('.v-expansion-panel').first(), 2500)
  })
  await scene('radar', async () => {
    await captionOff()
    await side('Fristen')
    await beat('radar')
    await highlight(app.locator('[data-testid^="radar-head-"]').last().locator('xpath=..'), 2200)
    await click(app.getByTestId('export-ics'), { after: 1200 })
  })

  // ---------------- Outro: slogan only ----------------
  await scene('outro', async () => {
    await P('hideCaption')
    await beat('outro')
  })
  await wait(2500)

  const seconds = await rec.stop()
  await ctx.close()
  await browser.close()
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ voiceDir, beats: timeline }, null, 2))
  console.log(`Video: ${join(OUT, 'co-co-promo.silent.webm')} (${seconds.toFixed(1)} s, ${VW}x${VH})`)
  console.log(`Timeline: ${join(OUT, 'timeline.json')} - next: node tools/promo-video/mix.mjs ${OUT}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => { if (server) server.kill(); process.exit() })
