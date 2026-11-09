/** Rule modules, camp context, coach checklist and activity tags (imported by run.mjs). */

export async function campConfigFlows({ page, step, go, shot }) {
  await step('flow: Regelmodule card shows modules with effective state and reasons', async () => {
    await go('angaben', 'flow-regelmodule')
    await page.waitForSelector('[data-testid="rule-modules-card"]', { timeout: 8000 })
    await page.waitForSelector('[data-testid="module-lst-berg-effective"]', { timeout: 8000 })
    const card = page.locator('[data-testid="rule-modules-card"]')
    const text = await card.innerText()
    for (const needle of ['Regelmodule', 'Berg', 'Wasser', 'Winter', 'PBS Best Practice', 'Lagerkontext', 'Angebotskontext', '≥ 4 Tage (ab 2027: J+S-Tage)'])
      if (!text.includes(needle)) throw new Error(`card text lacks «${needle}»`)
    await card.scrollIntoViewIfNeeded()
    await shot(page, 'flow-regelmodule-card')
  })

  await step('flow: switching a module to «an» is saved and shown as effective state', async () => {
    await go('angaben', 'flow-regelmodule-toggle')
    await page.waitForSelector('[data-testid="module-lst-wasser-on"]', { timeout: 8000 })
    await page.getByTestId('module-lst-wasser-on').click()
    await page.waitForTimeout(700)
    const eff = await page.getByTestId('module-lst-wasser-effective').innerText()
    if (!/an/.test(eff)) throw new Error('effective state not «an»: ' + eff)
    // winterSafeAccess = nein reveals the camp-level SB approval
    await page.getByTestId('config-winterSafeAccess').click()
    await page.getByRole('option', { name: 'nein' }).click()
    await page.waitForSelector('[data-testid="sb-camp"]', { timeout: 3000 })
    await page.getByTestId('config-abroad').click()
    await page.getByRole('option', { name: 'ja' }).click()
    await page.waitForTimeout(700)
    await shot(page, 'flow-regelmodule-context')
    // back to defaults so later flows are not affected
    await page.getByTestId('module-lst-wasser-auto').click()
    await page.waitForTimeout(400)
  })

  await step('flow: Coach-Checkliste lists items grouped by module and stores done', async () => {
    await go('angaben', 'flow-checklist')
    await page.waitForSelector('[data-testid="coach-checklist-card"] [data-testid="checklist-CL-JS-01"]', { timeout: 8000 })
    const item = page.getByTestId('checklist-CL-JS-01')
    await item.locator('input[type="checkbox"]').check({ force: true })
    await page.waitForTimeout(600)
    const progress = await page.getByTestId('checklist-progress').innerText()
    if (!/1 von \d+ erledigt/.test(progress)) throw new Error('progress not updated: ' + progress)
    await page.getByTestId('checklist-group-js').scrollIntoViewIfNeeded()
    await shot(page, 'flow-checklist-card')
    await item.locator('input[type="checkbox"]').uncheck({ force: true })
    await page.waitForTimeout(400)
  })

  await step('flow: activity drawer has the tag editor and SB approval for sb-* tags', async () => {
    await go('raster', 'flow-tags')
    await page.locator('.wg-block').first().click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="activity-tags"]', { timeout: 5000 })
    await page.getByTestId('activity-tag-select').click()
    await page.getByRole('option', { name: 'Sicherheitsbereich Wasser' }).click()
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="activity-sb-approval"]', { timeout: 3000 })
    await page.waitForTimeout(500)
    await shot(page, 'flow-activity-tags')
    // remove the tag again (closable chip)
    await page.locator('[data-testid="activity-tag-select"] .v-chip__close').first().click()
    await page.waitForTimeout(500)
  })

  await step('flow: Regelkatalog shows sources per rule', async () => {
    await go('uebersicht', 'flow-catalog-start')
    await page.goto(page.url().replace(/#.*/, '#/regeln'))
    await page.waitForSelector('.v-expansion-panel-title', { timeout: 8000 })
    await page.locator('.v-expansion-panel-title').first().click()
    await page.waitForSelector('[data-testid="rule-sources"]', { timeout: 3000 })
    await shot(page, 'flow-catalog-sources')
  })
}
