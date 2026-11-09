import { describe, expect, it } from 'vitest'
import { claudeCodeCommand, claudeDesktopConfig, genericConfig, maskToken } from '../mcpGuide'

const URL = 'http://127.0.0.1:41731/mcp'
const TOKEN = 'coco_abcdef0123456789'

describe('mcpGuide', () => {
  it('builds the Claude Desktop config with the token in env', () => {
    const cfg = JSON.parse(claudeDesktopConfig(URL, TOKEN))
    const s = cfg.mcpServers['co-co']
    expect(s.command).toBe('npx')
    expect(s.args).toEqual(['-y', 'mcp-remote', URL, '--header', 'Authorization:${COCO_MCP_AUTH}'])
    // No arg may contain a space (Claude Desktop on Windows splits it); the space lives in env.
    for (const a of s.args as string[]) expect(a).not.toContain(' ')
    expect(s.env).toEqual({ COCO_MCP_AUTH: `Bearer ${TOKEN}` })
  })
  it('builds the Claude Code command', () => {
    expect(claudeCodeCommand(URL, TOKEN)).toBe(
      `claude mcp add --transport http co-co ${URL} --header "Authorization: Bearer ${TOKEN}"`,
    )
  })
  it('builds the generic config', () => {
    expect(genericConfig(URL, TOKEN).split('\n')).toEqual([
      `URL: ${URL}`,
      'Transport: Streamable HTTP',
      `Header: Authorization: Bearer ${TOKEN}`,
    ])
  })
  it('masks the token but keeps the last 4 characters', () => {
    const m = maskToken(TOKEN)
    expect(m).toBe('coco_••••••••6789')
    expect(m).not.toContain('abcdef')
  })
})
