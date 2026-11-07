/**
 * Browser UI QA without Tauri. Starts (or reuses) the vite dev server, loads the app with ?mock=1
 * (dev-only Tauri IPC mock, see src/dev/mockTauri.ts) in the installed Microsoft Edge, visits every route,
 * collects console errors, takes screenshots and exercises the main flows.
 *
 * Usage: npm run test:ui   (env UI_SHOTS_DIR overrides the screenshot directory)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { midataFlows } from './midata-flows.mjs'
import { triageFlows } from './triage-flows.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.UI_PORT || 1420)
const BASE = `http://localhost:${PORT}/?mock=1`
const SHOTS = process.env.UI_SHOTS_DIR || join(root, 'e2e-ui', 'shots')
const CAMP = '70ca971c992f'
mkdirSync(SHOTS, { recursive: true })

async function isUp() {
  try {
    const r = await fetch(`http://localhost:${PORT}/`)
    return r.ok
  } catch {
    return false
  }
}

let server = null
async function ensureServer() {
  if (await isUp()) return
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  server = spawn(cmd, ['run', 'dev:vite', ...(PORT === 1420 ? [] : ['--', '--port', String(PORT)])], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' })
  for (let i = 0; i < 120; i++) {
    if (await isUp()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('vite dev server did not start')
}

let pageRef = null
const problems = []
const results = []
const shots = []
let currentLabel = 'init'

function record(ok, name, detail = '') {
  results.push({ ok, name, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`)
}

const RAW_KEY = /\b(?:app|nav|cockpit|camps|camp|campTabs|feedback|documents|rounds|rules|deadlines|settings|connection|backup|ai|common|findings|mapping|inputs|midata)\.[a-zA-Z]+(?:\.[a-zA-Z0-9]+)+\b/

async function shot(page, name) {
  const file = join(SHOTS, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  shots.push(file)
  // Heuristics: raw i18n keys, horizontal overflow, blank page.
  const text = await page.evaluate(() => document.body.innerText)
  const m = text.match(RAW_KEY)
  if (m) problems.push(`${name}: possible raw i18n key "${m[0]}"`)
  if (/\[intlify\]|Not found '/.test(text)) problems.push(`${name}: intlify message in page`)
  if (text.trim().length < 40) problems.push(`${name}: page nearly blank`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 2) problems.push(`${name}: horizontal overflow ${overflow}px`)
}

async function step(name, fn) {
  try {
    await fn()
    record(true, name)
  } catch (e) {
    record(false, name, String(e.message || e).split('\n')[0])
    await pageRef?.screenshot({ path: join(SHOTS, 'FAIL-' + name.replace(/\W+/g, '_') + '.png'), fullPage: true }).catch(() => {})
    problems.push(`flow "${name}": ${String(e.message || e).split('\n')[0]}`)
  }
}

async function main() {
  await ensureServer()
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, locale: 'de-CH' })
  const page = await ctx.newPage()
  pageRef = page
  page.on('console', (msg) => {
    // Vuetify's v-slide-group (camp tabs) warns when the page height changes while its scroll animation runs.
    if (/Scroll target is not reachable/.test(msg.text())) return
    if (msg.type() === 'error' || (msg.type() === 'warning' && /Vue warn|intlify/.test(msg.text())))
      problems.push(`[${currentLabel}] console ${msg.type()}: ${msg.text().slice(0, 300)}`)
  })
  page.on('pageerror', (e) => problems.push(`[${currentLabel}] uncaught: ${String(e.message).slice(0, 300)}`))

  async function open(hash, name) {
    currentLabel = name
    await page.goto(`${BASE}#${hash}`)
    await page.waitForSelector('.v-application', { timeout: 15000 })
    await page.waitForTimeout(1800)
    await shot(page, name)
  }

  const routes = [
    ['/verbindung', 'verbindung'],
    ['/lager', 'lager'],
    ...['uebersicht', 'raster', 'befunde', 'angaben', 'zuordnung', 'feedback', 'dokumente', 'runden'].map((t) => [
      `/lager/${CAMP}/${t}`,
      `lager-${t}`,
    ]),
    ['/fristen', 'fristen'],
    ['/regeln', 'regeln'],
    ['/einstellungen', 'einstellungen'],
  ]
  for (const [hash, name] of routes) {
    await step(`route ${hash}`, () => open(hash, name))
  }

  // ---- Flows -------------------------------------------------------------------------------
  const go = async (tab, name) => {
    currentLabel = name
    await page.goto(`${BASE}#/lager/${CAMP}/${tab}`)
    await page.waitForSelector('.v-application')
    await page.waitForTimeout(1500)
  }

  await step('flow: camp list opens camp', async () => {
    await page.goto(`${BASE}#/lager`)
    await page.waitForTimeout(1500)
    await page.locator('tbody tr').first().click()
    await page.waitForURL(/\/lager\/[^/]+\/uebersicht/, { timeout: 5000 })
  })

  await step('flow: confirm category mapping', async () => {
    await go('zuordnung', 'flow-mapping')
    const btn = page.getByRole('button', { name: /bestätigen/i }).first()
    await btn.click()
    await page.waitForTimeout(800)
    await shot(page, 'flow-mapping-confirmed')
    const txt = await page.evaluate(() => document.body.innerText)
    if (!/Änderung bestätigen|bestätigt/i.test(txt)) throw new Error('no confirmed state visible')
  })

  await step('flow: open activity drawer in grid', async () => {
    await go('raster', 'flow-grid')
    const cell = page.locator('.wg-block').first()
    await cell.click({ timeout: 5000 })
    await page.waitForTimeout(800)
    await shot(page, 'flow-grid-drawer')
    if (!(await page.locator('.v-navigation-drawer--right').count()))
      throw new Error('drawer not open')
  })

  await triageFlows({ page, step, go, shot, BASE })
  await midataFlows({ page, step, go, shot, BASE })

  await step('flow: list mode "Feedback erstellen" still works', async () => {
    await go('befunde', 'flow-findings')
    await page.getByTestId('mode-list').click()
    await page.waitForTimeout(500)
    await shot(page, 'flow-findings-list')
    await page.getByRole('button', { name: /feedback erstellen/i }).first().click({ timeout: 5000 })
    await page.waitForURL(/feedback/, { timeout: 5000 })
    await page.waitForTimeout(800)
    const txt = await page.evaluate(() => document.body.innerText)
    if (/Noch kein Feedback|keine Einträge/i.test(txt)) throw new Error('feedback list still empty')
  })

  await step('flow: feedback preview tabs', async () => {
    await go('feedback', 'flow-preview')
    const tabs = page.locator('.v-tab')
    const n = await tabs.count()
    for (let i = 0; i < n; i++) {
      const t = tabs.nth(i)
      if (await t.isVisible()) {
        await t.click().catch(() => {})
        await page.waitForTimeout(250)
      }
    }
    await shot(page, 'flow-feedback-previews')
  })

  await step('flow: documents add', async () => {
    await go('dokumente', 'flow-documents')
    await page.getByRole('button', { name: /hinzufügen|Dateien|auswählen/i }).first().click({ timeout: 5000 })
    await page.waitForTimeout(1500)
    await shot(page, 'flow-documents-added')
    const txt = await page.evaluate(() => document.body.innerText)
    if (!/route-bergtour|sicherheitskonzept/i.test(txt)) throw new Error('documents not listed')
  })

  await step('flow: start review round', async () => {
    await go('runden', 'flow-rounds')
    await page.getByRole('button', { name: /Runde starten|starten/i }).first().click({ timeout: 5000 })
    await page.waitForTimeout(600)
    // confirm dialog if any
    const dlg = page.locator('.v-dialog .v-btn').filter({ hasText: /starten|bestätigen|ok|speichern/i }).last()
    if (await dlg.count()) await dlg.click()
    await page.waitForTimeout(1000)
    await shot(page, 'flow-rounds-started')
    const txt = await page.evaluate(() => document.body.innerText)
    if (!/Runde 1/i.test(txt)) throw new Error('round 1 not visible')
  })

  await step('flow: export backup', async () => {
    currentLabel = 'flow-backup'
    await page.getByRole('link', { name: 'Einstellungen' }).first().click()
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: /Alles exportieren/i }).first().click({ timeout: 5000 })
    await page.waitForTimeout(1200)
    await shot(page, 'flow-backup-exported')
    const txt = await page.evaluate(() => document.body.innerText)
    if (!/Backup gespeichert/i.test(txt)) throw new Error('no export confirmation')
  })

  await browser.close()
  if (server) server.kill()

  writeFileSync(join(SHOTS, 'report.json'), JSON.stringify({ results, problems, shots }, null, 2))
  console.log(`\nScreenshots: ${shots.length} in ${SHOTS}`)
  const uniq = [...new Set(problems)]
  if (uniq.length) {
    console.log(`\n${uniq.length} problem(s):`)
    for (const p of uniq) console.log(' - ' + p)
  }
  const failed = results.filter((r) => !r.ok).length
  process.exit(failed || uniq.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  if (server) server.kill()
  process.exit(2)
})
