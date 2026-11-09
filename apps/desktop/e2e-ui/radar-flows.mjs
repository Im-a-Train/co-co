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

  await step('flow: camp filter and "Ältere Lager anzeigen" for archived camps', async () => {
    await page.goto(`${BASE}#/fristen`)
    await page.waitForSelector('[data-testid="deadline-filters"]', { timeout: 8000 })
    await page.waitForTimeout(600)
    const hasCamp = (name) => page.locator('tbody tr', { hasText: name }).count()
    // Archived camp (ended > 1 month ago) is hidden by default.
    if ((await hasCamp('Sommerlager (älter)')) !== 0) throw new Error('archived camp visible by default')
    const sw = page.getByTestId('archived-switch').locator('input')
    if (!(await sw.isChecked())) await sw.check()
    await page.getByText('Erledigte anzeigen').click()
    await page.waitForTimeout(400)
    if ((await hasCamp('Sommerlager (älter)')) === 0) throw new Error('archived camp not shown after the switch')
    await shot(page, 'flow-radar-archived')
    // Camp filter narrows the table to the chosen camp.
    await page.getByTestId('filter-camps').locator('input').click()
    await page.getByRole('option', { name: 'Sommerlager (älter)' }).click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const rowCount = await page.locator('tbody tr').count()
    const own = await hasCamp('Sommerlager (älter)')
    if (rowCount === 0 || rowCount !== own) throw new Error(`camp filter: ${own} of ${rowCount} rows match`)
    await shot(page, 'flow-radar-camp-filter')
    await page.getByTestId('filters-reset').click()
    await sw.uncheck()
    await page.getByText('Erledigte anzeigen').click()
    await page.waitForTimeout(300)
  })

  await step('flow: ICS export runs without error', async () => {
    await page.getByTestId('export-ics').click()
    await page.waitForTimeout(600)
    if (await page.getByTestId('export-error').count()) throw new Error('export error: ' + (await page.getByTestId('export-error').innerText()))
    await page.waitForSelector('[data-testid="export-message"]', { timeout: 4000 })
    await shot(page, 'flow-radar-export')
  })

  await step('flow: NDS Pendenzen load into the radar (memory only)', async () => {
    await page.goto(`${BASE}#/fristen`)
    await page.waitForSelector('[data-testid="radar"]', { timeout: 8000 })
    const load = page.getByTestId('nds-tasks-load')
    await load.waitFor({ timeout: 5000 })
    await load.click()
    await page.getByTestId('nds-tasks-stand').waitFor({ timeout: 5000 })
    await page.waitForTimeout(500)
    if (await page.getByTestId('nds-tasks-error').count()) throw new Error('nds tasks error')
    const t = await text()
    if (!t.includes('Lagerbericht einreichen')) throw new Error('NDS task not in radar')
    await shot(page, 'flow-radar-nds-tasks')
  })
}
