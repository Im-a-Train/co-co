#!/usr/bin/env node
// Builds the Tauri updater manifest `latest.json` (ADR 0017).
//
// Usage:
//   node scripts/updater-manifest.mjs --version <v> --sig <setup.exe.sig> --out <latest.json> [--notes <text>] [--notes-file <file>] [--date <RFC3339>]
//
// The setup.exe URL is derived from the version: the GitHub release asset of tag v<version>.
// Exit code 2 when the signature file is missing (caller skips the step with a warning).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = 'Im-a-Train/co-co'
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function installerUrl(version) {
  return `https://github.com/${REPO}/releases/download/v${version}/co-co_${version}_x64-setup.exe`
}

/** Pure: builds the manifest object. `signature` is the CONTENT of the .sig file. */
export function buildManifest({ version, notes = '', pubDate, signature }) {
  if (!SEMVER.test(version)) throw new Error(`Not a SemVer version: ${version}`)
  const sig = String(signature ?? '').trim()
  if (!sig) throw new Error('Empty signature')
  const date = new Date(pubDate)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid pub_date: ${pubDate}`)
  return {
    version,
    notes: String(notes).trim(),
    pub_date: date.toISOString(),
    platforms: {
      'windows-x86_64': { signature: sig, url: installerUrl(version) },
    },
  }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`)
    out[argv[i].slice(2)] = argv[i + 1]
  }
  return out
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.version || !a.sig || !a.out) throw new Error('Required: --version --sig --out')
  if (!existsSync(a.sig)) {
    console.error(`Signature file not found: ${a.sig}`)
    process.exit(2)
  }
  const notes = a['notes-file'] ? readFileSync(a['notes-file'], 'utf8') : (a.notes ?? '')
  const manifest = buildManifest({
    version: a.version,
    notes,
    pubDate: a.date ?? new Date().toISOString(),
    signature: readFileSync(a.sig, 'utf8'),
  })
  writeFileSync(a.out, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Wrote ${a.out} for ${manifest.version}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
