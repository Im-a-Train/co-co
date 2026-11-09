/**
 * Allowlist sanitizer for mammoth's docx HTML. Parses the HTML with a tiny tokenizer (no DOM, no v-html)
 * into a tree of safe nodes that the viewer renders with Vue render functions. Anything not on the allowlist
 * is unwrapped (children kept) or dropped (script/style); links never keep an href; images only as data: URIs.
 */

export type SafeNode = string | SafeElement

export interface SafeElement {
  tag: string
  attrs?: Record<string, string>
  children: SafeNode[]
}

const ALLOWED = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'u', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'br', 'a', 'img', 'sup', 'sub',
])
const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input'])
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript'])
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1]!.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return ''
      return String.fromCodePoint(code)
    }
    return ENTITIES[body.toLowerCase()] ?? m
  })
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  return out
}

function safeAttrs(tag: string, raw: Record<string, string>): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  if (tag === 'img') {
    const src = (raw.src ?? '').trim()
    if (DATA_IMAGE.test(src)) out.src = src
    if (raw.alt) out.alt = raw.alt
  } else if (tag === 'td' || tag === 'th') {
    for (const k of ['colspan', 'rowspan']) {
      const v = raw[k]
      if (v && /^\d{1,3}$/.test(v)) out[k] = v
    }
  }
  return Object.keys(out).length ? out : undefined
}

export function sanitizeDocxHtml(html: string): SafeNode[] {
  const root: SafeElement = { tag: '#root', children: [] }
  // Stack of open elements; null entries stand for unwrapped (not emitted) elements.
  const stack: Array<{ name: string; el: SafeElement | null }> = [{ name: '#root', el: root }]
  const target = (): SafeElement => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.el) return stack[i]!.el!
    return root
  }
  let dropDepth = 0
  let dropName = ''
  const tokenRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+|<)/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(html))) {
    if (m[0].startsWith('<!--')) continue
    if (m[4] !== undefined) {
      if (dropDepth === 0) {
        const text = decodeEntities(m[4])
        if (text) target().children.push(text)
      }
      continue
    }
    const closing = m[1] === '/'
    const name = m[2]!.toLowerCase()
    const rest = m[3] ?? ''
    if (dropDepth > 0) {
      if (name === dropName) dropDepth += closing ? -1 : 1
      continue
    }
    if (!closing && DROP_WITH_CONTENT.has(name)) {
      if (!rest.trimEnd().endsWith('/')) {
        dropDepth = 1
        dropName = name
      }
      continue
    }
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.name === name) {
          stack.length = i
          break
        }
      }
      continue
    }
    const selfClosed = VOID.has(name) || rest.trimEnd().endsWith('/')
    if (!ALLOWED.has(name)) {
      if (!selfClosed) stack.push({ name, el: null })
      continue
    }
    const el: SafeElement = { tag: name, children: [] }
    const attrs = safeAttrs(name, parseAttrs(rest))
    if (attrs) el.attrs = attrs
    if (name === 'img' && !attrs?.src) continue
    target().children.push(el)
    if (!selfClosed) stack.push({ name, el })
  }
  return root.children
}

/** Concatenated text of a sanitized tree (used for tests and as accessible fallback). */
export function safeText(nodes: SafeNode[]): string {
  return nodes.map((n) => (typeof n === 'string' ? n : n.tag === 'br' ? '\n' : safeText(n.children))).join('')
}
