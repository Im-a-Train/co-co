/** Triage flows of the UI harness (imported by run.mjs). */

export async function triageFlows({ page, step, go, shot, BASE }) {
  const text = () => page.evaluate(() => document.body.innerText)
  const progress = async () => {
    const m = (await page.locator('[data-testid="triage-progress"]').innerText()).match(/(\d+) von (\d+)/)
    return m ? { done: Number(m[1]), total: Number(m[2]) } : null
  }
  const currentId = () => page.locator('.triage-item.active').first().getAttribute('data-finding-id')
  const statusOf = (id) => page.locator(`.triage-item[data-finding-id="${id}"]`).getAttribute('data-status')

  await step('flow: Übersicht "Feedback erstellen" opens triage with editor', async () => {
    await go('uebersicht', 'flow-overview')
    await page.getByRole('button', { name: /feedback erstellen/i }).first().click({ timeout: 5000 })
    await page.waitForURL(/befunde\?.*befund=/, { timeout: 5000 })
    await page.waitForSelector('[data-testid="triage-editor"]', { timeout: 5000 })
    await page.waitForTimeout(500)
    await shot(page, 'flow-overview-to-triage')
    const val = await page.locator('[data-testid="triage-text"] textarea').first().inputValue()
    if (!val.trim()) throw new Error('editor not prefilled')
    const focused = await page.evaluate(() => document.activeElement?.tagName)
    if (focused !== 'TEXTAREA') throw new Error('editor text not focused, got ' + focused)
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
    const afterIgnore = await currentId()
    if (afterIgnore === afterSave) throw new Error('did not advance after ignore')
    const st2 = await statusOf(afterSave)
    if (st2 !== 'ignored') throw new Error('second finding status ' + st2)
    await page.getByRole('button', { name: 'Überspringen' }).click()
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
  })

  await step('flow: triage position survives tab switch and back/forward', async () => {
    await go('befunde', 'flow-triage-resume')
    await page.waitForSelector('.triage-item')
    await page.locator('.triage-item').nth(3).click()
    await page.waitForTimeout(400)
    const id = await currentId()
    await page.locator('.v-tab', { hasText: /Raster/i }).first().click()
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

  await step('flow: ignore 3 of the same rule -> prompt -> only this camp', async () => {
    await go('befunde', 'flow-disable')
    await page.waitForSelector('.triage-item')
    const items = await page.locator('.triage-item').evaluateAll((els) =>
      els.map((e) => ({ id: e.getAttribute('data-finding-id'), status: e.getAttribute('data-status') })),
    )
    const byRule = {}
    for (const it of items) {
      const rule = it.id.split(':')[0]
      if (it.status === 'open') (byRule[rule] ??= []).push(it.id)
    }
    const rule = Object.keys(byRule).find((r) => byRule[r].length >= 3)
    if (!rule) throw new Error('no rule with 3 open findings: ' + JSON.stringify(Object.fromEntries(Object.entries(byRule).map(([k, v]) => [k, v.length]))))
    for (const id of byRule[rule].slice(0, 3)) {
      await page.locator(`.triage-item[data-finding-id="${id}"]`).click()
      await page.waitForTimeout(300)
      await page.getByRole('button', { name: 'Ignorieren & weiter' }).click()
      await page.waitForTimeout(600)
    }
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
