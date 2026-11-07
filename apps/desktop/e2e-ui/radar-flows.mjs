/** radar flows of the UI harness (imported by run.mjs): /fristen radar, PBS milestones, ICS export. */

export async function radarFlows({ page, step, shot, BASE }) {
  const text = () => page.evaluate(() => document.body.innerText)

  await step('flow: radar shows the four buckets and a milestone row', async () => {
    await page.goto(`${BASE}#/fristen`)
    await page.waitForSelector('[data-testid="radar"]', { timeout: 8000 })
    await page.waitForTimeout(600)
    const t = await text()
    for (const label of ['Überfällig', 'Diese Woche', 'Nächste 4 Wochen', 'Später']) {
      if (!t.includes(label)) throw new Error(`radar bucket missing: ${label}`)
    }
    for (const b of ['overdue', 'week', 'month', 'later']) {
      const n = await page.getByTestId(`radar-count-${b}`).innerText()
      if (!/^\d+$/.test(n.trim())) throw new Error(`bad count for ${b}: ${n}`)
    }
    await shot(page, 'flow-radar-overview')
    await page.getByTestId('milestone-row').first().waitFor({ timeout: 5000 })
    if (!/unbestätigt/.test(await page.getByTestId('milestone-row').first().innerText())) throw new Error('unbestätigt badge missing')
    if (!(await page.locator('[data-testid="milestone-row"] a[href^="https://hering.scout.ch"]').count())) throw new Error('source link missing')
    await shot(page, 'flow-radar-milestones')
  })

  await step('flow: radar lane filters the table, milestones can be switched off', async () => {
    const firstFilled = await page.evaluate(() => {
      for (const b of ['overdue', 'week', 'month', 'later']) {
        const n = Number(document.querySelector(`[data-testid="radar-count-${b}"]`)?.textContent?.trim() ?? 0)
        if (n > 0) return b
      }
      return null
    })
    if (firstFilled) {
      await page.getByTestId(`radar-head-${firstFilled}`).click()
      await page.waitForTimeout(300)
      await shot(page, 'flow-radar-filtered')
      await page.getByTestId('radar-clear').click()
    }
    await page.getByTestId('milestones-switch').locator('input').uncheck()
    await page.waitForTimeout(300)
    if ((await page.getByTestId('milestone-row').count()) !== 0) throw new Error('milestone rows still visible')
    await page.getByTestId('milestones-switch').locator('input').check()
    await page.waitForTimeout(300)
    if ((await page.getByTestId('milestone-row').count()) === 0) throw new Error('milestone rows did not return')
  })

  await step('flow: marking a milestone done hides it, "Erledigte anzeigen" shows it', async () => {
    const before = await page.getByTestId('milestone-row').count()
    await page.getByTestId('milestone-toggle').first().click()
    await page.waitForTimeout(500)
    const after = await page.getByTestId('milestone-row').count()
    if (after !== before - 1) throw new Error(`milestone rows ${before} -> ${after}`)
    await page.getByText('Erledigte anzeigen').click()
    await page.waitForTimeout(300)
    if (!/Zurücksetzen/i.test(await text())) throw new Error('undo button missing')
    await shot(page, 'flow-radar-done')
    await page.getByTestId('milestone-toggle').filter({ hasText: 'Zurücksetzen' }).first().click()
    await page.waitForTimeout(400)
  })

  await step('flow: ICS export runs without error', async () => {
    await page.getByTestId('export-ics').click()
    await page.waitForTimeout(600)
    if (await page.getByTestId('export-error').count()) throw new Error('export error: ' + (await page.getByTestId('export-error').innerText()))
    await page.waitForSelector('[data-testid="export-message"]', { timeout: 4000 })
    await shot(page, 'flow-radar-export')
  })
}
