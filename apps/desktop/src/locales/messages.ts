/**
 * Merges all locale area files (src/locales/<lang>/<area>.json) into one message tree per language.
 * FROZEN (architect). Builders only edit their own area file; see docs/contracts/ownership.md.
 *
 * Every area file is deep-merged into the root, so area files must namespace their keys
 * (e.g. feedback.json -> { "feedback": { ... } }). A duplicate leaf key throws at startup.
 */
export type MessageTree = { [key: string]: string | MessageTree }

const files = import.meta.glob<MessageTree>('./*/*.json', { eager: true, import: 'default' })

function isTree(v: unknown): v is MessageTree {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function deepMerge(target: MessageTree, source: MessageTree, path = ''): MessageTree {
  for (const [key, value] of Object.entries(source)) {
    const here = path ? `${path}.${key}` : key
    const existing = target[key]
    if (isTree(existing) && isTree(value)) deepMerge(existing, value, here)
    else if (existing !== undefined) throw new Error(`i18n: duplicate key '${here}'`)
    else target[key] = isTree(value) ? deepMerge({}, value, here) : value
  }
  return target
}

function build(): Record<string, MessageTree> {
  const out: Record<string, MessageTree> = {}
  for (const [file, tree] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const lang = /^\.\/([^/]+)\//.exec(file)?.[1]
    if (!lang) continue
    out[lang] = deepMerge(out[lang] ?? {}, tree)
  }
  return out
}

export const messages = build()

const templateFiles = import.meta.glob<string>('./*/feedback-templates/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

/**
 * Feedback templates (markdown) keyed by `<lang>/<templateFile>`, e.g. `de/grobprogramm`.
 * Content and format are owned by the feedback builder.
 */
export const feedbackTemplates: Record<string, string> = Object.fromEntries(
  Object.entries(templateFiles).map(([file, md]) => [
    file.replace(/^\.\//, '').replace('/feedback-templates/', '/').replace(/\.md$/, ''),
    md,
  ]),
)
