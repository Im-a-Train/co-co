/**
 * Hilfsmittel flows of the UI harness (imported by run.mjs): list, deep link, full-text search incl. pasted
 * content, edit + reset, custom entry, rule source links (ADR 0013).
 */
export async function resourcesFlows({ page, step, shot, BASE }) {
  const settle = (ms = 900) => page.waitForTimeout(ms)
  const items = () => page.locator('[data-testid="resource-item"]')

  async function openResources(query = '') {
    // A hash-only goto would keep the mounted view (and its search text): start from a blank page.
    await page.goto('about:blank')
    await page.goto(`${BASE}#/hilfsmittel${query}`)
    await page.waitForSelector('[data-testid="resources-view"]', { timeout: 15000 })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="resource-item"]').length > 0, null, { timeout: 15000 })
    await settle(1200)
  }
  async function openItem(key) {
    const item = page.locator(`#res-${key}`)
    if (!(await item.locator('.v-expansion-panel-text').isVisible().catch(() => false))) await item.locator('.v-expansion-panel-title').click()
    await settle(500)
    return item
  }

  await step('flow: hilfsmittel lists the bundled sources', async () => {
    await openResources()
    const n = await items().count()
    if (n < 23) throw new Error(`expected >= 23 entries, got ${n}`)
    await shot(page, 'hilfsmittel')
  })

  await step('flow: hilfsmittel ?key= opens and highlights one entry', async () => {
    await openResources('?key=MAN')
    const open = page.locator('#res-MAN.v-expansion-panel--active')
    if ((await open.count()) !== 1) throw new Error('MAN panel not open')
    const txt = await open.innerText()
    if (!/Zuletzt geprüft/i.test(txt) || !/Bearbeiten/i.test(txt)) throw new Error('details/actions missing')
    await shot(page, 'hilfsmittel-detail')
  })

  await step('flow: hilfsmittel paste text makes content searchable with highlighted snippet', async () => {
    await openResources()
    const item = await openItem('MAN')
    await item.getByTestId('resource-paste').click()
    await page.getByTestId('resource-paste-text').locator('textarea').first().fill('Im Zeltlager muss ein Trockenraum fuer nasse Kleider vorhanden sein.')
    await page.getByTestId('resource-paste-save').click()
    await settle(1000)
    await page.getByTestId('resources-search').locator('input').fill('Trockenraum')
    await settle(600)
    const n = await items().count()
    if (n !== 1) throw new Error(`expected 1 hit, got ${n}`)
    const mark = await page.locator('[data-testid="resource-snippet"] mark').first().innerText()
    if (!/trockenraum/i.test(mark)) throw new Error(`highlight missing: ${mark}`)
    await shot(page, 'hilfsmittel-search')
  })

  await step('flow: hilfsmittel edit marks entry as geaendert, reset removes it', async () => {
    await openResources()
    const item = await openItem('MAN')
    await item.getByTestId('resource-edit').click()
    await page.waitForSelector('[data-testid="resource-edit-dialog"]')
    await settle(500)
    await page.getByTestId('res-field-title').locator('input').fill('Manual (angepasst)')
    await page.getByTestId('res-save').click()
    await settle(900)
    if ((await page.locator('#res-MAN [data-testid="resource-modified"]').count()) !== 1) throw new Error('no «geändert» chip')
    if (!/Manual \(angepasst\)/.test(await page.locator('#res-MAN').innerText())) throw new Error('title not updated')
    await page.locator('#res-MAN').getByTestId('resource-reset').click()
    await settle(500)
    await page.getByTestId('resource-confirm').click()
    await settle(900)
    if ((await page.locator('#res-MAN [data-testid="resource-modified"]').count()) !== 0) throw new Error('chip still there after reset')
  })

  await step('flow: hilfsmittel adds and deletes a custom entry', async () => {
    await openResources()
    await page.getByTestId('resource-add').click()
    await page.waitForSelector('[data-testid="resource-edit-dialog"]')
    await settle(500)
    await page.getByTestId('res-field-key').locator('input').fill('MEIN-DOK')
    await page.getByTestId('res-field-title').locator('input').fill('Mein Merkblatt')
    await page.getByTestId('res-field-url').locator('input').fill('https://example.ch/merkblatt')
    await page.getByTestId('res-save').click()
    await settle(1000)
    if ((await page.locator('#res-MEIN-DOK [data-testid="resource-custom"]').count()) !== 1) throw new Error('custom entry/chip missing')
    await shot(page, 'hilfsmittel-custom')
    await page.locator('#res-MEIN-DOK').getByTestId('resource-delete').click()
    await settle(500)
    await page.getByTestId('resource-confirm').click()
    await settle(900)
    if ((await page.locator('#res-MEIN-DOK').count()) !== 0) throw new Error('custom entry not deleted')
  })

  await step('flow: rule card source title links to the Hilfsmittel', async () => {
    await page.goto(`${BASE}#/regeln`)
    await page.waitForSelector('.v-expansion-panel-title', { timeout: 15000 })
    await settle(1200)
    await page.locator('.v-expansion-panel-title').first().click()
    await settle(700)
    const link = page.getByTestId('rule-source-link').first()
    const href = await link.getAttribute('href')
    if (!href || !/hilfsmittel\?key=/.test(href)) throw new Error(`bad href: ${href}`)
    await link.click()
    await page.waitForSelector('[data-testid="resources-view"]', { timeout: 8000 })
    await settle(1200)
    if ((await page.locator('.v-expansion-panel--active').count()) < 1) throw new Error('target entry not opened')
  })
}
