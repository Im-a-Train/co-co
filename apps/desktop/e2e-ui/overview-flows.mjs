/** Overview flows of the UI harness (imported by run.mjs): verdict, next step, progress card, KPI tiles. */
export async function overviewFlows({ page, step, go, shot }) {
  await step('flow: Übersicht shows verdict, one next-step button and progress steps, no top findings', async () => {
    await go('uebersicht', 'flow-overview-new')
    await page.waitForSelector('[data-testid="overview-progress"]', { timeout: 5000 })
    await page.waitForSelector('[data-testid="overview-verdict"]', { timeout: 5000 })
    const steps = await page.locator('[data-testid^="overview-progress-"]:not([data-testid="overview-progress-percent"])').count()
    if (steps < 5) throw new Error(`expected progress steps, got ${steps}`)
    if (!(await page.getByTestId('overview-progress-percent').count())) throw new Error('percent missing')
    if ((await page.getByTestId('overview-next-step').count()) !== 1) throw new Error('expected exactly one next-step button')
    const txt = await page.evaluate(() => document.body.innerText)
    if (/Wichtigste Befunde/i.test(txt)) throw new Error('"Wichtigste Befunde" still shown')
    if (/Kategorien-Zuordnung\s*\n\s*(Ja|Nein)/i.test(txt)) throw new Error('mapping KPI tile still shown')
    if (/Keine Runde gestartet/i.test(txt)) throw new Error('changes tile shown without a round')
    await shot(page, 'flow-overview-new')
  })
}
