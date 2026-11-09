/** Pure helpers for the MCP connection guide (Settings > KI > MCP-Server). */

/**
 * Claude Desktop config (claude_desktop_config.json). Claude Desktop/Cursor on Windows do not escape spaces in
 * args when they spawn npx, so the whole header value ('Bearer <token>', which contains the space) lives in env
 * and the arg itself has no space (mcp-remote README workaround).
 */
export function claudeDesktopConfig(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        'co-co': {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${COCO_MCP_AUTH}'],
          env: { COCO_MCP_AUTH: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  )
}

export function claudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http co-co ${url} --header "Authorization: Bearer ${token}"`
}

export function genericConfig(url: string, token: string): string {
  return [`URL: ${url}`, 'Transport: Streamable HTTP', `Header: Authorization: Bearer ${token}`].join('\n')
}

/** 'coco_' + 8 bullets + last 4 characters. */
export function maskToken(token: string): string {
  return `coco_${'•'.repeat(8)}${token.slice(-4)}`
}
