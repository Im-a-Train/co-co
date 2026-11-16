/** Coach (manual) findings flows of the UI harness (imported by run.mjs). */
export async function coachFindingsFlows({ page, step, go, shot }) {
  const settle = (ms = 800) => page.waitForTimeout(ms)

  await step('flow: camp tab order follows the work, Feedback and Runden end inside the strip', async () => {
    await go('aktivitaeten', 'flow-tab-order')
    const labels = (await page.locator('.camp-tabs .v-tab').allInnerTexts()).map((l) => l.trim())
    const want = ['Angaben', 'Übersicht', 'GP', 'DP', 'Befunde', 'Dokumente', 'Feedback', 'Runden', 'Checkliste', 'Personen', 'Selbstcheck']
    if (labels.join('|') !== want.join('|')) throw new Error('tab order wrong: ' + labels.join(' | '))
    for (const size of [{ width: 1360, height: 860 }, { width: 1024, height: 700 }]) {
      await page.setViewportSize(size)
      await page.waitForTimeout(400)
      const m = await page.evaluate(() => {
        const strip = document.querySelector('.camp-tabs .v-slide-group__container').getBoundingClientRect()
        const r = (t) => [...document.querySelectorAll('.camp-tabs .v-tab')].find((e) => e.innerText.trim() === t).getBoundingClientRect()
        return { stripRight: Math.round(strip.right), feedback: Math.round(r('Feedback').right), runden: Math.round(r('Runden').right) }
      })
      console.log('tab strip', size.width, JSON.stringify(m))
      if (m.runden > m.stripRight) throw new Error(`Runden outside strip at ${size.width}: ${JSON.stringify(m)}`)
    }
    await page.setViewportSize({ width: 1360, height: 860 })
  })

  await step('flow: add a coach finding from the activities list', async () => {
    await go('aktivitaeten', 'flow-coach-add')
    await page.locator('.activities-table tbody tr').first().click({ timeout: 5000 })
    await page.getByTestId('drawer-add-finding').click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="manual-finding-dialog"]', { timeout: 5000 })
    await page.getByTestId('manual-finding-category-safety').click()
    await page.getByTestId('manual-finding-comment').locator('textarea').first().fill('Abseilen: Sicherung nochmals klaeren')
    await shot(page, 'flow-coach-dialog')
    await page.getByTestId('manual-finding-save').click()
    await settle(1000)
    // the drawer is non-modal and still open on the same row: the list shows the new Coach-Befund
    await settle(800)
    const txt = await page.getByTestId('drawer-manual-list').innerText()
    if (!/Sicherung nochmals/.test(txt)) throw new Error('finding not in drawer: ' + txt)
    if (!(await page.getByTestId('manual-finding-item').count())) throw new Error('no manual-finding-item')
    await shot(page, 'flow-coach-drawer')
  })

  await step('flow: coach finding appears in Befunde with Coach chip', async () => {
    await go('befunde', 'flow-coach-findings')
    await page.getByTestId('mode-list').click()
    await settle(600)
    const tag = page.getByTestId('finding-manual-tag').first()
    await tag.waitFor({ timeout: 5000 })
    if (!/Coach/i.test(await tag.innerText())) throw new Error('chip text: ' + (await tag.innerText()))
    const firstHeading = await page.locator('section h2').first().innerText()
    if (!/Coach/i.test(firstHeading)) throw new Error('coach group is not first: ' + firstHeading)
    await shot(page, 'flow-coach-findings-list')
  })
}
