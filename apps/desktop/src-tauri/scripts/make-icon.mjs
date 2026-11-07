// Generates the 1024x1024 source icon (icons/app-icon.png) without any
// dependencies (node:zlib only). Then run:
//   npx tauri icon src-tauri/icons/app-icon.png -o src-tauri/icons   (from apps/desktop)
// Motif: a white tent with a door on a rounded green square.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const SS = 4 // supersampling per axis
const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '..', 'icons', 'app-icon.png')

const BG = [46, 125, 50] // #2e7d32
const FG = [255, 255, 255]
const DOOR = [27, 94, 32] // #1b5e20

function insideRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function insideTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const s = (p0x, p0y, p1x, p1y) => (x - p1x) * (p0y - p1y) - (p0x - p1x) * (y - p1y)
  const d1 = s(ax, ay, bx, by)
  const d2 = s(bx, by, cx, cy)
  const d3 = s(cx, cy, ax, ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

const tent = [
  [512, 230],
  [180, 790],
  [844, 790],
]
const door = [
  [512, 450],
  [400, 790],
  [624, 790],
]

function sample(x, y) {
  if (!insideRoundedRect(x, y, 40, 40, 984, 984, 200)) return null
  if (insideTriangle(x, y, ...door)) return DOOR
  if (insideTriangle(x, y, ...tent)) return FG
  if (y >= 790 && y <= 830 && x >= 140 && x <= 884) return FG // ground line
  return BG
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1)
  raw[row] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
        if (c) {
          r += c[0]; g += c[1]; b += c[2]; a += 255
        }
      }
    }
    const n = SS * SS
    const o = row + 1 + x * 4
    const cover = a / 255
    raw[o] = cover ? Math.round(r / cover) : 0
    raw[o + 1] = cover ? Math.round(g / cover) : 0
    raw[o + 2] = cover ? Math.round(b / cover) : 0
    raw[o + 3] = Math.round(a / n)
  }
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes)`)
