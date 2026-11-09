/** Structured feedback flows of the UI harness (imported by run.mjs). Relies on a coach finding from coachfindings-flows. */
export async function feedbackFlows({ page, step, go, shot }) {
  const settle = (ms = 800) => page.waitForTimeout(ms)

  await step('flow: feedback general section and general point "siko"', async () => {
    await go('feedback', 'flow-fb-structure')
    await page.waitForSelector('[data-testid="feedback-general-section"]', { timeout: 5000 })
    await page.getByTestId('feedback-general-point-siko').waitFor({ timeout: 5000 })
    await page.getByTestId('feedback-take-siko').click()
    await settle(1000)
    if ((await page.getByTestId('feedback-general-point-siko').getAttribute('data-done')) !== '1') throw new Error('siko not marked done')
    await shot(page, 'flow-fb-general')
  })

  await step('flow: refine dialog creates feedback from findings under day/activity headings', async () => {
    await go('feedback', 'flow-fb-refine')
    const before = await page.getByTestId('feedback-item').count()
    await page.getByTestId('feedback-refine').click()
    await page.waitForSelector('[data-testid="refine-dialog"]', { timeout: 5000 })
    await settle(1200)
    if (await page.getByTestId('refine-empty').count()) throw new Error('refine dialog empty')
    await shot(page, 'flow-fb-refine-dialog')
    const checks = page.locator('[data-testid^="refine-check-"]')
    if (!(await checks.count())) throw new Error('no refine checkboxes')
    if (!(await page.getByTestId('refine-submit').isEnabled())) await checks.first().locator('input').check({ force: true })
    await page.getByTestId('refine-submit').click()
    await settle(1500)
    const after = await page.getByTestId('feedback-item').count()
    if (after <= before) throw new Error(`no items created (${before} -> ${after})`)
    const hasDay = await page.locator('[data-testid^="feedback-day-"]').count()
    const hasAct = await page.locator('[data-testid^="feedback-activity-"]').count()
    if (!hasDay || !hasAct) throw new Error(`day/activity headings missing (${hasDay}/${hasAct})`)
    await shot(page, 'flow-fb-refined')
    // Leave no overlay (snackbar) open: the next flow navigates by hash and Vuetify aborts that while one is active.
    await page.waitForFunction(() => !document.querySelector('.v-overlay--active'), null, { timeout: 10000 }).catch(() => {})
  })
}
