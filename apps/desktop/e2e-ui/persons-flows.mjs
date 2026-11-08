/** persons flows of the UI harness (imported by run.mjs): «Personen» tab, MiData + NDS load, reconcile, reveal, clear. */

export async function personsFlows({ page, step, go, shot }) {
  const text = () => page.evaluate(() => document.body.innerText)

  await step('flow: persons tab loads MiData and NDS and reconciles', async () => {
    await go('personen', 'flow-persons-empty')
    await page.getByTestId('persons-banner').waitFor({ timeout: 8000 })
    if (!/Rote Zone/.test(await text())) throw new Error('red zone banner missing')
    await page.getByTestId('persons-load-midata').click()
    await page.getByTestId('persons-row').first().waitFor({ timeout: 8000 })
    const afterMidata = await page.getByTestId('persons-row').count()
    if (afterMidata < 1) throw new Error('no rows after MiData load')
    await page.getByTestId('persons-load-nds').click()
    await page.getByTestId('persons-chip-state-missing_in_nds').waitFor({ timeout: 8000 })
    await page.getByTestId('persons-chip-state-only_in_nds').waitFor({ timeout: 8000 })
    const t = await text()
    if (!t.includes('fehlt in NDS')) throw new Error('chip «fehlt in NDS» missing')
    if (!t.includes('nur in NDS')) throw new Error('chip «nur in NDS» missing')
    if ((await page.getByTestId('persons-row').count()) <= afterMidata - 1) throw new Error('rows did not include NDS-only people')
    await shot(page, 'flow-persons-loaded')
  })

  await step('flow: birth dates are masked until revealed', async () => {
    const first = page.getByTestId('persons-birth').first()
    const masked = (await first.innerText()).trim()
    if (masked !== '–' && !/^••\.••\.\d{4}$/.test(masked)) throw new Error(`birth date not masked: ${masked}`)
    await page.getByTestId('persons-birth-toggle').click()
    await page.waitForTimeout(200)
    const texts = await page.getByTestId('persons-birth').allInnerTexts()
    if (!texts.some((s) => /^\d{2}\.\d{2}\.\d{4}$/.test(s.trim()))) throw new Error('reveal did not show full dates')
    await shot(page, 'flow-persons-revealed')
    await page.getByTestId('persons-birth-toggle').click()
    await page.waitForTimeout(200)
    if (/^\d{2}\.\d{2}\.\d{4}$/.test((await page.getByTestId('persons-birth').first().innerText()).trim()))
      throw new Error('dates still visible after hiding')
  })

  await step('flow: persons filter by NDS state, then clear from memory', async () => {
    const all = await page.getByTestId('persons-row').count()
    await page.getByTestId('persons-search').locator('input').fill('zzzz-no-such-person')
    await page.waitForTimeout(300)
    if ((await page.getByTestId('persons-row').count()) !== 0) throw new Error('search did not filter')
    await page.getByTestId('persons-search').locator('input').fill('')
    await page.waitForTimeout(300)
    if ((await page.getByTestId('persons-row').count()) !== all) throw new Error('rows did not return after clearing the search')
    await page.getByTestId('persons-clear').click()
    await page.getByTestId('persons-empty').waitFor({ timeout: 5000 })
    if ((await page.getByTestId('persons-row').count()) !== 0) throw new Error('rows remain after clear')
    await shot(page, 'flow-persons-cleared')
  })
}
