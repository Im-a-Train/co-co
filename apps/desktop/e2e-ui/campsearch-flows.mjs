/**
 * Central camp search flows of the UI harness (imported by run.mjs): type in the header search on a non-document tab,
 * see grouped hits with highlight, jump to an activity (drawer opens) via keyboard.
 */
export async function campSearchFlows({ page, step, shot, BASE, CAMP }) {
  await step('flow: camp search finds an activity from the Uebersicht tab and jumps to it', async () => {
    await page.goto('about:blank')
    await page.goto(`${BASE}#/lager/${CAMP}/uebersicht`)
    await page.waitForSelector('[data-testid="camp-search-input"]', { timeout: 15000 })
    await page.waitForTimeout(1800)
    await page.keyboard.press('Control+k')
    const input = page.getByTestId('camp-search-input').locator('input')
    if (!(await input.evaluate((el) => el === document.activeElement))) throw new Error('Ctrl+K did not focus the search')
    await input.fill('snowboard')
    await page.waitForSelector('[data-testid="camp-search-hit"]', { timeout: 5000 })
    const mark = await page.locator('[data-testid="camp-search-results"] mark').first().innerText()
    if (!/snowboard/i.test(mark)) throw new Error(`highlight missing: ${mark}`)
    if (!/Aktivitäten/.test(await page.getByTestId('camp-search-results').innerText())) throw new Error('group heading missing')
    await shot(page, 'campsearch-results')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => location.hash.includes('/aktivitaeten'), null, { timeout: 5000 })
    await page.waitForTimeout(1500)
    const txt = await page.evaluate(() => document.body.innerText)
    if (!/Snowboardfahren/.test(txt)) throw new Error('activity not shown')
    if (/activity=/.test(await page.evaluate(() => location.hash))) throw new Error('activity param not cleared')
    await shot(page, 'campsearch-jumped')
  })
  await step('flow: camp search shows empty state', async () => {
    const input = page.getByTestId('camp-search-input').locator('input')
    await input.fill('qqqqxyz')
    await page.waitForSelector('[data-testid="camp-search-empty"]', { timeout: 5000 })
    await page.keyboard.press('Escape')
  })
}
