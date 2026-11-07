/** MiData flows of the UI harness (imported by run.mjs). Mock IPC returns an invented aggregate. */

export async function midataFlows({ page, step, go, shot, BASE }) {
  const text = () => page.evaluate(() => document.body.innerText)

  await step('flow: settings shows the MiData section', async () => {
    await page.goto(`${BASE}#/einstellungen`)
    await page.waitForSelector('[data-testid="midata-settings"]', { timeout: 8000 })
    await page.waitForTimeout(600)
    await shot(page, 'flow-midata-settings')
    const t = await text()
    if (!/Rote Zone/i.test(t)) throw new Error('red zone text missing')
    if (!/verbunden per Anmeldung/i.test(t)) throw new Error('status chip missing')
    if (!/Service-Token/i.test(t)) throw new Error('token section missing')
  })

  await step('flow: diagnosis expander shows probe result', async () => {
    await page.locator('[data-testid="midata-diag"] .v-expansion-panel-title').click()
    await page.locator('[data-testid="midata-diag"] input').first().fill('4101')
    await page.getByTestId('midata-probe').click()
    await page.waitForSelector('[data-testid="midata-probe-result"]', { timeout: 5000 })
    await shot(page, 'flow-midata-probe')
  })

  await step('flow: Lager-Angaben load MiData, adopt, badge, matrix', async () => {
    await go('angaben', 'flow-midata-card')
    await page.waitForSelector('[data-testid="midata-card"]', { timeout: 8000 })
    // Link: from eCamp, or pick once.
    const pick = page.getByTestId('midata-pick')
    if (await pick.count()) {
      await pick.click()
      await page.getByTestId('midata-event-4101').waitFor({ timeout: 5000 })
      await page.waitForTimeout(300)
      await shot(page, 'flow-midata-picker')
      const pt = await page.getByTestId('midata-picker').innerText()
      if (!/Abteilung Musterhausen/.test(pt) || !/Region Beispiel/.test(pt)) throw new Error('organisation names missing in picker')
      if (!/passt zu den Lagerdaten/.test(pt) || !/überschneidet sich/.test(pt)) throw new Error('overlap chips missing in picker')
      await page.getByTestId('midata-event-4101').click({ timeout: 5000 })
      await page.waitForTimeout(500)
    }
    await shot(page, 'flow-midata-linked')
    await page.getByTestId('midata-refresh').click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="midata-summary"]', { timeout: 8000 })
    const stand = await page.getByTestId('midata-stand').innerText()
    if (!/Stand MiData: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/.test(stand)) throw new Error('bad Stand: ' + stand)
    await shot(page, 'flow-midata-loaded')

    await page.getByTestId('midata-adopt-open').click()
    await page.waitForSelector('[data-testid="midata-adopt"]', { timeout: 5000 })
    await page.waitForTimeout(400)
    await shot(page, 'flow-midata-adopt-dialog')
    const check = page.getByTestId('adopt-check-participantsCount').locator('input')
    if (!(await check.isChecked())) await check.check()
    await page.getByTestId('adopt-apply').click()
    await page.waitForSelector('[data-testid="midata-badge"]', { timeout: 5000 })
    await page.waitForTimeout(600)
    await shot(page, 'flow-midata-adopted')
    const val = await page.getByTestId('input-participantsCount').locator('input').inputValue()
    if (val !== '24') throw new Error('participantsCount not adopted: ' + val)

    await page.waitForSelector('[data-testid="qual-matrix"]', { timeout: 5000 })
    const t = await text()
    if (!/Falk/.test(t) || !/Abdeckung/.test(t)) throw new Error('matrix incomplete')
    await shot(page, 'flow-midata-matrix')
  })

  await step('flow: manual edit removes the MiData badge', async () => {
    const input = page.getByTestId('input-participantsCount').locator('input')
    await input.fill('25')
    await page.waitForTimeout(300)
    const badges = await page.locator('.v-field [data-testid="midata-badge"]').count()
    const inField = await page.getByTestId('input-participantsCount').locator('[data-testid="midata-badge"]').count()
    if (inField !== 0) throw new Error(`badge still next to edited field (${badges} badges total)`)
    await page.getByTestId('inputs-save').click()
    await page.waitForTimeout(600)
  })
}
