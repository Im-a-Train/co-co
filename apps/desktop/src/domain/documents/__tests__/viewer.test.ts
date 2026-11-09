import { describe, expect, it } from 'vitest'
import { XLSX_BASE64, makePdf } from '../../../dev/docFixtures'
import { sanitizeDocxHtml, safeText, type SafeElement } from '../docxSanitize'
import { extractText, readXlsx } from '../extract'
import {
  cumulativeKm,
  elevationProfile,
  nearestIndexByKm,
  nearestIndexByXY,
  projectTrack,
  scaleProfile,
  segmentPaths,
} from '../gpxView'
import { detectKind, type GpxPoint } from '../index'
import { cellRef, cellToText, columnLetters, parseCellRef, sheetsToText } from '../xlsxView'

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

describe('detectKind xlsx', () => {
  it('recognises xlsx case-insensitively and not xls', () => {
    expect(detectKind('Budget.xlsx')).toBe('xlsx')
    expect(detectKind('BUDGET.XLSX')).toBe('xlsx')
    expect(detectKind('alt.xls')).toBe('other')
  })
})

describe('xlsx helpers', () => {
  it('column letters and refs', () => {
    expect(columnLetters(0)).toBe('A')
    expect(columnLetters(25)).toBe('Z')
    expect(columnLetters(26)).toBe('AA')
    expect(columnLetters(701)).toBe('ZZ')
    expect(cellRef(1, 3)).toBe('B4')
    expect(parseCellRef('B4')).toEqual({ col: 1, row: 3 })
    expect(parseCellRef('aa10')).toEqual({ col: 26, row: 9 })
    expect(parseCellRef('A0')).toBeNull()
    expect(parseCellRef('A1:C9')).toBeNull()
  })
  it('cell display strings', () => {
    expect(cellToText(null)).toBe('')
    expect(cellToText(4)).toBe('4')
    expect(cellToText(true)).toBe('WAHR')
    expect(cellToText(new Date(Date.UTC(2026, 6, 4)))).toBe('2026-07-04')
  })
  it('sheetsToText joins sheets and skips empty rows', () => {
    const t = sheetsToText([
      { name: 'A', rows: [['x', 'y'], ['', '']] },
      { name: 'B', rows: [['z']] },
    ])
    expect(t).toBe('## A\nx\ty\n\n## B\nz')
  })
  it('reads a real xlsx fixture and extracts text', async () => {
    const bytes = b64ToBytes(XLSX_BASE64)
    const sheets = await readXlsx(bytes)
    expect(sheets.map((s) => s.name)).toEqual(['Material', 'Budget'])
    expect(sheets[0]!.rows[1]).toEqual(['Seil', '4'])
    const text = await extractText('xlsx', bytes)
    expect(text).toContain('## Material')
    expect(text).toContain('Apotheke')
    expect(text).toContain('Verpflegung\t1250.5')
  })
})

describe('docx sanitizer', () => {
  const tagsOf = (nodes: ReturnType<typeof sanitizeDocxHtml>): string[] =>
    nodes.flatMap((n) => (typeof n === 'string' ? [] : [n.tag, ...tagsOf(n.children)]))

  it('keeps allowlisted structure and decodes entities', () => {
    const out = sanitizeDocxHtml('<h1>Titel</h1><p>A &amp; B <strong>fett</strong><br/>neu</p><ul><li>eins</li></ul>')
    expect(tagsOf(out)).toEqual(['h1', 'p', 'strong', 'br', 'ul', 'li'])
    expect(safeText(out)).toBe('TitelA & B fett\nneueins')
  })
  it('drops script/style content and event handlers', () => {
    const out = sanitizeDocxHtml('<p onclick="x()">ok<script>alert(1)</script><style>p{}</style></p>')
    expect(safeText(out)).toBe('ok')
    expect((out[0] as SafeElement).attrs).toBeUndefined()
    expect(tagsOf(out)).toEqual(['p'])
  })
  it('unwraps unknown tags but keeps their text', () => {
    const out = sanitizeDocxHtml('<div><span>hallo</span> <font color="red">welt</font></div>')
    expect(tagsOf(out)).toEqual([])
    expect(safeText(out)).toBe('hallo welt')
  })
  it('never keeps href on links', () => {
    const out = sanitizeDocxHtml('<a href="javascript:alert(1)" target="_blank">klick</a>')
    const a = out[0] as SafeElement
    expect(a.tag).toBe('a')
    expect(a.attrs).toBeUndefined()
  })
  it('allows only data: image URIs', () => {
    const ok = sanitizeDocxHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x"/>')
    expect((ok[0] as SafeElement).attrs?.src).toMatch(/^data:image\/png;base64,/)
    expect(sanitizeDocxHtml('<img src="https://evil.example/x.png"/>')).toEqual([])
    expect(sanitizeDocxHtml('<img src="data:image/svg+xml;base64,PHN2Zz4="/>')).toEqual([])
  })
  it('keeps numeric colspan only', () => {
    const out = sanitizeDocxHtml('<table><tbody><tr><td colspan="2" style="x" onclick="y">a</td></tr></tbody></table>')
    const td = ((((out[0] as SafeElement).children[0] as SafeElement).children[0] as SafeElement).children[0]) as SafeElement
    expect(td.attrs).toEqual({ colspan: '2' })
  })
  it('does not turn escaped markup into elements', () => {
    const out = sanitizeDocxHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(tagsOf(out)).toEqual(['p'])
    expect(safeText(out)).toBe('<script>alert(1)</script>')
  })
})

