// Run with: node --test scripts/updater-manifest.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildManifest, installerUrl } from './updater-manifest.mjs'

test('installerUrl points at the release asset of the tag', () => {
  assert.equal(
    installerUrl('0.1.0-alpha.15'),
    'https://github.com/Im-a-Train/co-co/releases/download/v0.1.0-alpha.15/co-co_0.1.0-alpha.15_x64-setup.exe',
  )
})

test('buildManifest has the Tauri static shape', () => {
  const m = buildManifest({ version: '0.1.0-alpha.15', notes: ' hi \n', pubDate: '2026-11-20T10:00:00Z', signature: 'SIG\n' })
  assert.equal(m.version, '0.1.0-alpha.15')
  assert.equal(m.notes, 'hi')
  assert.equal(m.pub_date, '2026-11-20T10:00:00.000Z')
  assert.deepEqual(Object.keys(m.platforms), ['windows-x86_64'])
  assert.equal(m.platforms['windows-x86_64'].signature, 'SIG')
  assert.match(m.platforms['windows-x86_64'].url, /^https:\/\/github\.com\/Im-a-Train\/co-co\/releases\/download\/v0\.1\.0-alpha\.15\//)
})

test('buildManifest rejects bad input', () => {
  const ok = { version: '0.1.0', pubDate: '2026-01-01T00:00:00Z', signature: 'x' }
  assert.throws(() => buildManifest({ ...ok, version: 'v0.1.0' }))
  assert.throws(() => buildManifest({ ...ok, version: '0.1.0/../x' }))
  assert.throws(() => buildManifest({ ...ok, signature: '  ' }))
  assert.throws(() => buildManifest({ ...ok, pubDate: 'nope' }))
})
