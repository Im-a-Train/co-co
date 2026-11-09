/**
 * Text extraction (browser/webview only).
 * Heavy libraries are loaded lazily; keep them dynamic.
 */
import type { DocumentKind } from '../types'
import type { GpxPoint } from './index'
import { cellToText, sheetsToText, type XlsxSheetView } from './xlsxView'

export async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

export async function loadMammoth() {
  const mod = await import('mammoth')
  return mod.default ?? mod
}

export async function loadXlsxReader() {
  const mod = await import('read-excel-file/universal')
  return mod.default
}

/** Reads all sheets of an xlsx file into display strings. */
export async function readXlsx(bytes: Uint8Array): Promise<XlsxSheetView[]> {
  const read = await loadXlsxReader()
  const copy = bytes.slice()
  const sheets = await read(new Blob([copy]))
  return sheets.map((s) => ({ name: s.sheet, rows: s.data.map((row) => row.map((c) => cellToText(c))) }))
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs()
  // pdf.js transfers the buffer to the worker; pass a copy so the caller's bytes stay usable.
  const task = pdfjs.getDocument({ data: bytes.slice() })
  const pdf = await task.promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      let line = ''
      const lines: string[] = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        line += item.str
        if (item.hasEOL) {
          lines.push(line)
          line = ''
        } else if (item.str && !item.str.endsWith(' ')) {
          line += ' '
        }
      }
      if (line) lines.push(line)
      pages.push(lines.join('\n'))
    }
    return pages.join('\n\n').trim()
  } finally {
    await task.destroy()
  }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await loadMammoth()
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const res = await mammoth.extractRawText({ arrayBuffer })
  return res.value.trim()
}

async function extractXlsx(bytes: Uint8Array): Promise<string> {
  return sheetsToText(await readXlsx(bytes))
}

/** Extracts plain text; GPX returns the track name + waypoint names. */
export async function extractText(kind: DocumentKind, bytes: Uint8Array): Promise<string> {
  switch (kind) {
    case 'pdf':
      return extractPdf(bytes)
    case 'docx':
      return extractDocx(bytes)
    case 'xlsx':
      return extractXlsx(bytes)
    case 'txt':
    case 'md':
      return decodeUtf8(bytes)
    case 'gpx':
      return gpxNames(decodeUtf8(bytes)).join('\n')
    default:
      throw new Error('Dateityp wird nicht unterstützt')
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

/** Track name + waypoint names. */
export function gpxNames(xml: string): string[] {
  const out: string[] = []
  const re = /<(?:[\w-]+:)?name>([\s\S]*?)<\/(?:[\w-]+:)?name>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const n = decodeEntities(m[1]!)
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}

function parseEle(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/** Dependency-free GPX parser (used when DOMParser is not available, e.g. in tests). */
export function parseGpxText(xml: string): { name: string | null; points: GpxPoint[] } {
  const pick = (tag: string): GpxPoint[] => {
    const pts: GpxPoint[] = []
    const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g')
    let m: RegExpExecArray | null
    const segStarts = [...xml.matchAll(/<(?:[\w-]+:)?trkseg/g)].map((x) => x.index ?? 0)
    let prevSeg = -1
    while ((m = re.exec(xml))) {
      const seg = segStarts.filter((x) => x <= m!.index).length
      const attrs = m[1] ?? ''
      const lat = /\blat\s*=\s*["']([^"']+)["']/.exec(attrs)
      const lon = /\blon\s*=\s*["']([^"']+)["']/.exec(attrs)
      if (!lat || !lon) continue
      const la = parseFloat(lat[1]!)
      const lo = parseFloat(lon[1]!)
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue
      const ele = /<ele>\s*([^<\s]+)\s*<\/ele>/.exec(m[2] ?? '')
      const pt: GpxPoint = { lat: la, lon: lo, ele: parseEle(ele?.[1]) }
      if (prevSeg !== -1 && seg !== prevSeg) pt.newSegment = true
      prevSeg = seg
      pts.push(pt)
    }
    return pts
  }
  let points = pick('trkpt')
  if (!points.length) points = pick('rtept')
  if (!points.length) points = pick('wpt')
  return { name: gpxNames(xml)[0] ?? null, points }
}

/** Parses GPX XML with DOMParser (trkpt, then rtept, then wpt); falls back to a text parser without DOM. */
export function parseGpx(xml: string): { name: string | null; points: GpxPoint[] } {
  if (typeof DOMParser === 'undefined') return parseGpxText(xml)
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX-Datei ist kein gültiges XML')
  const nameEl = doc.getElementsByTagName('name')[0]
  const name = nameEl?.textContent?.trim() || null
  for (const tag of ['trkpt', 'rtept', 'wpt']) {
    const els = Array.from(doc.getElementsByTagName(tag))
    if (!els.length) continue
    const points: GpxPoint[] = []
    let prevParent: ParentNode | null = null
    for (const el of els) {
      const lat = parseFloat(el.getAttribute('lat') ?? '')
      const lon = parseFloat(el.getAttribute('lon') ?? '')
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      const pt: GpxPoint = { lat, lon, ele: parseEle(el.getElementsByTagName('ele')[0]?.textContent) }
      if (prevParent !== null && el.parentNode !== prevParent) pt.newSegment = true
      prevParent = el.parentNode
      points.push(pt)
    }
    return { name, points }
  }
  return { name, points: [] }
}
