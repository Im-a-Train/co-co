/** selfCheck flows of the UI harness (imported by run.mjs). */

export async function selfCheckFlows({ page, step, go, shot, BASE }) {
  void BASE
  const text = () => page.evaluate(() => document.body.innerText)

  await step('flow: selfcheck tab shows intro, KPIs and empty history', async () => {
    await go('selbstcheck', 'flow-selfcheck')
    await page.waitForSelector('[data-testid="selfcheck-start"]', { timeout: 8000 })
    const t = await text()
    if (!/Selbstcheck/.test(t)) throw new Error('title missing')
    if (!/Entwurfsrunde starten/i.test(t)) throw new Error('start button missing')
    await page.waitForSelector('[data-testid="selfcheck-report"]', { timeout: 8000 })
    await shot(page, 'flow-selfcheck-start')
  })

  await step('flow: selfcheck draft round creates history entry and report', async () => {
    await go('selbstcheck', 'flow-selfcheck-run')
    await page.waitForFunction(() => !document.querySelector('[data-testid="selfcheck-start"]')?.hasAttribute('disabled'), null, { timeout: 8000 })
    await page.locator('[data-testid="selfcheck-start"]').click()
    await page.locator('[data-testid="selfcheck-note"] textarea').first().fill('Entwurf vor der Abgabe')
    await page.locator('[data-testid="selfcheck-confirm"]').click()
    await page.waitForSelector('[data-testid="selfcheck-run"]', { timeout: 8000 })
    await page.waitForTimeout(500)
    const t = await text()
    if (!/Fortschritt seit der letzten Entwurfsrunde/.test(t)) throw new Error('progress heading missing')
    if (!/Behoben/.test(t) || !/Neu/.test(t)) throw new Error('progress columns missing')
    const report = await page.locator('[data-testid="selfcheck-report"]').innerText()
    if (!/Selbstcheck «/.test(report)) throw new Error('report header missing: ' + report.slice(0, 80))
    await shot(page, 'flow-selfcheck-done')
  })

  await step('flow: selfcheck rounds tab untouched, report toggle for MiData/NDS', async () => {
    await go('selbstcheck', 'flow-selfcheck-toggle')
    await page.waitForSelector('[data-testid="selfcheck-include-red"]', { timeout: 8000 })
    await page.locator('[data-testid="selfcheck-include-red"] input').first().check({ force: true })
    await page.waitForTimeout(300)
    await shot(page, 'flow-selfcheck-report-red')
    await go('runden', 'flow-selfcheck-rounds')
    const t = await text()
    if (/Entwurf vor der Abgabe/.test(t)) throw new Error('draft round leaked into rounds tab')
  })

  await step('flow: selfcheck run can be deleted', async () => {
    await go('selbstcheck', 'flow-selfcheck-delete')
    await page.waitForSelector('[data-testid="selfcheck-delete"]', { timeout: 8000 })
    await page.locator('[data-testid="selfcheck-delete"]').first().click()
    await page.waitForSelector('[data-testid="selfcheck-history-empty"]', { timeout: 8000 })
    await shot(page, 'flow-selfcheck-deleted')
  })
}
