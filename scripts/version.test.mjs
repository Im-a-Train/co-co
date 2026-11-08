// Run with: node --test scripts/version.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseOf, bumpBase, nextVersion, parseVersion } from './version.mjs'

test('nextVersion starts at 1 without tags', () => {
  assert.equal(nextVersion('0.1.0', 'alpha', []), '0.1.0-alpha.1')
})

test('nextVersion counts per base and channel, numerically', () => {
  const tags = ['v0.1.0-alpha.1', 'v0.1.0-alpha.9', 'v0.1.0-alpha.10', 'v0.0.9-alpha.40', 'v0.1.0-beta.3', 'v0.1.0-alpha.x', '']
  assert.equal(nextVersion('0.1.0', 'alpha', tags), '0.1.0-alpha.11')
  assert.equal(nextVersion('0.2.0', 'alpha', tags), '0.2.0-alpha.1')
  assert.equal(nextVersion('0.1.0', 'beta', tags), '0.1.0-beta.4')
})

test('bumpBase follows SemVer', () => {
  assert.equal(bumpBase('0.1.3', 'patch'), '0.1.4')
  assert.equal(bumpBase('0.1.3', 'minor'), '0.2.0')
  assert.equal(bumpBase('0.1.3', 'major'), '1.0.0')
  assert.throws(() => bumpBase('0.1.3', 'huge'))
})

test('parseVersion / baseOf', () => {
  assert.equal(baseOf('0.1.0-alpha.3'), '0.1.0')
  assert.equal(parseVersion('1.2.3-alpha.4').pre, 'alpha.4')
  assert.throws(() => parseVersion('1.2'))
  assert.throws(() => parseVersion('01.2.3'))
})
