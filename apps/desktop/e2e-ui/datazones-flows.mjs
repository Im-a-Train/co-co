/** data zones flow of the UI harness (imported by run.mjs): Settings > Datenschutz. */

export async function dataZonesFlows({ page, step, shot, BASE }) {
  await step('flow: settings shows the data zones section', async () => {
    await page.goto(`${BASE}#/einstellungen`)
    await page.waitForSelector('[data-testid="data-zones"]', { state: 'visible', timeout: 8000 })
    const t = await page.getByTestId('data-zones').innerText()
    for (const s of ['Grün', 'Gelb', 'Rot']) if (!t.includes(s)) throw new Error(`zone missing: ${s}`)
    await page.getByTestId('data-zones-flow').waitFor({ timeout: 3000 })
    await page.getByTestId('zone-more-red').locator('button').first().click()
    await page.waitForTimeout(400)
    if (!/Nie\./.test(await page.getByTestId('zone-red').innerText())) throw new Error('red AI answer missing')
    await shot(page, 'flow-data-zones')
  })
}
