/**
 * Category exclusion flows (Befunde: activity categories excluded from rule checks).
 */
export async function exclusionFlows({ page, step, go, shot, BASE }) {
  void BASE
  const text = () => page.evaluate(() => document.body.innerText)
  const openDialog = async () => {
    await page.locator('[data-testid="category-exclusion-open"]').click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="category-exclusion-dialog"]', { timeout: 5000 })
    await page.waitForSelector('[data-testid="category-row"]', { timeout: 5000 })
    await page.waitForTimeout(600) // let the open transition finish (otherwise clicks hit the scrim and close the dialog)
  }
  const closeDialog = async () => {
    await page.getByRole('button', { name: /^schliessen$/i }).last().click()
    await page.waitForTimeout(400)
  }
  const toggleAll = async () => {
    const boxes = page.locator('[data-testid="category-row"] label')
    const n = await boxes.count()
    for (let i = 0; i < n; i++) await boxes.nth(i).click({ timeout: 5000 })
    await page.waitForTimeout(500)
    return n
  }

  await step('flow: exclude all activity categories shows info line and hides findings', async () => {
    await go('befunde', 'flow-exclusion')
    await page.waitForSelector('[data-testid="category-exclusion-open"]', { timeout: 8000 })
    await page.waitForTimeout(500)
    if (await page.locator('[data-testid="exclusion-info"]').count()) throw new Error('info line shown before excluding')
    await openDialog()
    const n = await toggleAll()
    if (!n) throw new Error('no category rows in dialog')
    await shot(page, 'flow-exclusion-dialog')
    await closeDialog()
    await page.waitForSelector('[data-testid="exclusion-info"]', { timeout: 5000 })
    const t = await text()
    if (!/wegen ausgeschlossener Aktivitätstypen ausgeblendet/.test(t)) throw new Error('info text missing')
    await shot(page, 'flow-exclusion-active')
  })

  await step('flow: info link reopens dialog, exclusions can be restored', async () => {
    await page.locator('[data-testid="exclusion-manage"]').click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="category-exclusion-dialog"]', { timeout: 5000 })
    await page.waitForSelector('[data-testid="category-row"]', { timeout: 5000 })
    await page.waitForTimeout(600)
    await toggleAll()
    await closeDialog()
    await page.waitForFunction(() => !document.querySelector('[data-testid="exclusion-info"]'), null, { timeout: 5000 })
    await shot(page, 'flow-exclusion-restored')
  })
}
