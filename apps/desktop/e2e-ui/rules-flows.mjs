/**
 * Regelbuch: edit a rule (dialog, inline policy errors, «geändert» chip, diff/history, reset) and `?rule=` deep link.
 */
export async function rulesFlows({ page, step, shot, BASE }) {
  const RULE = 'JS-CAMP-01'
  const dialog = () => page.locator('[data-testid="rule-edit-dialog"]')
  const openCatalog = async (query = '') => {
    // A hash-only goto keeps the mounted view (and its filters): start from a blank page.
    await page.goto('about:blank')
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

  await step('flow: rules catalogue defaults to checks, AI guidance is labelled «nur KI»', async () => {
    await openCatalog()
    if (await page.locator('[data-testid="rule-ai-only"]').count()) throw new Error('AI-only rules listed in the default filter')
    await page.locator('[data-testid="kind-filter"]').getByText('Nur in der KI-Prüfung').click()
    await page.waitForTimeout(500)
    const n = await page.locator('[data-testid="rule-ai-only"]').count()
    if (n < 5) throw new Error(`expected AI-only chips, got ${n}`)
    if (!(await page.locator('[data-testid="kind-ai-off"]').count())) throw new Error('aiOff alert missing')
    await shot(page, 'flow-rules-ai-only')
  })

  await step('flow: disabling a Muss rule for all camps asks first', async () => {
    await openCatalog('?rule=JS-DL-01')
    await page.waitForSelector('#rule-JS-DL-01.v-expansion-panel--active', { timeout: 5000 })
    await page.locator('#rule-JS-DL-01 [data-testid="rule-disable-all"]').click()
    await page.waitForSelector('[data-testid="rule-disable-dialog"]', { timeout: 3000 })
    if (!(await page.locator('[data-testid="rule-disable-must"]').count())) throw new Error('Muss warning missing')
    await shot(page, 'flow-rules-disable-confirm')
    await page.getByText('Abbrechen').last().click()
    await page.waitForTimeout(500)
    if (await page.locator('#rule-JS-DL-01 [data-testid="rule-disabled"]').count()) throw new Error('rule disabled without confirmation')
  })

  await step('flow: rules ?q= prefills the search', async () => {
    await openCatalog('?q=Seeschwimmen')
    const v = await page.locator('.search-field input').inputValue()
    if (v !== 'Seeschwimmen') throw new Error(`search not prefilled: ${v}`)
    await shot(page, 'flow-rules-query')
  })

  await step('flow: thresholds per Stufe are number fields with German labels', async () => {
    await openCatalog('?rule=BP-SLEEP-01')
    await page.waitForSelector('#rule-BP-SLEEP-01.v-expansion-panel--active', { timeout: 5000 })
    await page.locator('#rule-BP-SLEEP-01 [data-testid="rule-edit-open"]').click({ timeout: 5000 })
    await waitDialogSettled()
    await page.locator('[data-testid="rule-tab-params"]').click()
    await page.waitForSelector('[data-testid="param-pbs.sleepHours-woelfe"]', { timeout: 5000 })
    await page.waitForTimeout(500)
    const n = await page.locator('[data-testid^="param-pbs.sleepHours-"]').count()
    if (n !== 6) throw new Error(`expected 6 Stufe fields, got ${n}`)
    const txt = await page.locator('[data-testid="param-pbs.sleepHours"]').innerText()
    if (!/Wölfe/.test(txt) || /pbs\.sleepHours|\{"/.test(txt)) throw new Error(`params panel: ${txt}`)
    await shot(page, 'flow-rules-params-map')
  })
}
