/**
 * Writes the narration list for tts.py: [{ id, voice }] with the pronunciation dictionary applied.
 *   node tools/promo-video/narration.mjs [outFile]   (default promo-out/narration.json)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { speakable } from './pronounce.mjs'
import { BEATS } from './story.mjs'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const out = resolve(process.argv[2] || join(repo, 'promo-out', 'narration.json'))
mkdirSync(dirname(out), { recursive: true })
const items = BEATS.map((b) => ({ id: b.id, voice: speakable(b.voice) }))
writeFileSync(out, JSON.stringify(items, null, 1))
console.log(`${items.length} beats -> ${out}`)
