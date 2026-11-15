/** Rule modules, camp context, coach checklist and activity tags (imported by run.mjs). */
import { openAngabenPanel } from './angaben-helpers.mjs'

export async function campConfigFlows({ page, step, go, shot }) {
  await step('flow: Regelmodule card shows modules with effective state and reasons', async () => {
    await go('angaben', 'flow-regelmodule')
    await openAngabenPanel(page, 'rules')
    await page.waitForSelector('[data-testid="rule-modules-card"]', { timeout: 8000 })
    await page.waitForSelector('[data-testid="module-lst-berg-effective"]', { timeout: 8000 })
    const card = page.locator('[data-testid="rule-modules-card"]')
    const text = await card.innerText()
    for (const needle of ['Regelmodule', 'Berg', 'Wasser', 'Winter', 'PBS Best Practice', 'Lagerkontext', 'Angebotskontext', '≥ 4 Tage (ab 2027: J+S-Tage)'])
      if (!text.includes(needle)) throw new Error(`card text lacks «${needle}»`)
    await card.scrollIntoViewIfNeeded()
    await shot(page, 'flow-regelmodule-card')
  })

  await step('flow: Angaben autosave keeps typed values and shows «Gespeichert»', async () => {
    await go('angaben', 'flow-angaben-autosave')
    await page.waitForSelector('[data-testid="input-participantsCount"]', { state: 'attached', timeout: 8000 })
    if (!(await page.getByTestId('input-participantsCount').isVisible())) await openAngabenPanel(page, 'participants')
    const field = page.getByTestId('input-participantsCount').locator('input')
    await field.fill('27')
    await page.waitForFunction(() => document.querySelector('[data-testid="inputs-status"]')?.getAttribute('data-state') === 'saved', null, { timeout: 5000 })
    await shot(page, 'flow-angaben-autosave')
    // Leave and come back: the value must still be there (no «Angaben speichern» needed).
    await go('uebersicht', 'flow-angaben-autosave-back')
    await go('angaben', 'flow-angaben-autosave-again')
    await page.waitForSelector('[data-testid="input-participantsCount"]', { state: 'attached', timeout: 8000 })
    const val = await page.getByTestId('input-participantsCount').locator('input').inputValue()
    if (val !== '27') throw new Error('participantsCount not kept after leaving: ' + val)
  })

  await step('flow: switching a module to «an» is saved and shown as effective state', async () => {
    await go('angaben', 'flow-regelmodule-toggle')
    await openAngabenPanel(page, 'rules')
    await page.waitForSelector('[data-testid="module-lst-wasser-on"]', { timeout: 8000 })
    await page.getByTestId('module-lst-wasser-on').click()
    await page.waitForTimeout(700)
    const eff = await page.getByTestId('module-lst-wasser-effective').innerText()
    if (!/an/.test(eff)) throw new Error('effective state not «an»: ' + eff)
    // winterSafeAccess = nein reveals the camp-level SB approval
    await page.getByTestId('config-winterSafeAccess').click()
    await page.locator('.v-overlay--active').getByRole('option', { name: 'nein', exact: true }).click()
    await page.waitForSelector('[data-testid="sb-camp"]', { timeout: 3000 })
    await page.getByTestId('config-abroad').click()
    await page.locator('.v-overlay--active').getByRole('option', { name: 'ja', exact: true }).click()
    await page.waitForTimeout(700)
    await shot(page, 'flow-regelmodule-context')
    // back to defaults so later flows are not affected
    await page.getByTestId('module-lst-wasser-auto').click()
    await page.waitForTimeout(400)
  })

  await step('flow: Coach-Checkliste lists items grouped by module and stores done', async () => {
    await go('checkliste', 'flow-checklist')
    await page.waitForSelector('[data-testid="coach-checklist-card"] [data-testid="checklist-CL-JS-01"]', { timeout: 8000 })
    const item = page.getByTestId('checklist-CL-JS-01')
    await item.locator('input[type="checkbox"]').check({ force: true })
    await page.waitForTimeout(600)
    const progress = await page.getByTestId('checklist-progress').innerText()
    if (!/1 von \d+ erledigt/.test(progress)) throw new Error('progress not updated: ' + progress)
    await page.getByTestId('checklist-group-js').scrollIntoViewIfNeeded()
    await shot(page, 'flow-checklist-card')
    await page.getByTestId('camp-deadlines-card').scrollIntoViewIfNeeded()
    if (!(await page.getByTestId('camp-deadline').count())) throw new Error('camp deadlines missing in checklist tab')
    await shot(page, 'flow-checklist-deadlines')
    if (!(await page.getByTestId('deadline-delivery-input').count())) throw new Error('Lieferdatum field missing in checklist deadlines')
    if (await page.getByTestId('checklist-kind').filter({ hasText: 'verbindlich' }).count()) throw new Error('«verbindlich» chip should not be shown')
    await item.locator('input[type="checkbox"]').uncheck({ force: true })
    await page.waitForTimeout(400)
  })

  await step('flow: activity drawer has grouped tag rows and SB approval for sb-* tags', async () => {
    await go('raster', 'flow-tags')
    await page.locator('.wg-block').first().click({ timeout: 5000 })
    await page.getByTestId('drawer-more').click({ timeout: 5000 })
    await page.waitForSelector('[data-testid="activity-tags"]', { timeout: 5000 })
    // exclusive group: Ja then Nein leaves only «Nein» (no silent drop of the older tag), Automatisch clears it
    await page.getByTestId('tag-unternehmung').click()
    await page.getByTestId('tag-keine-unternehmung').click()
    await page.waitForTimeout(400)
    const active = (id) => page.getByTestId(id).evaluate((el) => el.classList.contains('v-btn--active'))
    if (!(await active('tag-keine-unternehmung'))) throw new Error('Nein not selected')
    if (await active('tag-unternehmung')) throw new Error('Ja still selected')
    await page.getByTestId('tag-unternehmung-auto').click()
    await page.waitForTimeout(300)
    // the Gewässer row only appears with the Wasser area
    if (await page.getByTestId('tag-group-wasser').count()) throw new Error('Gewässer row shown without the Wasser area')
    await page.getByTestId('tag-sb-wasser').click()
    await page.waitForSelector('[data-testid="activity-sb-approval"]', { timeout: 3000 })
    await page.waitForSelector('[data-testid="tag-group-wasser"]', { timeout: 3000 })
    await page.waitForTimeout(500)
    await shot(page, 'flow-activity-tags')
    // switch the area off again
    await page.getByTestId('tag-sb-wasser').click()
    await page.waitForTimeout(500)
  })

  await step('flow: Regelkatalog shows sources per rule', async () => {
    await go('uebersicht', 'flow-catalog-start')
    await page.goto(page.url().replace(/#.*/, '#/regeln'))
    await page.waitForSelector('.v-expansion-panel-title', { timeout: 8000 })
    await page.locator('.v-expansion-panel-title').first().click()
    await page.waitForSelector('[data-testid="rule-sources"]', { timeout: 3000 })
    await shot(page, 'flow-catalog-sources')
  })
}
