/**
 * storage flows of the UI harness (imported by run.mjs): encrypted local data store (ADR 0009).
 * Locked start, route guard, unlock after login, lock on logout, key-lost dialog + reset.
 * Uses mock URL options ?loggedout=1 (start without session) and ?keylost=1 (wrong data key). Run it last:
 * the key-lost flow leaves the harness database encrypted with the second mock key.
 */

export async function storageFlows({ page, step, shot, BASE }) {
  const text = () => page.evaluate(() => document.body.innerText)
  const settle = (ms = 1200) => page.waitForTimeout(ms)
  const status = () => page.getByTestId('datastore-status').innerText()

  async function overlaysClosed() {
    await page.waitForFunction(() => !document.querySelector('.v-overlay--active'), null, { timeout: 8000 }).catch(() => {})
  }

  async function startLoggedOut(hash, extra = '') {
    await overlaysClosed()
    await page.goto(`${BASE}&loggedout=1${extra}#${hash}`)
    await page.waitForSelector('.v-application')
    await settle()
  }

  async function passwordLogin() {
    await page.getByText('Passwort-Login (Fallback)').click()
    await page.getByLabel('E-Mail').fill('coach@example.ch')
    await page.getByLabel('Passwort', { exact: true }).fill('geheim')
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click()
  }

  await step('flow: storage locked start shows only /verbindung', async () => {
    await startLoggedOut('/lager')
    if (!/#\/verbindung/.test(page.url())) throw new Error(`expected /verbindung, got ${page.url()}`)
    if (!/gesperrt/.test(await status())) throw new Error('status chip not «gesperrt»')
    // nav entries other than «Verbindung» are disabled
    const disabled = await page.locator('.v-navigation-drawer .v-list-item--disabled').count()
    if (disabled < 4) throw new Error(`expected 4 disabled nav items, got ${disabled}`)
    await shot(page, 'storage-locked')
  })

  await step('flow: storage deep link #/fristen redirects to /verbindung', async () => {
    await page.goto(`${BASE}&loggedout=1#/fristen`)
    await settle()
    if (!/#\/verbindung/.test(page.url())) throw new Error(`expected /verbindung, got ${page.url()}`)
    for (const hash of ['/regeln', '/einstellungen']) {
      await page.evaluate((h) => (window.location.hash = h), hash)
      await settle(600)
      if (!/#\/verbindung/.test(page.url())) throw new Error(`${hash} not blocked: ${page.url()}`)
    }
  })

  await step('flow: storage unlocks after login and /fristen opens', async () => {
    await passwordLogin()
    await page.waitForFunction(() => /entsperrt/.test(document.body.innerText), null, { timeout: 8000 })
    await settle(800)
    // After login the redirect query of the earlier blocked navigation (/einstellungen) is honoured.
    await shot(page, 'storage-unlocked')
    await page.evaluate(() => (window.location.hash = '/fristen'))
    await page.waitForFunction(() => /#\/fristen/.test(window.location.hash), null, { timeout: 5000 })
    await settle()
    if (!/#\/fristen/.test(page.url())) throw new Error(`/fristen not reachable: ${page.url()}`)
    const t = await text()
    if (t.trim().length < 40) throw new Error('/fristen is blank')
    await shot(page, 'storage-fristen-unlocked')
  })

  await step('flow: storage backup export shows unencrypted warning', async () => {
    await page.evaluate(() => (window.location.hash = '/einstellungen'))
    await settle()
    await page.getByTestId('backup-unencrypted-warning').waitFor({ timeout: 5000 })
    if (!/NICHT verschlüsselt/.test(await page.getByTestId('backup-unencrypted-warning').innerText())) throw new Error('warning text wrong')
    await shot(page, 'storage-backup-warning')
  })

  await step('flow: storage logout locks and blocks routes', async () => {
    await page.evaluate(() => (window.location.hash = '/verbindung'))
    await settle(600)
    await page.getByRole('button', { name: 'Abmelden' }).click()
    await page.waitForFunction(() => /gesperrt/.test(document.body.innerText), null, { timeout: 8000 })
    await page.evaluate(() => (window.location.hash = '/fristen'))
    await settle(800)
    if (!/#\/verbindung/.test(page.url())) throw new Error(`/fristen reachable after logout: ${page.url()}`)
    await shot(page, 'storage-after-logout')
  })

  await step('flow: storage key lost shows reset dialog, reset creates fresh store', async () => {
    // The harness database was created with the first mock key; this page load hands out another one.
    await startLoggedOut('/verbindung', '&keylost=1')
    await passwordLogin()
    await page.getByTestId('data-reset-dialog').waitFor({ timeout: 8000 })
    const t = await text()
    if (!/nicht entschlüsselt werden/.test(t)) throw new Error('key-lost text missing')
    await settle(500) // let the dialog finish its fade-in
    await shot(page, 'storage-key-lost')
    // never automatic: the dialog stays until the coach decides
    await settle(800)
    await page.getByTestId('reset-only').click()
    const confirm = page.getByTestId('reset-confirm')
    if (!(await confirm.isDisabled())) throw new Error('confirm button enabled without checkbox')
    await page.getByTestId('reset-confirm-check').locator('input').check({ force: true })
    await shot(page, 'storage-reset-confirm')
    await confirm.click()
    await page.waitForFunction(() => /entsperrt/.test(document.body.innerText) && !document.querySelector('[data-testid="data-reset-dialog"]'), null, { timeout: 10000 })
    await settle(600)
    await shot(page, 'storage-after-reset')
    await page.evaluate(() => (window.location.hash = '/fristen'))
    await settle()
    if (!/#\/fristen/.test(page.url())) throw new Error('/fristen not reachable after reset')
  })
}
