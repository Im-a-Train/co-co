/** Overview flows of the UI harness (imported by run.mjs): progress card and data sources. */
export async function overviewFlows({ page, step, go, shot }) {
  await step('flow: Übersicht shows progress steps and data sources, no top findings', async () => {
    await go('uebersicht', 'flow-overview-new')
    await page.waitForSelector('[data-testid="overview-progress"]', { timeout: 5000 })
    await page.waitForSelector('[data-testid="overview-datasources"]', { timeout: 5000 })
    const steps = await page.locator('[data-testid^="overview-progress-"]:not([data-testid="overview-progress-percent"])').count()
    if (steps < 5) throw new Error(`expected progress steps, got ${steps}`)
    if (!(await page.getByTestId('overview-progress-percent').count())) throw new Error('percent missing')
    const txt = await page.evaluate(() => document.body.innerText)
    if (/Wichtigste Befunde/i.test(txt)) throw new Error('"Wichtigste Befunde" still shown')
    await shot(page, 'flow-overview-new')
  })
}
