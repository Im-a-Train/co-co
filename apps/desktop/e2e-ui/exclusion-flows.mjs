/**
 * Category exclusion flows (Befunde): the button leads to the GP mapping table; a rule-specific exclusion is added on the
 * finding itself (⋯ menu) and managed (removed) in the dialog.
 */
export async function exclusionFlows({ page, step, go, shot, BASE }) {
  void BASE
  const text = () => page.evaluate(() => document.body.innerText)

  await step('flow: «Kategorien nicht prüfen» opens the GP mapping table', async () => {
    await go('befunde', 'flow-exclusion')
    await page.waitForSelector('[data-testid="category-exclusion-open"]', { timeout: 8000 })
    await page.waitForTimeout(500)
    if (await page.locator('[data-testid="exclusion-info"]').count()) throw new Error('info line shown before excluding')
    if (!/Kategorien nicht prüfen/.test(await page.locator('[data-testid="category-exclusion-open"]').innerText())) throw new Error('button label')
    await page.locator('[data-testid="category-exclusion-open"]').click()
    await page.waitForURL(/raster\?.*zuordnung=1/, { timeout: 5000 })
    await page.getByTestId('mapping-table').waitFor({ timeout: 8000 })
    await page.waitForTimeout(500)
    await shot(page, 'flow-exclusion-grid')
    // «Regeln prüfen» off for a category: its blocks carry the eye-off marker; on again removes it
    const sw = page.getByTestId('mapping-check').first().locator('input')
    await sw.click({ force: true })
    await page.waitForSelector('[data-testid="grid-block-excluded"]', { timeout: 5000 })
    await shot(page, 'flow-exclusion-grid-off')
    await sw.click({ force: true })
    await page.waitForFunction(() => !document.querySelector('[data-testid="grid-block-excluded"]'), null, { timeout: 5000 })
  })

  await step('flow: exclude a category for one rule from the finding, restore in the dialog', async () => {
    await go('befunde', 'flow-exclusion-rule')
    await page.waitForSelector('.triage-item', { timeout: 8000 })
    const n = await page.locator('.triage-item').count()
    let done = false
    for (let i = 0; i < n && !done; i++) {
      await page.locator('.triage-item').nth(i).click()
      await page.waitForTimeout(250)
      const more = page.locator('[data-testid="triage-more"]')
      if (!(await more.count())) continue
      await more.click()
      await page.waitForTimeout(300)
      const item = page.locator('[data-testid="exclude-category-rule"]')
      if (await item.count()) {
        await shot(page, 'flow-exclusion-menu')
        await item.first().click()
        done = true
      } else {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }
    }
    if (!done) throw new Error('no finding offers «Kategorie für diese Regel nicht prüfen»')
    await page.waitForSelector('[data-testid="exclusion-info"]', { timeout: 5000 })
    const t = await text()
    if (!/wegen nicht geprüfter Kategorien ausgeblendet/.test(t)) throw new Error('info text missing')
    await shot(page, 'flow-exclusion-active')
    await page.locator('[data-testid="exclusion-manage"]').click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="category-exclusion-dialog"]', { timeout: 5000 })
    await page.waitForSelector('[data-testid="per-rule-list"]', { timeout: 5000 })
    await page.waitForTimeout(600) // let the open transition finish
    await shot(page, 'flow-exclusion-dialog')
    await page.locator('[data-testid="exclusion-remove"]').first().click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /^schliessen$/i }).last().click()
    await page.waitForFunction(() => !document.querySelector('[data-testid="exclusion-info"]'), null, { timeout: 5000 })
    await shot(page, 'flow-exclusion-restored')
  })
}
