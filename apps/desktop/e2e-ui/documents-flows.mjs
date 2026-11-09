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
    await shot(page, 'flow-doc-gpx')
  })
}
