/** commentSync flows of the UI harness (imported by run.mjs). Mock IPC answers GET /api/comments with invented replies. */

export async function commentSyncFlows({ page, step, go, shot }) {
  const text = () => page.evaluate(() => document.body.innerText)

  async function addAndPost(activityIndex, body) {
    await page.getByRole('button', { name: 'Aktivitäts-Punkt' }).click({ timeout: 5000 })
    await page.locator('.v-select').first().click()
    await page.locator('.v-overlay--active .v-list-item').nth(activityIndex).click()
    await page.locator('.v-card textarea').first().fill(body)
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.waitForTimeout(500)
    const card = page.getByTestId('feedback-item').filter({ hasText: body })
    await card.getByRole('button', { name: 'In eCamp posten' }).click({ timeout: 5000 })
    await card.locator('[data-status="posted"]').first().waitFor({ timeout: 5000 }).catch(() => {})
    await page.waitForFunction((b) => [...document.querySelectorAll('[data-testid="feedback-item"]')].some((c) => c.textContent.includes(b) && c.getAttribute('data-status') === 'posted'), body, { timeout: 5000 })
  }

  await step('flow: commentsync posts two items and syncs resolved + reply', async () => {
    await go('feedback', 'flow-commentsync')
    await page.waitForSelector('[data-testid="sync-comments"]', { state: 'attached', timeout: 8000 }).catch(() => {})
    await addAndPost(0, 'Sync-Test eins: Bitte Sicherheitsüberlegungen ergänzen.')
    await addAndPost(1, 'Sync-Test zwei: Wie sieht das Schlechtwetterprogramm aus?')
    await shot(page, 'flow-commentsync-posted')
    await page.getByTestId('sync-comments').click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="chip-resolved"]', { timeout: 8000 })
    await page.waitForTimeout(500)
    await shot(page, 'flow-commentsync-synced')
    const t = await text()
    if (!/In eCamp erledigt \(\d{2}\.\d{2}\.\d{4}\)/.test(t)) throw new Error('resolved chip with date missing')
    if (!/2 Antworten/.test(t)) throw new Error('reply count chip missing')
    if (!/neu/.test(await page.getByTestId('chip-replies').first().innerText())) throw new Error('neu highlight missing')
    if (!/\d erledigt, \d neue Antworten/.test(t)) throw new Error('summary snackbar missing')
  })

  await step('flow: commentsync expanding replies marks them seen', async () => {
    await page.getByTestId('chip-replies').first().click()
    await page.waitForSelector('[data-testid="reply-list"]', { timeout: 5000 })
    await page.waitForTimeout(500)
    await shot(page, 'flow-commentsync-replies')
    const t = await text()
    if (!/Anna Beispiel/.test(t) || !/Wir ergänzen das bis morgen/.test(t)) throw new Error('direct reply missing')
    if (!/vermutlich Antwort/.test(t)) throw new Error('inferred label missing')
    if (/<p>/.test(t)) throw new Error('reply rendered as HTML')
    if (/·\s*neu/.test(await page.getByTestId('chip-replies').first().innerText())) throw new Error('still marked neu after expanding')
  })
}
