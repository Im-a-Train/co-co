/**
 * Regelbuch: edit a rule (dialog, inline policy errors, «geändert» chip, diff/history, reset) and `?rule=` deep link.
 */
export async function rulesFlows({ page, step, shot, BASE }) {
  const RULE = 'JS-CAMP-01'
  const dialog = () => page.locator('[data-testid="rule-edit-dialog"]')
  const openCatalog = async (query = '') => {
    await page.goto(`${BASE}#/regeln${query}`)
    await page.waitForSelector('.v-application', { timeout: 15000 })
    await page.waitForTimeout(1500)
  }
  const waitDialogSettled = async () => {
    await page.waitForSelector('[data-testid="rule-edit-title"]', { timeout: 5000 })
    await page.waitForTimeout(600)
  }

  await step('flow: rules ?rule= deep link expands the rule', async () => {
    await openCatalog(`?rule=${RULE}`)
    await page.waitForSelector(`#rule-${RULE}.v-expansion-panel--active`, { timeout: 5000 })
    await shot(page, 'flow-rules-deeplink')
  })

  await step('flow: edit a rule shows inline policy errors and saves', async () => {
    await openCatalog(`?rule=${RULE}`)
    await page.waitForSelector(`#rule-${RULE}.v-expansion-panel--active`, { timeout: 5000 })
    await page.locator(`#rule-${RULE} [data-testid="rule-edit-open"]`).click({ timeout: 5000 })
    await waitDialogSettled()
    await page.locator('[data-testid="rule-edit-title"] input').fill('Lager mit mindestens 4 aufeinanderfolgenden Tagen (Handbuch 2027)')
    await page.locator('[data-testid="rule-edit-reason"] input').fill('Handbuch 2027 S. 21 geändert')
    // invalid date -> inline error, save disabled
    const dates = dialog().locator('input[type="text"]')
    const validTo = dialog().getByLabel('Gültig bis')
    await validTo.fill('morgen')
    await page.waitForSelector('[data-testid="rule-edit-errors"]', { timeout: 3000 })
    if (!(await page.locator('[data-testid="rule-edit-save"]').isDisabled())) throw new Error('save not disabled with errors')
    void dates
    await shot(page, 'flow-rules-edit-errors')
    await validTo.fill('')
    await page.waitForFunction(() => !document.querySelector('[data-testid="rule-edit-errors"]'), null, { timeout: 3000 })
    await shot(page, 'flow-rules-edit-dialog')
    await page.locator('[data-testid="rule-edit-save"]').click()
    await page.waitForSelector(`#rule-${RULE} [data-testid="rule-edited"]`, { timeout: 5000 })
    await page.waitForTimeout(600)
    const t = await page.locator(`#rule-${RULE}`).innerText()
    if (!/Handbuch 2027/.test(t)) throw new Error('catalog does not show the effective title')
    await shot(page, 'flow-rules-catalog-edited')
  })

  await step('flow: view changes (diff + history) and reset', async () => {
    await page.locator(`#rule-${RULE} [data-testid="rule-edit-changes"]`).click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="rule-diff"]', { timeout: 5000 })
    await page.waitForTimeout(600)
    const txt = await page.locator('[data-testid="rule-diff"]').innerText()
    if (!/Handbuch 2027/.test(txt)) throw new Error('diff does not show the new title')
    await shot(page, 'flow-rules-diff')
    await page.locator('[data-testid="rule-edit-reset"]').click()
    await page.locator('[data-testid="rule-edit-reset-confirm"]').click({ timeout: 5000 })
    await page.waitForFunction((id) => !document.querySelector(`#rule-${id} [data-testid="rule-edited"]`), RULE, { timeout: 5000 })
    await page.waitForTimeout(600)
    await shot(page, 'flow-rules-reset')
  })
}