describe('gpxView helpers', () => {
  const pts: GpxPoint[] = [
    { lat: 46.0, lon: 7.0, ele: 1000 },
    { lat: 46.01, lon: 7.0, ele: 1200 },
    { lat: 46.02, lon: 7.01, ele: null },
    { lat: 46.03, lon: 7.01, ele: 1300 },
  ]
  it('cumulative km is monotonic and starts at 0', () => {
    const km = cumulativeKm(pts)
    expect(km[0]).toBe(0)
    expect(km[1]).toBeCloseTo(1.11, 1)
    for (let i = 1; i < km.length; i++) expect(km[i]!).toBeGreaterThan(km[i - 1]!)
  })
  it('does not bridge new segments', () => {
    const km = cumulativeKm([pts[0]!, { ...pts[3]!, newSegment: true }])
    expect(km[1]).toBe(0)
  })
  it('projects north up, with cos(lat) scaling and padding', () => {
    const { points } = projectTrack(pts, 400, 300, 10)
    expect(points).toHaveLength(4)
    expect(points[3]!.y).toBeLessThan(points[0]!.y)
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(10 - 1e-6)
      expect(p.x).toBeLessThanOrEqual(390 + 1e-6)
      expect(p.y).toBeGreaterThanOrEqual(10 - 1e-6)
      expect(p.y).toBeLessThanOrEqual(290 + 1e-6)
    }
    // 0.01 deg lon at 46.015 deg is shorter than 0.03 deg lat: aspect follows cos(lat).
    const dx = points[3]!.x - points[0]!.x
    const dy = points[0]!.y - points[3]!.y
    expect(dx / dy).toBeCloseTo((0.01 * Math.cos((46.015 * Math.PI) / 180)) / 0.03, 2)
  })
  it('handles empty and single-point tracks', () => {
    expect(projectTrack([], 100, 100).points).toEqual([])
    expect(projectTrack([pts[0]!], 100, 100).points).toHaveLength(1)
  })
  it('elevation profile skips points without elevation', () => {
    const prof = elevationProfile(pts)
    expect(prof.map((p) => p.index)).toEqual([0, 1, 3])
    expect(prof[2]!.km).toBeGreaterThan(prof[1]!.km)
  })
  it('nearest index by km', () => {
    const km = cumulativeKm(pts)
    expect(nearestIndexByKm(km, -5)).toBe(0)
    expect(nearestIndexByKm(km, km[2]! + 0.01)).toBe(2)
    expect(nearestIndexByKm(km, 999)).toBe(3)
    expect(nearestIndexByKm([], 1)).toBe(-1)
  })
  it('nearest index by xy', () => {
    expect(nearestIndexByXY([{ x: 0, y: 0 }, { x: 10, y: 10 }], 9, 9)).toBe(1)
    expect(nearestIndexByXY([], 1, 1)).toBe(-1)
  })
  it('segment paths split on new segments', () => {
    const src: GpxPoint[] = [pts[0]!, pts[1]!, { ...pts[2]!, newSegment: true }, pts[3]!]
    const proj = projectTrack(src, 100, 100).points
    expect(segmentPaths(proj, src)).toHaveLength(2)
  })
  it('scales the profile into the box', () => {
    const s = scaleProfile(elevationProfile(pts), 300, 100)
    expect(s.minEle).toBe(1000)
    expect(s.maxEle).toBe(1300)
    expect(s.xy[0]!.x).toBeLessThan(s.xy[2]!.x)
    expect(s.xy[2]!.y).toBeLessThan(s.xy[0]!.y)
  })
})

describe('pdf fixture', () => {
  it('produces a PDF header and trailer', () => {
    const bytes = makePdf(['a', 'b'])
    const head = String.fromCharCode(...bytes.slice(0, 8))
    expect(head).toBe('%PDF-1.4')
    expect(String.fromCharCode(...bytes.slice(-6))).toContain('%%EOF')
  })
})
