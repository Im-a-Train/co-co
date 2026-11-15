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

  await step('flow: a general point can be removed for this camp and restored', async () => {
    await page.getByTestId('feedback-general-point-delete-psa').click()
    await settle(600)
    if (await page.getByTestId('feedback-general-point-psa').count()) throw new Error('psa still listed after delete')
    await page.getByTestId('feedback-general-points-restore').waitFor({ timeout: 3000 })
    await shot(page, 'flow-fb-general-hidden')
    await page.getByTestId('feedback-general-points-restore').click()
    await settle(600)
    await page.getByTestId('feedback-general-point-psa').waitFor({ timeout: 3000 })
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

  async function addActivityItem(body) {
    await page.getByRole('button', { name: 'Aktivitäts-Punkt' }).click({ timeout: 5000 })
    await page.locator('.v-select').first().click()
    await page.locator('.v-overlay--active .v-list-item').first().click()
    await page.locator('.v-card textarea').first().fill(body)
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await settle(500)
    return page.getByTestId('feedback-item').filter({ hasText: body })
  }

  await step('flow: «In eCamp posten» can be undone within 5 s', async () => {
    await go('feedback', 'flow-fb-undo')
    const card = await addActivityItem('Undo-Test: Bitte Material ergänzen.')
    await card.getByTestId('feedback-post').click({ timeout: 5000 })
    await page.getByTestId('feedback-post-undo').click({ timeout: 3000 })
    await settle(6500)
    if ((await card.getAttribute('data-status')) !== 'draft') throw new Error('item was posted despite undo')
    await shot(page, 'flow-fb-undone')
  })

  await step('flow: approval asks before «Bewilligt» with open blockers and needs a note for a Muss', async () => {
    await go('runden', 'flow-fb-approve')
    await page.getByRole('button', { name: 'Bewilligt', exact: true }).first().click({ timeout: 5000 })
    await page.getByTestId('approval-dialog').waitFor({ timeout: 5000 })
    await shot(page, 'flow-fb-approval-dialog')
    const blockers = await page.getByTestId('approval-blockers').innerText()
    if (!/offen|nicht/i.test(blockers)) throw new Error('no blockers listed: ' + blockers)
    if (/Muss-Befund/.test(blockers)) {
      if (await page.getByTestId('approval-force').isEnabled()) throw new Error('«Trotzdem bewilligen» enabled without note while a Muss is open')
      await page.getByTestId('approval-note').locator('textarea').first().fill('Mit Leitenden besprochen.')
    }
    await page.getByTestId('approval-force').click()
    await settle(800)
    const chip = await page.locator('[data-mark="current"]').first().innerText()
    if (!/Bewilligt/.test(chip)) throw new Error('status not approved: ' + chip)
    await shot(page, 'flow-fb-approved')
    // back to «In Prüfung» so later flows start from the usual state
    await page.getByRole('button', { name: 'In Prüfung', exact: true }).first().click({ timeout: 5000 })
    await settle(500)
  })

  await step('flow: copying the preview offers «Ja, gesendet» that marks drafts and requests changes', async () => {
    await go('feedback', 'flow-fb-sent')
    await page.getByTestId('preview-copy').click({ timeout: 5000 })
    await page.getByTestId('sent-bar').waitFor({ timeout: 4000 })
    await shot(page, 'flow-fb-sent-bar')
    await page.getByTestId('sent-bar-confirm').click()
    await settle(1500)
    if (await page.locator('[data-testid="feedback-item"][data-status="draft"]').count()) throw new Error('drafts remain after «Ja, gesendet»')
    await page.getByTestId('preview-include-sent').waitFor({ timeout: 3000 })
    await shot(page, 'flow-fb-sent-done')
    await go('runden', 'flow-fb-status-after-sent')
    if (!/Änderungen angefragt/.test(await page.evaluate(() => document.body.innerText))) throw new Error('status «Änderungen angefragt» missing')
    await page.getByRole('button', { name: 'In Prüfung', exact: true }).first().click({ timeout: 5000 })
    await settle(500)
  })
}
