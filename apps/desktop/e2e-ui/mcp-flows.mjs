/** MCP / OpenAI-compatible provider flows of the UI harness (imported by run.mjs): Settings > KI (ADR 0012). */

export async function mcpFlows({ page, step, shot, BASE }) {
  const tid = (id) => page.getByTestId(id)
  const text = () => page.evaluate(() => document.body.innerText)

  async function openSettings() {
    await page.waitForFunction(() => !document.querySelector('.v-overlay--active'), null, { timeout: 8000 }).catch(() => {})
    await page.goto(`${BASE}#/einstellungen`)
    await page.waitForSelector('.v-application', { timeout: 15000 })
    await page.waitForSelector('[data-testid="ai-enable"]', { timeout: 8000 })
    await page.waitForTimeout(500)
  }
  async function ensureSwitch(id, on) {
    const input = tid(id).locator('input')
    if ((await input.isChecked()) !== on) {
      await input.setChecked(on, { force: true })
      await page.waitForTimeout(500)
    }
  }

  await step('flow: KI provider OpenAI-compatible (Ollama)', async () => {
    await openSettings()
    await ensureSwitch('ai-enable', true)
    await tid('ai-tab-provider').click()
    await tid('ai-provider-openai').click()
    await tid('ai-openai-preset-ollama').click()
    const url = await tid('ai-openai-base-url').locator('input').inputValue()
    if (url !== 'http://localhost:11434/v1') throw new Error(`unexpected base url: ${url}`)
    await tid('ai-openai-load-models').click()
    await page.waitForTimeout(500)
    await tid('ai-openai-model').click()
    await page.getByRole('option', { name: 'llama3.1:8b' }).click()
    await tid('ai-openai-test').click()
    await tid('ai-openai-test-result').waitFor({ timeout: 5000 })
    const res = await tid('ai-openai-test-result').innerText()
    if (!/Modelle/.test(res)) throw new Error(`test result without "Modelle": ${res}`)
    await shot(page, 'flow-ai-provider-openai')
  })

  await step('flow: MCP server on + guide', async () => {
    await tid('ai-tab-mcp').click()
    await ensureSwitch('mcp-enable', true)
    await tid('mcp-status').filter({ hasText: /läuft/ }).waitFor({ timeout: 5000 })
    const url = await tid('mcp-url').innerText()
    if (!url.includes('127.0.0.1:41731/mcp')) throw new Error(`mcp-url: ${url}`)
    const snippet = await tid('mcp-guide-snippet').innerText()
    if (!snippet.includes('127.0.0.1:41731/mcp')) throw new Error('guide snippet without url')
    if (/coco_[A-Za-z0-9]{20}/.test(snippet)) throw new Error('guide snippet shows the clear token')
    const tabs = page.locator('[data-testid^="mcp-guide-tab"]')
    const n = await tabs.count()
    if (n < 3) throw new Error(`expected 3 guide tabs, found ${n}`)
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(250)
    }
    await shot(page, 'flow-mcp-server')
  })

  await step('flow: MCP tool switches', async () => {
    const reads = tid('mcp-tools-read').locator('[data-testid^="mcp-tool-"]')
    const writes = tid('mcp-tools-write').locator('[data-testid^="mcp-tool-"]')
    if ((await reads.count()) !== 9) throw new Error(`read tools: ${await reads.count()}`)
    if ((await writes.count()) !== 5) throw new Error(`write tools: ${await writes.count()}`)
    const states = (loc) => loc.evaluateAll((els) => els.map((e) => (e.querySelector('input') ?? e).checked))
    if (!(await states(reads)).every(Boolean)) throw new Error('not all read tools on')
    if ((await states(writes)).some(Boolean)) throw new Error('a write tool is on by default')
    await tid('mcp-tool-add_feedback').locator('input').setChecked(true, { force: true })
    await page.waitForTimeout(600)
    if (!(await tid('mcp-tool-add_feedback').locator('input').isChecked())) throw new Error('add_feedback did not switch on')
    await shot(page, 'flow-mcp-tools')
  })

  await step('flow: MCP read call through the bridge', async () => {
    const ok = await page.evaluate(() => window.__cocoMockMcp.call('list_camps', {}))
    if (ok.isError) throw new Error(`list_camps failed: ${ok.text.slice(0, 200)}`)
    if (!/Auf in die Berge|Lager/i.test(ok.text)) throw new Error(`no camp title in result: ${ok.text.slice(0, 200)}`)
    const off = await page.evaluate(() => window.__cocoMockMcp.call('post_feedback_comment', { feedbackId: 'x' }))
    if (!off.isError) throw new Error('disabled write tool did not return an error')
  })

  await step('flow: MCP write call needs confirmation', async () => {
    await page.evaluate(() => {
      window.__mcpWrite = window.__cocoMockMcp.call('add_feedback', {
        campId: '70ca971c992f',
        kind: 'suggestion',
        text: 'Bitte Leiter A die Sicherheitsüberlegungen ergänzen lassen.',
      })
    })
    await tid('mcp-confirm-dialog').waitFor({ timeout: 5000 })
    await page.waitForTimeout(400) // let the dialog transition finish before the screenshot
    await shot(page, 'flow-mcp-confirm')
    await tid('mcp-confirm-allow').click()
    const out = await page.evaluate(() => window.__mcpWrite)
    if (out.isError) throw new Error(`add_feedback failed: ${out.text.slice(0, 200)}`)
    await page.waitForTimeout(500)
    await tid('mcp-log').waitFor({ timeout: 5000 })
    const t = await tid('mcp-log').innerText()
    if (!/Feedback-Entwurf hinzufügen|add_feedback/.test(t)) throw new Error(`log without add_feedback: ${t.slice(0, 200)}`)
    await shot(page, 'flow-mcp-log')
    void text
  })
}
