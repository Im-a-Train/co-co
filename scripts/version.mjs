#!/usr/bin/env node
// co-co versioning (see docs/adr/0008-versioning-and-releases.md).
//
// The repo holds the *base* version (MAJOR.MINOR.PATCH) in every manifest; they must agree.
// Every push to main gets a release version `<base>-<channel>.<n>` (e.g. 0.1.0-alpha.7), where the
// channel comes from `releaseChannel` in the root package.json and n counts up per base version.
// CI stamps that version into the manifests of its working copy only; nothing is committed back.
//
// Usage:
//   node scripts/version.mjs check              all manifests carry the same base version
//   node scripts/version.mjs current            print the base version
//   node scripts/version.mjs next [tags...]     print the next release version (tags default to `git tag`)
//   node scripts/version.mjs set <version>      write <version> into all manifests (CI stamping)
//   node scripts/version.mjs bump <major|minor|patch>   raise the base version (commit it via a PR)

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/

export function parseVersion(v) {
  const m = SEMVER.exec(v)
  if (!m) throw new Error(`Not a SemVer version (without build metadata): ${v}`)
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? '' }
}

export function baseOf(v) {
  const { major, minor, patch } = parseVersion(v)
  return `${major}.${minor}.${patch}`
}

/** Next release version for `base` on `channel`, given the existing git tags. */
export function nextVersion(base, channel, tags) {
  if (!/^[a-z]+$/.test(channel)) throw new Error(`Invalid release channel: ${channel}`)
  const prefix = `v${base}-${channel}.`
  let max = 0
  for (const tag of tags) {
    if (!tag.startsWith(prefix)) continue
    const n = tag.slice(prefix.length)
    if (/^(0|[1-9]\d*)$/.test(n)) max = Math.max(max, Number(n))
  }
  return `${base}-${channel}.${max + 1}`
}

export function bumpBase(base, part) {
  const { major, minor, patch } = parseVersion(base)
  if (part === 'major') return `${major + 1}.0.0`
  if (part === 'minor') return `${major}.${minor + 1}.0`
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown bump: ${part} (expected major, minor or patch)`)
}

// ---- manifests -------------------------------------------------------------------------------

const JSON_FILES = ['package.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json']
const CARGO_TOML = 'apps/desktop/src-tauri/Cargo.toml'
const CARGO_LOCK = 'apps/desktop/src-tauri/Cargo.lock'
const PACKAGE_LOCK = 'package-lock.json'
const CRATE = 'co-co'

const read = (f) => readFileSync(join(ROOT, f), 'utf8')
const write = (f, s) => writeFileSync(join(ROOT, f), s)

// Replace only the first top-level "version" so dependency versions stay untouched.
const setJsonVersion = (src, v) => src.replace(/^(\s{2}"version":\s*")[^"]*(")/m, `$1${v}$2`)
const setCargoTomlVersion = (src, v) =>
  src.replace(/(\[package\][^[]*?\nversion\s*=\s*")[^"]*(")/, `$1${v}$2`)
const setCargoLockVersion = (src, v) =>
  src.replace(new RegExp(`(\\[\\[package\\]\\]\\nname = "${CRATE}"\\nversion = ")[^"]*(")`), `$1${v}$2`)

export function readVersions() {
  const out = {}
  for (const f of JSON_FILES) out[f] = JSON.parse(read(f)).version
  out[CARGO_TOML] = /\[package\][^[]*?\nversion\s*=\s*"([^"]*)"/.exec(read(CARGO_TOML))?.[1]
  return out
}

function setAll(v) {
  parseVersion(v)
  for (const f of JSON_FILES) write(f, setJsonVersion(read(f), v))
  write(CARGO_TOML, setCargoTomlVersion(read(CARGO_TOML), v))
  write(CARGO_LOCK, setCargoLockVersion(read(CARGO_LOCK), v))
  // package-lock.json: root package and the apps/desktop workspace entry.
  const lock = JSON.parse(read(PACKAGE_LOCK))
  lock.version = v
  if (lock.packages?.['']) lock.packages[''].version = v
  if (lock.packages?.['apps/desktop']) lock.packages['apps/desktop'].version = v
  write(PACKAGE_LOCK, JSON.stringify(lock, null, 2) + '\n')
  const after = readVersions()
  const wrong = Object.entries(after).filter(([, x]) => x !== v)
  if (wrong.length) throw new Error(`Failed to set version in: ${wrong.map(([f]) => f).join(', ')}`)
}

function current() {
  const versions = readVersions()
  const distinct = [...new Set(Object.values(versions))]
  if (distinct.length !== 1) {
    throw new Error(
      `Manifest versions disagree:\n${Object.entries(versions)
        .map(([f, v]) => `  ${f}: ${v}`)
        .join('\n')}`,
    )
  }
  return distinct[0]
}

function main([cmd, ...args]) {
  switch (cmd) {
    case 'check': {
      const v = current()
      if (parseVersion(v).pre) throw new Error(`Committed version must be a plain base version, got ${v}`)
      console.log(`ok ${v}`)
      return
    }
    case 'current':
      console.log(baseOf(current()))
      return
    case 'next': {
      const channel = JSON.parse(read('package.json')).releaseChannel
      if (!channel) throw new Error('Root package.json has no "releaseChannel"')
      const tags = args.length
        ? args
        : execFileSync('git', ['tag', '--list', 'v*'], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/)
      console.log(nextVersion(baseOf(current()), channel, tags))
      return
    }
    case 'set':
      if (!args[0]) throw new Error('Usage: set <version>')
      setAll(args[0])
      console.log(`set ${args[0]}`)
      return
    case 'bump': {
      const v = bumpBase(baseOf(current()), args[0])
      setAll(v)
      console.log(`bumped to ${v}`)
      return
    }
    default:
      console.error('Usage: node scripts/version.mjs <check|current|next|set|bump> [...]')
      process.exit(2)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
