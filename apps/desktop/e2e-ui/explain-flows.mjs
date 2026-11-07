/** explain flows of the UI harness (imported by run.mjs): «Warum?» panel on the Befunde page. */

export async function explainFlows({ page, step, go, shot }) {
  await step('flow: «Warum?» shows rule version, pack and input facts', async () => {
    await go('befunde', 'flow-explain-start')
    await page.waitForSelector('[data-testid="finding-explain"]', { timeout: 8000 })
    const panel = page.locator('[data-testid="finding-explain"]').first()
    if (await panel.locator('[data-testid="finding-explain-body"]').count()) throw new Error('panel should start collapsed')
    await panel.getByRole('button', { name: 'Warum?' }).click()
    await page.waitForSelector('[data-testid="finding-explain-body"]', { timeout: 3000 })
    const text = await panel.innerText()
    if (!/Regel [A-Z0-9-]+, Version \S+/.test(text)) throw new Error('rule version text missing: ' + text)
    if (!/Regelpaket .+, Version/.test(text)) throw new Error('pack text missing')
    if (!/geprüft für Lagerbeginn \d{2}\.\d{2}\.\d{4}/.test(text)) throw new Error('camp date text missing')
    if (!/Einstufung/.test(text)) throw new Error('severity reasoning missing')
    if (!/Verwendete Angaben/.test(text) || !/Geprüfte Werte/.test(text)) throw new Error('inputs/facts sections missing')
    await page.waitForTimeout(300)
    await shot(page, 'flow-explain-open')
  })
}
