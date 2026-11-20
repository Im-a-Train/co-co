/** In-app update flows of the UI harness (imported by run.mjs): Settings > Updates, update dialog (ADR 0017). */

export async function updateFlows({ page, step, shot, BASE }) {
  const tid = (id) => page.getByTestId(id)

  await step('flow: Updates settings -> check -> dialog', async () => {
    await page.waitForFunction(() => !document.querySelector('.v-overlay--active'), null, { timeout: 8000 }).catch(() => {})
    await page.goto(`${BASE}#/einstellungen#updates`)
    await page.waitForSelector('[data-testid="update-settings"]', { timeout: 15000 })
    await page.waitForTimeout(400)
    const installed = await tid('update-installed').innerText()
    if (!/Installierte Version/.test(installed)) throw new Error(`installed text: ${installed}`)
    // Auto-check toggle defaults to on.
    if (!(await tid('update-auto').locator('input').isChecked())) throw new Error('auto check should default to on')
    await shot(page, 'flow-update-settings')
    await tid('update-check').click()
    await tid('update-dialog').waitFor({ timeout: 5000 })
    const versions = await tid('update-versions').innerText()
    if (!versions.includes('0.1.0-alpha.99') || !versions.includes('0.1.0-alpha.14')) throw new Error(`versions: ${versions}`)
    const notes = await tid('update-notes').innerText()
    if (!/Desktop-Icon/.test(notes)) throw new Error('release notes missing')
    if (!(await tid('update-install').count())) throw new Error('install button missing')
    await shot(page, 'flow-update-dialog')
    await tid('update-later').click()
    await tid('update-dialog').waitFor({ state: 'hidden', timeout: 5000 })
    const res = await tid('update-result').innerText()
    if (!/neue Version/.test(res)) throw new Error(`result text: ${res}`)
  })
}
