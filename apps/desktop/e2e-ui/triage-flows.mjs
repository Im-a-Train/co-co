/** Triage flows of the UI harness (imported by run.mjs). */

export async function triageFlows({ page, step, go, shot, BASE }) {
  const text = () => page.evaluate(() => document.body.innerText)
  const progress = async () => {
    const m = (await page.locator('[data-testid="triage-progress"]').innerText()).match(/(\d+) von (\d+)/)
    return m ? { done: Number(m[1]), total: Number(m[2]) } : null
  }
  const currentId = () => page.locator('.triage-item.active').first().getAttribute('data-finding-id')
  const statusOf = (id) => page.locator(`.triage-item[data-finding-id="${id}"]`).getAttribute('data-status')

  await step('flow: Übersicht progress card links to the triage', async () => {
    await go('uebersicht', 'flow-overview')
    await page.waitForSelector('[data-testid="overview-progress"]', { timeout: 5000 })
    await shot(page, 'flow-overview-progress')
    await page.locator('[data-testid="overview-progress-triage"]').first().click({ timeout: 5000 })
    await page.waitForURL(/\/befunde/, { timeout: 5000 })
  })

  await step('flow: triage is the default and shows progress + list + activity', async () => {
    await go('befunde', 'flow-triage')
    await page.waitForSelector('.triage-item', { timeout: 8000 })
    const p = await progress()
    if (!p || !p.total) throw new Error('no progress')
    await shot(page, 'flow-triage-start')
    const t = await text()
    if (!/Befunde durchgehen/i.test(t)) throw new Error('mode toggle missing')
    if (/Übersteuer/i.test(t)) throw new Error('found Übersteuern in UI')
    const counter = await page.locator('[data-testid="triage-counter"]').innerText()
    if (!/\d+ Themen? · \d+ Befunden?/.test(counter) && !/\d+ Themen? · \d+ Befunde/.test(counter)) throw new Error('counter: ' + counter)
  })

  await step('flow: «Zuerst für dich» holds the coach homework, not part of the triage', async () => {
    await go('befunde', 'flow-coach-todo')
    await page.waitForSelector('.triage-item', { timeout: 8000 })
    const block = page.locator('[data-testid="coach-todo"]')
    if (!(await block.count())) throw new Error('coach todo block missing')
    const bt = await block.innerText()
    if (!/Zuerst für dich \(\d+\)/.test(bt)) throw new Error('title: ' + bt)
    if (!/Sie gehen nicht ans Lagerteam/.test(bt)) throw new Error('hint missing')
    // the triage starts with the block folded: hint and one button per kind of input, no rows
    if ((await block.getAttribute('data-open')) !== 'false') throw new Error('block is not folded in the triage')
    if (!(await block.locator('[data-testid^="coach-todo-"]:not([data-testid="coach-todo-toggle"])').count())) throw new Error('folded block has no action button')
    await shot(page, 'flow-coach-todo-folded')
    await page.locator('[data-testid="coach-todo-toggle"]').click()
    await page.waitForTimeout(300)
    const ids = await block.locator('[data-testid="coach-todo-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-finding-id')))
    if (!ids.length) throw new Error('expanded block shows no rows')
    for (const id of ids) {
      if (await page.locator(`.triage-item[data-finding-id="${id}"]`).count()) throw new Error('coach todo is also in the triage list: ' + id)
    }
    await shot(page, 'flow-coach-todo-block')
    await block.locator('[data-testid="coach-todo-inputs"]').first().click()
    await page.waitForURL(/\/angaben/, { timeout: 5000 })
  })

  await step('flow: same-rule day findings are one entry with dates; «Einzeln anzeigen» expands', async () => {
    await go('befunde', 'flow-group')
    await page.waitForSelector('.triage-item', { timeout: 8000 })
    const row = page.locator('.triage-item[data-group]').first()
    if (!(await row.count())) throw new Error('no grouped entry in the list')
    const title = await row.innerText()
    if (!/ · \d+ Tage \(.+\)/.test(title)) throw new Error('group title: ' + title)
    const before = await page.locator('.triage-item').count()
    await row.click()
    await page.waitForTimeout(300)
    await page.locator('[data-testid="triage-expand"]').click()
    await page.waitForTimeout(300)
    const after = await page.locator('.triage-item').count()
    if (after <= before) throw new Error(`expand did not add rows (${before} -> ${after})`)
    const member = await page.locator('.triage-item.member').first().innerText()
    if (!/\d{2}\.\d{2}\./.test(member)) throw new Error('member row has no date: ' + member)
    await shot(page, 'flow-group-expanded')
    await page.locator('[data-testid="triage-expand"]').click()
    await page.waitForTimeout(300)
    if ((await page.locator('.triage-item').count()) !== before) throw new Error('collapse did not restore the rows')
  })

  await step('flow: decision sits right under the finding, buttons inside the viewport', async () => {
    await go('befunde', 'flow-decision-layout')
    await page.waitForSelector('[data-testid="triage-save"]', { timeout: 8000 })
    // the homework block above starts folded in the triage, so it does not push the decision down
    const todo = page.locator('[data-testid="coach-todo"]')
    if ((await todo.count()) && (await todo.getAttribute('data-open')) !== 'false') throw new Error('coach todo block is not folded on arrival')
    await page.evaluate(() => window.scrollTo(0, 0))
    const vp = page.viewportSize()
    const box = await page.locator('[data-testid="triage-save"]').boundingBox()
    if (!box || box.y + box.height > vp.height) throw new Error('save button below the fold: ' + JSON.stringify(box) + ' vs ' + vp.height)
    const labels = await page.locator('[data-testid="triage-editor"]').innerText()
    if (!/Feedback speichern & weiter \(F\)/i.test(labels) || !/Ignorieren & weiter \(I\)/i.test(labels) || !/Überspringen \(J\)/i.test(labels)) throw new Error('button labels: ' + labels)
    if (!(await page.locator('[data-testid="triage-more"]').count())) throw new Error('more menu missing')
    await shot(page, 'flow-decision-layout')
    // a narrow window (about 1024 x 700): the main button stays on screen for every open entry
    await page.setViewportSize({ width: 1024, height: 700 })
    try {
      await page.waitForTimeout(400)
      const rows = page.locator('.triage-item[data-status="open"]')
      const below = []
      for (let i = 0; i < (await rows.count()); i++) {
        await rows.nth(i).click()
        await page.waitForTimeout(150)
        await page.evaluate(() => window.scrollTo(0, 0))
        const b = await page.locator('[data-testid="triage-save"]').boundingBox()
        if (b && b.y + b.height > 700) below.push(`${await rows.nth(i).getAttribute('data-finding-id')}: ${Math.round(b.y + b.height)}`)
      }
      await rows.first().click()
      await page.evaluate(() => window.scrollTo(0, 0))
      await shot(page, 'flow-decision-layout-1024')
      if (below.length) throw new Error('save button below the fold at 1024x700: ' + below.join(', '))
    } finally {
      await page.setViewportSize({ width: 1360, height: 860 })
    }
  })

  await step('flow: triage 3 findings by keyboard (save, ignore, skip)', async () => {
    await go('befunde', 'flow-triage-keys')
    await page.waitForSelector('.triage-item')
    const before = await progress()
    const startId = await currentId()
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('f')
    await page.waitForTimeout(700)
    const afterSave = await currentId()
    if (afterSave === startId) throw new Error('did not advance after save')
    const st1 = await statusOf(startId)
    if (st1 !== 'feedback') throw new Error('first finding status ' + st1)
    await page.keyboard.press('i')
    await page.waitForTimeout(700)
    let afterIgnore = await currentId()
    if (afterIgnore === afterSave) {
      // A Muss needs a reason: «I» focuses the reason field instead of ignoring.
      const msg = await page.locator('[data-testid="triage-reason"]').innerText()
      if (!/Bei Muss-Befunden ist ein Grund nötig/.test(msg)) throw new Error('did not advance after ignore and no reason prompt: ' + msg)
      await page.locator('[data-testid="triage-reason"] input').fill('Wird mit der Lagerleitung geklärt.')
      await page.getByRole('button', { name: /Ignorieren & weiter/ }).click()
      await page.waitForTimeout(700)
      afterIgnore = await currentId()
      if (afterIgnore === afterSave) throw new Error('did not advance after ignore with reason')
    }
    const st2 = await statusOf(afterSave)
    if (st2 !== 'ignored') throw new Error('second finding status ' + st2)
    await page.getByRole('button', { name: /Überspringen/ }).click()
    await page.waitForTimeout(500)
    const afterSkip = await currentId()
    if (afterSkip === afterIgnore) throw new Error('did not advance after skip')
    const st3 = await statusOf(afterIgnore)
    if (st3 !== 'open') throw new Error('skipped finding should stay open, is ' + st3)
    const after = await progress()
    if (after.done !== before.done + 2) throw new Error(`progress ${before.done} -> ${after.done}`)
    await page.keyboard.press('k')
    await page.waitForTimeout(300)
    if ((await currentId()) === afterSkip) throw new Error('K did not move')
    await shot(page, 'flow-triage-after-keys')
  })

  await step('flow: feedback tab shows the created item', async () => {
    await go('feedback', 'flow-feedback-from-triage')
    const t = await text()
    if (/Noch kein Feedback/i.test(t)) throw new Error('feedback list empty')
    // Add an activity item through the form (triage creates camp-scope items only).
    await page.getByRole('button', { name: /aktivitäts-punkt/i }).click()
    await page.locator('.v-field', { hasText: 'Aktivität wählen' }).first().click()
    await page.locator('.v-overlay--active .v-list-item').first().click()
    await page.locator('textarea').first().fill('Bitte Sicherheitskonzept ergänzen.')
    await page.getByRole('button', { name: /^speichern$/i }).click()
    // «In eCamp öffnen» lives in the card's ⋯ menu since the feedback card cleanup.
    await page.getByTestId('feedback-item').filter({ hasText: 'Bitte Sicherheitskonzept ergänzen.' }).getByTestId('feedback-more').click({ timeout: 5000 })
    await page.waitForSelector('[data-test="open-ecamp"]', { timeout: 5000 })
    const body = await page.locator('.v-sheet').first().innerText().catch(() => '')
    if (!(await page.locator('[data-test="open-ecamp"]').count())) throw new Error('"In eCamp öffnen" button missing')
    if (!/in ecamp öffnen/i.test(await text())) throw new Error('button label missing')
    if (/\/program\/activity\//.test(body) || /https?:\/\//.test(body)) throw new Error('whatsapp preview must not contain a link: ' + body.slice(0, 200))
    if (!/\*?\d+\.\d+(\/\d+\.\d+)* /.test(body)) throw new Error('whatsapp preview lacks block number: ' + body.slice(0, 200))
    await shot(page, 'flow-feedback-links')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.locator('.v-tab', { hasText: /e-?mail/i }).first().click()
    await page.waitForSelector('[data-test="feedback-html"] a', { timeout: 5000 })
    const htmlSheet = page.locator('[data-test="feedback-html"]')
    const anchorHref = (await htmlSheet.locator('a').first().getAttribute('href')) ?? ''
    const anchorText = (await htmlSheet.locator('a').first().innerText()).trim()
    const visible = await htmlSheet.innerText()
    if (!anchorText) throw new Error('email preview link has no title text')
    if (!/\/program\/activity\//.test(anchorHref)) throw new Error('email link href wrong: ' + anchorHref)
    if (visible.includes(anchorHref) || /https?:\/\//.test(visible)) throw new Error('email preview shows the raw URL: ' + visible.slice(0, 300))
    await shot(page, 'flow-feedback-links-email')
  })

  await step('flow: triage position survives tab switch and back/forward', async () => {
    await go('befunde', 'flow-triage-resume')
    await page.waitForSelector('.triage-item')
    await page.locator('.triage-item').nth(3).click()
    await page.waitForTimeout(400)
    const id = await currentId()
    await page.locator('.v-tab', { hasText: /^GP$/ }).first().click()
    await page.waitForTimeout(700)
    await page.locator('.v-tab', { hasText: /Befunde/i }).first().click()
    await page.waitForSelector('.triage-item')
    await page.waitForTimeout(500)
    if ((await currentId()) !== id) throw new Error('position lost after tab switch')
    await page.goBack()
    await page.waitForTimeout(500)
    await page.goForward()
    await page.waitForSelector('.triage-item')
    await page.waitForTimeout(500)
    if ((await currentId()) !== id) throw new Error('position lost after back/forward')
  })

  await step('flow: finding -> grid -> «Zurück zum Befund» returns to the same finding', async () => {
    await go('befunde', 'flow-back-to-finding')
    await page.waitForSelector('.triage-item')
    // pick the first finding that has an activity to jump to
    const n = await page.locator('.triage-item').count()
    let id = null
    for (let i = 0; i < n; i++) {
      await page.locator('.triage-item').nth(i).click()
      await page.waitForTimeout(250)
      if (!(await page.getByRole('button', { name: /im gp öffnen/i }).count())) continue
      const candidate = await currentId()
      await page.getByRole('button', { name: /im gp öffnen/i }).first().click()
      await page.waitForURL(/raster\?.*vonBefund=/, { timeout: 5000 })
      if (/[?&]activity=/.test(page.url())) {
        id = candidate
        break
      }
      // a day finding opens the day (tag=), not an activity: back and try the next one
      await page.goBack()
      await page.waitForSelector('.triage-item', { timeout: 5000 })
    }
    if (!id) throw new Error('no finding with an activity found')
    await page.waitForSelector('[data-testid="back-to-finding"]', { timeout: 5000 })
    await page.waitForTimeout(500)
    await shot(page, 'flow-back-to-finding-grid-drawer')
    // non-modal drawer (wide window): the sticky bar is the only «Zurück zum Befund»
    if ((await page.locator('[data-testid="drawer-back-to-finding"]').count()) !== 0) throw new Error('drawer repeats the back button on a wide window')
    const ctx = await page.locator('[data-testid="back-to-finding-context"]').innerText()
    if (!/Du kommst|[A-Za-zäöü]{4}/.test(ctx) || /\b[A-Z]{2,4}-[A-Z]{2,5}-\d\d\b/.test(ctx)) throw new Error('back bar shows a rule id (or no title): ' + ctx)
    // Esc closes only the drawer; the bar button stays reachable
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await shot(page, 'flow-back-to-finding-grid')
    await page.locator('[data-testid="back-to-finding"]').click()
    await page.waitForSelector('.triage-item.active', { timeout: 5000 })
    await page.waitForTimeout(500)
    if ((await currentId()) !== id) throw new Error('not back on the same finding')
    if (!/befunde\?.*befund=/.test(page.url())) throw new Error('url: ' + page.url())
    await shot(page, 'flow-back-to-finding-triage')

    // keyboard: Alt+Left from the grid, via history
    await page.getByRole('button', { name: /im gp öffnen/i }).first().click()
    await page.waitForSelector('[data-testid="back-to-finding"]', { timeout: 5000 })
    await page.waitForTimeout(400)
    await page.keyboard.press('Alt+ArrowLeft')
    await page.waitForSelector('.triage-item.active', { timeout: 5000 })
    await page.waitForTimeout(500)
    if ((await currentId()) !== id) throw new Error('Alt+Left: not back on the same finding')
  })

  await step('flow: a day finding opens the GP at its day (?tag=, no activity drawer)', async () => {
    await go('befunde', 'flow-day-finding')
    await page.waitForSelector('.triage-item')
    const n = await page.locator('.triage-item').count()
    let found = false
    const seen = []
    for (let i = 0; i < n; i++) {
      await page.locator('.triage-item').nth(i).click()
      await page.waitForTimeout(250)
      if (!(await page.getByRole('button', { name: /im gp öffnen/i }).count())) continue
      await page.getByRole('button', { name: /im gp öffnen/i }).first().click()
      await page.waitForURL(/raster\?.*vonBefund=/, { timeout: 5000 })
      seen.push(page.url().split('#')[1])
      if (/[?&]tag=/.test(page.url())) {
        found = true
        break
      }
      await page.goBack()
      await page.waitForSelector('.triage-item', { timeout: 5000 })
    }
    if (!found) throw new Error('no day finding opened the GP with tag=: ' + seen.join(' ; '))
    await page.waitForSelector('[data-testid="back-to-finding"]', { timeout: 5000 })
    await page.waitForTimeout(600)
    if (await page.locator('[data-testid="drawer-back-to-finding"]').count()) throw new Error('a day finding must not open the activity drawer')
    await shot(page, 'flow-day-finding-grid')
    await page.locator('[data-testid="back-to-finding"]').click()
    await page.waitForSelector('.triage-item.active', { timeout: 5000 })
  })

  await step('flow: a grouped day entry outlines all of its days in the GP', async () => {
    await go('befunde', 'flow-group-grid')
    await page.waitForSelector('.triage-item', { timeout: 8000 })
    const row = page.locator('.triage-item[data-group]:not(.member)').first()
    if (!(await row.count())) throw new Error('no grouped entry in the list')
    const count = Number(await row.getAttribute('data-group'))
    await row.click()
    await page.waitForTimeout(300)
    const days = await page.locator('[data-testid="finding-group-days"]').innerText()
    if (!/Betrifft \d+ Tage: /.test(days)) throw new Error('group days line: ' + days)
    await page.getByRole('button', { name: /im gp öffnen/i }).first().click()
    await page.waitForURL(/raster\?.*vonBefund=/, { timeout: 5000 })
    await page.waitForSelector('[data-testid="grid-focus-day"]', { timeout: 5000 })
    const outlined = await page.locator('[data-testid="grid-focus-day"]').count()
    if (outlined !== count) throw new Error(`group of ${count} days outlines ${outlined}`)
    await shot(page, 'flow-group-grid')
  })

  await step('flow: a day group shows its days, no single activity', async () => {
    await go('befunde', 'flow-group-detail')
    await page.waitForSelector('.triage-item', { timeout: 8000 })
    await page.locator('.triage-item[data-group]:not(.member)').first().click()
    await page.waitForTimeout(300)
    const detail = await page.locator('.triage-detail').innerText()
    if (!/Betrifft \d+ Tage: /.test(detail)) throw new Error('days line missing')
    if (!/Dieser Befund betrifft keine einzelne Aktivität/.test(detail)) throw new Error('a day group must not show the first day\'s activity')
    if (!(await page.getByTestId('triage-open-grid').count())) throw new Error('«Im GP öffnen» missing for a day group')
    await shot(page, 'flow-group-detail')
  })

  await step('flow: GP: a closed drawer leaves no selection; an unconfirmed mapping change survives a tab switch', async () => {
    await go('raster', 'flow-gp-state')
    await page.locator('.wg-block').first().click({ timeout: 5000 })
    await page.waitForTimeout(500)
    if (!(await page.locator('.wg-block-sel').count())) throw new Error('no selection while the drawer is open')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    if (await page.locator('.wg-block-sel').count()) throw new Error('blocks stay outlined after the drawer closed')
    // change one class without confirming, go to DP and back
    await page.getByTestId('grid-mapping-edit').click()
    await page.locator('[data-testid="mapping-row"] .v-select').last().click()
    await page.locator('.v-overlay--active .v-list-item:not(.v-list-item--active)').first().click()
    await page.waitForSelector('[data-testid="mapping-dirty"]', { timeout: 3000 })
    await page.locator('.camp-tabs .v-tab', { hasText: /^DP$/ }).click()
    await page.waitForURL(/aktivitaeten/, { timeout: 5000 })
    await page.waitForTimeout(500)
    await page.locator('.camp-tabs .v-tab', { hasText: /^GP$/ }).click()
    await page.waitForURL(/raster/, { timeout: 5000 })
    await page.waitForSelector('[data-testid="mapping-dirty"]', { state: 'visible', timeout: 5000 })
    if (!/Nicht bestätigte Änderung/.test(await page.getByTestId('grid-mapping-line').innerText())) throw new Error('pending line lost')
    await shot(page, 'flow-gp-mapping-pending')
    await page.getByTestId('mapping-discard').click()
    await page.waitForTimeout(400)
    if (!/Kategorien zugeordnet am/.test(await page.getByTestId('grid-mapping-line').innerText())) throw new Error('discard did not restore the confirmed line')
  })

  await step('flow: ignoring a Muss asks for a reason first', async () => {
    await go('befunde', 'flow-must-reason')
    await page.waitForSelector('.triage-item', { timeout: 8000 })
    const must = page.locator('.triage-item[data-severity="must"][data-status="open"]').first()
    if (!(await must.count())) return // no open Muss in this camp state
    await must.click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /Ignorieren & weiter/ }).click()
    await page.waitForTimeout(400)
    const msg = await page.locator('[data-testid="triage-reason"]').innerText()
    if (!/Bei Muss-Befunden ist ein Grund nötig/.test(msg)) throw new Error('no reason prompt: ' + msg)
    if ((await must.getAttribute('data-status')) !== 'open') throw new Error('Muss was ignored without a reason')
    await shot(page, 'flow-must-reason')
  })

  await step('flow: ignore a group of the same rule -> prompt -> only this camp', async () => {
    await go('befunde', 'flow-disable')
    await page.waitForSelector('.triage-item')
    // one I ignores all days of a group: that is more than 3 ignores of the same rule
    const row = page.locator('.triage-item[data-group][data-status="open"]:not([data-severity="must"])').first()
    if (!(await row.count())) throw new Error('no open group of a non-Muss rule')
    const first = await row.getAttribute('data-finding-id')
    const rule = first.split(':')[0]
    await row.click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /Ignorieren & weiter/ }).click()
    await page.waitForSelector('[data-testid="disable-prompt"]', { timeout: 4000 })
    await shot(page, 'flow-disable-prompt')
    const t = await text()
    if (!/schon \d+-mal ignoriert\. Regel deaktivieren\?/.test(t)) throw new Error('prompt text missing')
    await page.locator('[data-testid="disable-camp"]').click()
    await page.waitForTimeout(900)
    const left = await page.locator(`.triage-item[data-finding-id^="${rule}:"]`).count()
    if (left) throw new Error('findings of disabled rule still listed: ' + left)
    await page.waitForSelector('[data-testid="disabled-note"]')
    const note = await page.locator('[data-testid="disabled-note"]').innerText()
    if (!/1 Regel für dieses Lager deaktiviert/.test(note)) throw new Error('note: ' + note)
    await shot(page, 'flow-disabled-note')
  })

  await step('flow: rule catalogue shows disabled and re-enables', async () => {
    await page.goto(`${BASE}#/regeln`)
    await page.waitForSelector('.v-expansion-panel')
    await page.waitForTimeout(800)
    const chip = page.locator('[data-testid="rule-disabled"]').first()
    await chip.waitFor({ timeout: 4000 })
    const label = await chip.innerText()
    if (!/In 1 Lager deaktiviert/.test(label)) throw new Error('chip: ' + label)
    await shot(page, 'flow-catalog-disabled')
    await page.locator('.v-expansion-panel', { has: chip }).locator('.v-expansion-panel-title').click()
    await page.locator('[data-testid="rule-enable"]').first().click()
    await page.waitForTimeout(800)
    if (await page.locator('[data-testid="rule-disabled"]').count()) throw new Error('still disabled after enable')
    await go('befunde', 'flow-reenabled')
    await page.waitForSelector('.triage-item')
    if (await page.locator('[data-testid="disabled-note"]').count()) throw new Error('note still shown')
  })
}
