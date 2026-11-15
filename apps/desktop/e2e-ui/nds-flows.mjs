/** NDS flows of the UI harness (imported by run.mjs). Mock IPC returns an invented aggregate. */

export async function ndsFlows({ page, step, go, shot, BASE }) {
  const text = () => page.evaluate(() => document.body.innerText)

  await step('flow: settings shows the NDS section and enables it', async () => {
    await page.goto(`${BASE}#/einstellungen`)
    await page.waitForSelector('[data-testid="nds-settings"]', { timeout: 8000 })
    await page.waitForTimeout(600)
    const sw = page.getByTestId('nds-enable').locator('input')
    if (!(await sw.isChecked())) await sw.check()
    await page.waitForTimeout(400)
    await shot(page, 'flow-nds-settings')
    const t = await text()
    if (!/Rote Zone/i.test(t)) throw new Error('red zone text missing')
    if (!/keine öffentliche Schnittstelle/i.test(t)) throw new Error('unofficial hint missing')
    const status = await page.getByTestId('nds-status').innerText()
    if (!/verbunden/i.test(status)) throw new Error('status chip: ' + status)
    if (!/SESSION/.test(await text())) throw new Error('cookie names missing')
  })

  await step('flow: NDS diagnosis shows endpoints', async () => {
    await page.getByTestId('settings-diagnostics-toggle').click()
    await page.waitForSelector('[data-testid="nds-diag"]', { timeout: 5000 })
    await page.locator('[data-testid="nds-diag"] input').first().fill('camp-9001')
    await page.getByTestId('nds-probe').click()
    await page.waitForSelector('[data-testid="nds-probe-result"]', { timeout: 5000 })
    await shot(page, 'flow-nds-probe')
  })

  await step('flow: Lager-Angaben pick NDS camp, load, adopt, badge', async () => {
    await go('angaben', 'flow-nds-card')
    await page.waitForSelector('[data-testid="nds-card"]', { timeout: 8000 })
    await page.waitForTimeout(500)
    await page.getByTestId('nds-pick').click({ timeout: 5000 })
    await page.getByTestId('nds-camp-camp-9001').click({ timeout: 5000 })
    await page.waitForTimeout(500)
    const linkText = await page.getByTestId('nds-link').innerText()
    if (!/Musterstufe · Angebot 999001 \(/.test(linkText) || /camp-9001/.test(linkText)) throw new Error('link line should name the camp, not the id: ' + linkText)
    await shot(page, 'flow-nds-linked')
    await page.getByTestId('nds-refresh').click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="nds-summary"]', { timeout: 8000 })
    const stand = await page.getByTestId('nds-stand').innerText()
    if (!/Stand NDS: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/.test(stand)) throw new Error('bad Stand: ' + stand)
    const t = await text()
    if (!/bewilligt am 03\.05\.2026 \(angemeldet spätestens an diesem Tag\)/.test(t)) throw new Error('approval chip missing')
    if (/CHILD:|ADOLESCENT:/.test(t)) throw new Error('raw role codes in the NDS card')
    if (!/offener Anwesenheitskontrolle/.test(t)) throw new Error('AWK summary missing')
    await shot(page, 'flow-nds-loaded')

    await page.getByTestId('nds-adopt-open').click()
    await page.waitForSelector('[data-testid="nds-adopt"]', { timeout: 5000 })
    await page.waitForTimeout(400)
    await shot(page, 'flow-nds-adopt-dialog')
    const check = page.getByTestId('nds-adopt-check-ndsRegistered').locator('input')
    if (!(await check.isChecked())) await check.check()
    await page.getByTestId('nds-adopt-apply').click()
    // The NDS deadline fields no longer live in Angaben (they are edited in Checkliste), so there is no
    // badge here any more: wait for the dialog to close and the autosave-free adopt save to finish.
    await page.waitForSelector('[data-testid="nds-adopt"]', { state: 'detached', timeout: 5000 })
    await page.waitForTimeout(800)
    await shot(page, 'flow-nds-adopted')
  })
}
