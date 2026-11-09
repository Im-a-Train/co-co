/**
 * Pure helpers for xlsx documents: cell references, display strings and the plain text used for search
 * and linking. Reading the file itself (read-excel-file) lives in ./extract.ts.
 */

export interface XlsxSheetView {
  name: string
  /** Display strings; rows may differ in length. */
  rows: string[][]
}

/** 0-based column index -> "A", "B", ..., "Z", "AA". */
export function columnLetters(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 0-based (col, row) -> "B4". */
export function cellRef(col: number, row: number): string {
  return `${columnLetters(col)}${row + 1}`
}

/** "B4" -> { col: 1, row: 3 }; null for invalid references. */
export function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(ref.trim())
  if (!m) return null
  let col = 0
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  const row = parseInt(m[2]!, 10)
  if (row < 1) return null
  return { col: col - 1, row: row - 1 }
}

/** Cell value (string, number, boolean, Date, null) -> display string. */
export function cellToText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH'
  return String(v)
}

/** Plain text of all sheets: "## Sheet" heading followed by tab-separated rows (empty rows skipped). */
export function sheetsToText(sheets: XlsxSheetView[]): string {
  const parts: string[] = []
  for (const s of sheets) {
    const lines = s.rows.map((r) => r.join('\t').replace(/\s+$/, '')).filter((l) => l.length > 0)
    parts.push([`## ${s.name}`, ...lines].join('\n'))
  }
  return parts.join('\n\n').trim()
}
