/** Helpers for the collapsible panels of the Lager-Angaben view («Teilnehmende und Leitung», «Regelmodule …», «Weitere Angaben»). */

/** Opens one panel (`participants` | `rules` | `more`) unless it already is open. */
export async function openAngabenPanel(page, name) {
  const panel = page.getByTestId(`inputs-panel-${name}`)
  await panel.waitFor({ timeout: 8000 })
  if (!(await panel.evaluate((el) => el.classList.contains('v-expansion-panel--active')))) {
    await panel.locator('.v-expansion-panel-title').click()
    await page.waitForTimeout(450)
  }
}
