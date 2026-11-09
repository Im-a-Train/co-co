/**
 * Tiny binary document fixtures for the UI harness (mock IPC) and unit tests: a generated PDF, a two-sheet
 * xlsx (base64) and a small GPX track with elevations. No real data.
 */

/** Two-sheet xlsx: "Material" (Artikel/Menge) and "Budget" (Posten/CHF). */
export const XLSX_BASE64 =
  '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'

/** Minimal valid PDF with one text line per page (Helvetica, ASCII only). */
export function makePdf(pageTexts: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&')
  const objs: string[] = []
  const n = pageTexts.length
  // 1 catalog, 2 pages, 3 font, then page + content object per page.
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${pageTexts.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`)
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  pageTexts.forEach((text, i) => {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    )
    const stream = `BT /F1 14 Tf 20 150 Td (${esc(text)}) Tj ET`
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
