/** Coach (manual) findings flows of the UI harness (imported by run.mjs). */
export async function coachFindingsFlows({ page, step, go, shot }) {
  const settle = (ms = 800) => page.waitForTimeout(ms)

  await step('flow: Dokumente tab sits between Aktivitäten and Befunde', async () => {
    await go('aktivitaeten', 'flow-tab-order')
    const labels = await page.locator('.v-tab').allInnerTexts()
    const idx = (re) => labels.findIndex((l) => re.test(l))
    const a = idx(/^(DP|Aktivit)/i)
    const d = idx(/Dokumente/i)
    const b = idx(/Befunde/i)
    if (a < 0 || d < 0 || b < 0 || !(a < d && d < b)) throw new Error('tab order wrong: ' + labels.join(' | '))
  })

  await step('flow: add a coach finding from the activities list', async () => {
    await go('aktivitaeten', 'flow-coach-add')
    await page.locator('.activities-table tbody tr').first().getByTestId('activity-add-finding').click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="manual-finding-dialog"]', { timeout: 5000 })
    await page.getByTestId('manual-finding-category-safety').click()
    await page.getByTestId('manual-finding-comment').locator('textarea').first().fill('Abseilen: Sicherung nochmals klaeren')
    await shot(page, 'flow-coach-dialog')
    await page.getByTestId('manual-finding-save').click()
    await settle(1000)
    await page.locator('.activities-table tbody tr').first().click({ timeout: 5000 })
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
    await shot(page, 'flow-coach-findings-list')
  })
}
