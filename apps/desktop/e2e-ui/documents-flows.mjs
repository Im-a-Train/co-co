/**
 * Document viewer flows of the UI harness (imported by run.mjs): pdf pages, xlsx cell anchor, gpx track and
 * profile, "Befund erfassen" on a document with anchor.
 */
export async function documentsFlows({ page, step, go, shot }) {
  const settle = (ms = 800) => page.waitForTimeout(ms)

  async function openDoc(name) {
    await go('dokumente', 'flow-doc-viewer')
    await page.getByRole('button', { name: /Dateien/i }).first().click({ timeout: 5000 })
    await settle(1500)
    await page.locator('.v-list-item', { hasText: name }).first().click()
    await page.waitForSelector('[data-testid="document-viewer"]', { timeout: 10000 })
    await settle(1200)
  }

  await step('flow: drop zone only while empty; the first added document opens in «Details»', async () => {
    await go('dokumente', 'flow-doc-empty')
    for (let i = 0; i < 20 && (await page.getByTestId('document-remove').count()); i++) {
      await page.getByTestId('document-remove').first().click()
      await settle(300)
    }
    await page.getByTestId('document-drop-zone').waitFor({ timeout: 5000 })
    await page.getByTestId('document-drop-zone').getByRole('button', { name: /Dateien wählen/ }).click()
    await page.waitForSelector('[data-testid="document-viewer"]', { timeout: 10000 })
    if (await page.getByTestId('document-drop-zone').count()) throw new Error('drop zone still shown although documents exist')
    await settle(800)
    await shot(page, 'flow-doc-first-added')
  })

  await step('flow: document viewer renders a pdf and paginates', async () => {
    await openDoc('programm.pdf')
    await page.waitForSelector('[data-testid="pdf-page"]', { timeout: 10000 })
    const n = await page.locator('[data-testid="pdf-page"]').count()
    if (n !== 2) throw new Error(`expected 2 pdf pages, got ${n}`)
    await shot(page, 'flow-doc-pdf')
  })

  await step('flow: manual finding on a pdf page is listed in the document panel', async () => {
    await page.getByTestId('document-add-finding').click()
    await page.getByTestId('manual-finding-comment').locator('textarea').first().fill('Seite pruefen')
    await page.getByTestId('manual-finding-save').click()
    await settle(1000)
    const txt = await page.getByTestId('document-findings').innerText()
    if (!/Seite pruefen/.test(txt) || !/S\. 1/.test(txt)) throw new Error('finding or page anchor missing: ' + txt)
    await shot(page, 'flow-doc-pdf-finding')
  })

  await step('flow: document viewer shows xlsx cells and anchors a cell', async () => {
    await openDoc('materialliste.xlsx')
    await page.waitForSelector('[data-testid="xlsx-cell"]', { timeout: 10000 })
    await page.locator('[data-cell="A3"]').click()
    await page.getByTestId('document-add-finding').click()
    const anchor = await page.getByTestId('manual-finding-anchor').innerText()
    if (!/A3/.test(anchor)) throw new Error('cell anchor missing: ' + anchor)
    await shot(page, 'flow-doc-xlsx')
    await page.keyboard.press('Escape')
    await settle(500)
  })

  await step('flow: document viewer shows gpx track and profile', async () => {
    await openDoc('route-bergtour.gpx')
    await page.waitForSelector('[data-testid="gpx-track"]', { timeout: 10000 })
    await page.getByTestId('gpx-profile').click({ position: { x: 300, y: 60 } })
    await settle(400)
    const txt = await page.getByTestId('document-viewer').innerText()
    if (!/Kilometer/.test(txt)) throw new Error('selected point readout missing')
    await page.getByTestId('gpx-layers').waitFor({ timeout: 3000 })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="gpx-track"] image').length > 0, null, { timeout: 5000 })
    await shot(page, 'flow-doc-gpx')
  })

  await step('flow: safety concept shows checklist with honest wording and keeps state on AI switch', async () => {
    await openDoc('sicherheitskonzept.txt')
    const check = page.getByTestId('document-check')
    const txt = await check.innerText()
    if (!/von 8 gefunden|Punkten gefunden/.test(txt)) throw new Error('verdict line missing: ' + txt)
    if (/Punkt\(e\) fehlen/.test(txt)) throw new Error('old wording «Punkt(e) fehlen» still shown: ' + txt)
    if (!/nicht gefunden/.test(txt)) throw new Error('«nicht gefunden» missing: ' + txt)
    if (await page.getByTestId('checklist-confirm-hospital').count()) {
      await page.getByTestId('checklist-confirm-hospital').click()
      await settle(500)
    }
    const hospital = await page.getByTestId('checklist-hospital').innerText()
    if (!/von dir bestätigt/.test(hospital)) throw new Error('«Ist vorhanden» not shown as confirmed: ' + hospital)
    // «Als Befund übernehmen» opens the coach-finding dialog prefilled, category «Dokumente».
    await page.getByTestId('checklist-finding-crisisContact').click()
    const comment = await page.getByTestId('manual-finding-comment').locator('textarea').first().inputValue()
    if (!/nicht gefunden: Krisenkontakt/.test(comment)) throw new Error('finding text not prefilled: ' + comment)
    const cat = await page.getByTestId('manual-finding-category-documents').getAttribute('class')
    if (!/text-primary/.test(cat ?? '')) throw new Error('category «Dokumente» not preselected')
    await page.keyboard.press('Escape')
    await settle(500)
    await page.getByTestId('document-ai-switch').locator('input').check({ force: true })
    await settle(600)
    const zone = await page.getByTestId('document-zone').innerText()
    if (!/freigegeben/.test(zone)) throw new Error('zone chip does not follow the AI flag: ' + zone)
    if (!(await page.getByTestId('safety-checklist').isVisible())) throw new Error('checklist vanished after AI switch')
    await page.getByTestId('document-ai-switch').locator('input').uncheck({ force: true })
    await shot(page, 'flow-doc-concept')
    // The name guess «Sicherheitskonzept?» in the list: ✓ turns it into the chip.
    const row = page.locator('.v-list-item', { hasText: 'sicherheitskonzept.txt' }).first()
    if (await row.getByTestId('document-concept-yes').count()) {
      await row.getByTestId('document-concept-yes').click()
      await settle(500)
    }
    if (await row.getByTestId('document-concept-guess').count()) throw new Error('concept guess still open after ✓')
    if (!(await row.locator('.v-chip', { hasText: /^\s*Sicherheitskonzept\s*$/ }).count())) throw new Error('chip «Sicherheitskonzept» missing')
  })

  await step('flow: a normal document is not audited as safety concept', async () => {
    await openDoc('materialliste.xlsx')
    const txt = await page.getByTestId('document-check').innerText()
    if (!/Wird nicht als Sicherheitskonzept geprüft/.test(txt)) throw new Error('notConcept line missing: ' + txt)
    await page.getByTestId('document-mark-concept').click()
    await settle(500)
    if (!(await page.getByTestId('safety-checklist').isVisible())) throw new Error('checklist not shown after marking')
    await page.getByTestId('document-unmark-concept').click()
    await settle(300)
  })

  await step('flow: gpx card leads with walking time and links an activity from the card', async () => {
    await openDoc('route-bergtour.gpx')
    const card = page.getByTestId('gpx-card')
    const lead = await page.getByTestId('gpx-lead').innerText()
    if (!/Gehzeit ca\./.test(lead)) throw new Error('lead line missing: ' + lead)
    if (!(await card.getByText('Berechnung anpassen').count())) throw new Error('adjust panel missing')
    await card.getByText('Berechnung anpassen').click()
    await settle(400)
    const descent = page.getByTestId('gpx-adjust').locator('input[type="checkbox"]').first()
    const descentOn = !(await descent.isChecked())
    await descent.setChecked(descentOn, { force: true })
    await settle(300)
    if (await page.getByTestId('gpx-pick-activity').count()) {
      await page.getByTestId('gpx-pick-activity').locator('input').click()
      await page.locator('.v-overlay--active .v-list-item').first().click()
      await settle(600)
      const after = await card.innerText()
      if (!/Zeitslot/.test(after)) throw new Error('slot verdict missing after link: ' + after)
    }
    // Saving the link replaces the record; the calculation switches must keep the coach's choice.
    if ((await descent.isChecked()) !== descentOn) throw new Error('«Abstieg einrechnen» was reset by saving the link')
    await shot(page, 'flow-doc-gpx-card')
  })

  await step('flow: the list links a document to an activity («Aktivität verknüpfen …»)', async () => {
    await openDoc('materialliste.xlsx')
    const row = page.locator('.v-list-item', { hasText: 'materialliste.xlsx' }).first()
    if (await row.locator('.v-chip__close').count()) return // already linked by an earlier run in this session
    await row.getByTestId('document-link-action').click()
    await page.locator('.v-overlay--active [data-testid="document-link-picker"] input').click()
    await settle(300)
    await page.locator('.v-overlay--active .v-list-item').first().click()
    await settle(800)
    if (!(await row.locator('.v-chip__close').count())) throw new Error('linked activity chip missing in the list')
    if (await row.getByTestId('document-link-action').count()) throw new Error('«Aktivität verknüpfen …» still shown after linking')
    await shot(page, 'flow-doc-list-link')
  })
}
