/**
 * Lays the narration clips under the silent recording, using the beat start times from timeline.json.
 * Needs a full ffmpeg (x264, aac, opus), e.g. from https://www.gyan.dev/ffmpeg/builds/ or `npm i ffmpeg-static`.
 *
 *   FFMPEG=/path/to/ffmpeg node tools/promo-video/mix.mjs [outDir]
 *
 * Writes <outDir>/co-co-promo.mp4 (H.264 + AAC) and <outDir>/co-co-promo.webm (VP9 + Opus).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const OUT = resolve(process.argv[2] || join(repo, 'promo-out'))
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const { voiceDir, beats } = JSON.parse(readFileSync(join(OUT, 'timeline.json'), 'utf8'))
const video = join(OUT, 'co-co-promo.silent.webm')

const clips = beats.filter((b) => existsSync(join(voiceDir, `${b.id}.wav`)))
if (!clips.length) throw new Error(`no voice clips in ${voiceDir}`)
const inputs = ['-i', video]
for (const c of clips) inputs.push('-i', join(voiceDir, `${c.id}.wav`))
const delayed = clips.map((c, i) => `[${i + 1}:a]aresample=48000,adelay=delays=${Math.round(c.t * 1000)}:all=1[a${i}]`)
const filter = `${delayed.join(';')};${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,volume=${process.env.MIX_GAIN || 1},alimiter=limit=0.95,apad[voice]`

function run(args) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
}
const common = [...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[voice]']
run([...common, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', join(OUT, 'co-co-promo.mp4')])
run([...common, '-c:v', 'copy', '-c:a', 'libopus', '-b:a', '128k', '-shortest', join(OUT, 'co-co-promo.webm')])
console.log(`Mixed ${clips.length} clips -> ${join(OUT, 'co-co-promo.mp4')} and .webm`)
