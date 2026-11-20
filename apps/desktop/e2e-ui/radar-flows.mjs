/** radar flows of the UI harness (imported by run.mjs): /fristen grouped list, milestones, ticking, ICS export. */

export async function radarFlows({ page, step, shot, BASE }) {
  const text = () => page.evaluate(() => document.body.innerText)

  const ROWS = '[data-testid="deadline-row"], [data-testid="milestone-row"]'
  /** Opens every collapsed group («Später» is collapsed by default). */
  const expandAll = async () => {
    for (const h of await page.locator('[data-testid^="group-head-"][aria-expanded="false"]').all()) await h.click()
    await page.waitForTimeout(200)
  }
  const openMore = async () => {
    await page.getByTestId('deadlines-more').click()
    await page.waitForTimeout(300)
  }
  const closeMore = async () => {
    await page.keyboard.press('Escape')
    await page.mouse.click(5, 5)
    await page.waitForTimeout(300)
  }

  await step('flow: one grouped list with summary, legend and a milestone row', async () => {
    await page.goto(`${BASE}#/fristen`)
    await page.waitForSelector('[data-testid="deadlines-summary"]', { timeout: 8000 })
    await page.waitForTimeout(600)
    const t = await text()
    if (!/Diese Woche fällig: \d+ · Überfällig: \d+/.test(t)) throw new Error('summary line missing')
    for (const b of ['overdue', 'week', 'month', 'later']) {
      if (!(await page.locator(`[data-testid="group-${b}"]`).count())) throw new Error(`group missing: ${b}`)
    }
    // Off-season (nothing due within 4 weeks) «Später» opens by default, so the page never shows zero rows.
    const soon = await page.locator('[data-testid="group-overdue"] [data-testid$="-row"], [data-testid="group-week"] [data-testid$="-row"], [data-testid="group-month"] [data-testid$="-row"]').count()
    const laterOpen = await page.locator('[data-testid="group-head-later"][aria-expanded="true"]').count()
    if (!soon && (await page.getByTestId('group-head-later').count()) && !laterOpen) throw new Error('«Später» stays collapsed although nothing is due earlier')
    if (await page.getByTestId('radar').count()) throw new Error('radar must be gone')
    if (await page.locator('table').count()) throw new Error('table must be gone')
    await shot(page, 'flow-radar-overview')
    await expandAll()
    await page.getByTestId('milestone-row').first().waitFor({ timeout: 5000 })
    if (!(await page.getByTestId('unconfirmed-mark').count())) throw new Error('asterisk for unconfirmed milestones missing')
    if (!(await page.getByTestId('legend-unconfirmed').count())) throw new Error('legend for the asterisk missing')
    if (await page.locator('[data-testid="milestone-row"] a[href^="https://hering.scout.ch"]').count()) throw new Error('source link must not be on the row')
    if (await page.getByTestId('unverified-badge').count()) throw new Error('unbestätigt chip must be gone')
    await shot(page, 'flow-radar-milestones')
  })

  await step('flow: scope toggle shows leader rows with a Leitung chip, Mehr menu holds the rest', async () => {
    await expandAll()
    const mine = await page.locator(ROWS).count()
    await page.getByTestId('scope-all').click()
    await page.waitForTimeout(400)
    await expandAll()
    const all = await page.locator(ROWS).count()
    if (all <= mine) throw new Error(`leader rows missing: ${mine} -> ${all}`)
    if (!(await page.getByTestId('leader-chip').count())) throw new Error('Leitung chip missing')
    await shot(page, 'flow-radar-filtered')
    await page.getByTestId('scope-mine').click()
    await page.waitForTimeout(300)
    if (await page.getByTestId('leader-chip').count()) throw new Error('leader rows still visible in «Meine Fristen»')
    if (await page.getByTestId('milestones-switch').count()) throw new Error('milestones switch must be gone')
    await openMore()
    if (!(await page.getByTestId('filter-kinds').count())) throw new Error('kind filter missing in Mehr menu')
    await shot(page, 'flow-radar-more-menu')
    await closeMore()
  })

  await step('flow: ticking a row shows the snackbar, undo brings it back, "Erledigte anzeigen" lists done rows', async () => {
    await expandAll()
    const before = await page.locator(ROWS).count()
    await page.locator('[data-testid="milestone-row"] [data-testid="deadline-done"] input').first().check()
    await page.getByTestId('done-snackbar').waitFor({ timeout: 4000 })
    await page.waitForTimeout(500)
    const after = await page.locator(ROWS).count()
    if (after !== before - 1) throw new Error(`rows ${before} -> ${after}`)
    if (!/Erledigt: .+ · /.test(await page.getByTestId('done-snackbar').innerText())) throw new Error('snackbar text wrong')
    await shot(page, 'flow-radar-done')
    await page.getByTestId('done-undo').click()
    await page.waitForTimeout(500)
    if ((await page.locator(ROWS).count()) !== before) throw new Error('undo did not bring the row back')
    // Rule deadlines can be ticked as well and link to the rule.
    if (!(await page.locator('[data-testid="deadline-row"] [data-testid="deadline-done"]').count())) throw new Error('rule deadline has no checkbox')
    if (!(await page.locator('[data-testid="deadline-rule-link"][href*="rule=JS-DL"]').count())) throw new Error('rule link missing')
    await page.locator('[data-testid="milestone-row"] [data-testid="deadline-done"] input').first().check()
    await page.waitForTimeout(500)
    await openMore()
    await page.getByTestId('done-switch').locator('input').check()
    await closeMore()
    await page.waitForSelector('[data-testid="group-done"]', { timeout: 4000 })
    await expandAll()
    const doneBox = page.locator('[data-testid="group-done"] [data-testid="deadline-done"] input').first()
    await doneBox.uncheck()
    await page.waitForTimeout(400)
    await openMore()
    await page.getByTestId('done-switch').locator('input').uncheck()
    await closeMore()
  })

  await step('flow: camp filter and "Ältere Lager anzeigen" for archived camps', async () => {
    await page.goto(`${BASE}#/fristen`)
    await page.waitForSelector('[data-testid="deadline-filters"]', { timeout: 8000 })
    await page.waitForTimeout(600)
    await expandAll()
    const hasCamp = (name) => page.locator(ROWS, { hasText: name }).count()
    // Archived camp (ended > 1 month ago) is hidden by default.
    if ((await hasCamp('Sommerlager (älter)')) !== 0) throw new Error('archived camp visible by default')
    await openMore()
    const sw = page.getByTestId('archived-switch').locator('input')
    if (!(await sw.isChecked())) await sw.check()
    await page.getByTestId('done-switch').locator('input').check()
    await closeMore()
    await expandAll()
    if ((await hasCamp('Sommerlager (älter)')) === 0) throw new Error('archived camp not shown after the switch')
    await shot(page, 'flow-radar-archived')
    // The camp autocomplete only appears with more than one non-archived camp.
    const nonArchived = new Set(await page.evaluate(() => [...document.querySelectorAll('[data-testid="deadline-camp-link"]')].filter((a) => !a.closest('.deadline-archived')).map((a) => a.textContent.trim())))
    const hasFilter = (await page.getByTestId('filter-camps').count()) > 0
    if (hasFilter !== nonArchived.size > 1) throw new Error(`camp filter visible=${hasFilter} with ${nonArchived.size} active camps`)
    if (hasFilter) {
      await page.getByTestId('filter-camps').locator('input').click()
      const opt = page.getByRole('option').first()
      const campName = (await opt.innerText()).trim()
      await opt.click()
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      await expandAll()
      const rowCount = await page.locator(ROWS).count()
      const own = await hasCamp(campName)
      if (rowCount === 0 || rowCount !== own) throw new Error(`camp filter: ${own} of ${rowCount} rows match ${campName}`)
      await shot(page, 'flow-radar-camp-filter')
      await page.getByTestId('filters-reset').click()
    }
    await openMore()
    await sw.uncheck()
    await page.getByTestId('done-switch').locator('input').uncheck()
    await closeMore()
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
    await page.waitForSelector('[data-testid="deadlines-summary"]', { timeout: 8000 })
    const load = page.getByTestId('nds-tasks-load')
    await load.waitFor({ timeout: 5000 })
    await load.click()
    await page.getByTestId('nds-tasks-stand').waitFor({ timeout: 5000 })
    await page.waitForTimeout(500)
    if (await page.getByTestId('nds-tasks-error').count()) throw new Error('nds tasks error')
    await expandAll()
    const t = await text()
    if (!t.includes('Lagerbericht einreichen')) throw new Error('NDS task not in radar')
    await shot(page, 'flow-radar-nds-tasks')
  })
}
