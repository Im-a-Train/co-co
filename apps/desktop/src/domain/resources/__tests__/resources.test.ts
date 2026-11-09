import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyResourcePatch, bundledResources, highlightSegments, mergeRegistry, searchResources, validateResource, wordCount } from '../index'
import { addResource, getResource, listResources, onResourcesChanged, resetResource, updateResource } from '../store'
import { bundledSourceRecords, getSourceRegistry, setRegistryOverlay } from '../../rules/packs/registry'
import { getDb, lockDb, resetLocalData } from '../../storage/db'
import { unlockTestDb } from '../../storage/__tests__/testKey'
import type { ResourceRecord } from '../../types'

const NOW = '2026-11-09T10:00:00.000Z'

describe('bundledResources', () => {
  it('has one record per sources.yaml entry', () => {
    const b = bundledResources(NOW)
    expect(b).toHaveLength(bundledSourceRecords().length)
    expect(b.length).toBeGreaterThanOrEqual(23)
    expect(b.every((r) => r.origin === 'bundled' && !r.modified && r.updatedAt === NOW)).toBe(true)
  })
})

describe('applyResourcePatch / validateResource', () => {
  const base = bundledResources(NOW)[0]!
  it('keeps history (max 10, no content) and marks modified', () => {
    let r: ResourceRecord = { ...base, content: 'abc' }
    for (let i = 0; i < 12; i++) r = applyResourcePatch(r, { title: `T${i}` }, 'manual', NOW)
    expect(r.title).toBe('T11')
    expect(r.modified).toBe(true)
    expect(r.history).toHaveLength(10)
    expect(r.history![0]!.title).toBe('T10')
    expect('content' in r.history![0]!).toBe(false)
    expect(r.content).toBe('abc')
  })
  it('validates', () => {
    expect(validateResource({ key: 'ABC-1', title: 'x', url: 'https://a.ch' })).toEqual([])
    expect(validateResource({ key: 'abc' })).toHaveLength(1)
    expect(validateResource({ url: 'javascript:alert(1)' })).toHaveLength(1)
    expect(validateResource({ title: '  ' })).toHaveLength(1)
    expect(validateResource({ checkedOn: '9.11.2026' })).toHaveLength(1)
  })
})

describe('mergeRegistry', () => {
  it('stored wins, custom added, formerKeys kept', () => {
    const bundled = bundledSourceRecords()
    const withFormer = bundled.find((b) => b.formerKeys?.length)
    const stored: ResourceRecord[] = [
      { ...bundledResources(NOW)[0]!, title: 'Neu', content: 'x' },
      { key: 'EIGEN', title: 'Eigen', edition: '', url: null, weight: 'info', pageConvention: 'section', partlyRead: [], origin: 'custom', modified: false, updatedAt: NOW, updatedBy: 'manual' },
    ]
    const merged = mergeRegistry(bundled, stored)
    expect(merged).toHaveLength(bundled.length + 1)
    expect(merged.find((r) => r.key === bundled[0]!.key)!.title).toBe('Neu')
    expect('content' in merged[0]!).toBe(false)
    expect(merged.some((r) => r.key === 'EIGEN')).toBe(true)
    if (withFormer) setRegistryOverlay(merged)
    if (withFormer) expect(getSourceRegistry().get(withFormer.formerKeys![0]!)?.key).toBe(withFormer.key)
    setRegistryOverlay(null)
  })
})

describe('searchResources', () => {
  const mk = (key: string, p: Partial<ResourceRecord>): ResourceRecord => ({
    key, title: key, edition: '', url: null, weight: 'info', pageConvention: 'section', partlyRead: [], origin: 'custom', modified: false, updatedAt: NOW, updatedBy: 'manual', ...p,
  })
  const recs = [
    mk('A', { title: 'Wasseraktivitäten Merkblatt', content: 'irgendwas' }),
    mk('B', { title: 'Allgemein', content: 'Beim Baden im See muss eine Aufsichtsperson dabei sein. Wasser ist kalt.' }),
    mk('C', { title: 'Nichts' }),
  ]
  it('ranks meta above content, case/umlaut-insensitive', () => {
    const h = searchResources(recs, 'WASSER')
    expect(h.map((x) => x.key)).toEqual(['A', 'B'])
    expect(h[0]!.in).toBe('meta')
    expect(h[1]!.in).toBe('content')
    expect(h[1]!.snippet).toContain('Wasser')
  })
  it('ANDs words and folds umlauts', () => {
    expect(searchResources(recs, 'aufsichtsperson baden').map((x) => x.key)).toEqual(['B'])
    expect(searchResources(recs, 'aufsichtsperson velo')).toEqual([])
    expect(searchResources(recs, 'wasseraktivitaten')[0]!.key).toBe('A')
    expect(searchResources(recs, '')).toEqual([])
  })
  it('respects limit', () => {
    expect(searchResources(recs, 'wasser', { limit: 1 })).toHaveLength(1)
  })
})

describe('highlightSegments', () => {
  it('marks matches case/umlaut-insensitively', () => {
    expect(highlightSegments('Die Aufsicht über Wasser', 'ueber aufsicht').filter((s) => s.hit).map((s) => s.text)).toEqual(['Aufsicht'])
    expect(highlightSegments('Über uns', 'uber')[0]).toEqual({ text: 'Über', hit: true })
    expect(highlightSegments('abc', '')).toEqual([{ text: 'abc', hit: false }])
    expect(wordCount(' a  b\nc ')).toBe(3)
  })
})

describe('store', () => {
  const OPTS = { dbName: 'coco2-res-test', legacyDbName: 'coco-res-test' }
  beforeEach(async () => {
    await resetLocalData(OPTS)
    await unlockTestDb(OPTS)
  })
  afterEach(async () => {
    await lockDb()
  })

  it('seeds lazily, keeps modified records, notifies on writes', async () => {
    let n = 0
    const off = onResourcesChanged(() => n++)
    const all = await listResources()
    expect(all).toHaveLength(bundledSourceRecords().length)
    const key = all[0]!.key
    await updateResource(key, { title: 'Mein Titel', content: 'Inhalt' }, 'manual')
    expect((await listResources()).find((r) => r.key === key)!.title).toBe('Mein Titel')
    expect(n).toBe(1)
    await resetResource(key)
    const back = (await getResource(key))!
    expect(back.modified).toBe(false)
    expect(back.content).toBeUndefined()
    off()
  })

  it('refreshes an unmodified bundled record whose yaml changed', async () => {
    const key = (await listResources())[0]!.key
    const rec = (await getResource(key))!
    await getDb().resources.put({ ...rec, title: 'Alt' })
    expect((await getResource(key))!.title).toBe(bundledSourceRecords().find((s) => s.key === key)!.title)
  })

  it('adds custom, rejects duplicates, refuses deletion while a rule edit cites it', async () => {
    await expect(addResource({ key: 'bad key', title: 'x' }, 'manual')).rejects.toThrow()
    await addResource({ key: 'EIGEN-1', title: 'Eigenes', url: 'https://example.ch' }, 'manual')
    await expect(addResource({ key: 'EIGEN-1', title: 'Doppelt' }, 'manual')).rejects.toThrow(/existiert/)
    await getDb().ruleEdits.put({ ruleId: 'R1', baseVersion: '1', patch: { sources: [{ key: 'EIGEN-1', page: '' }] }, updatedAt: NOW, updatedBy: 'manual' })
    await expect(resetResource('EIGEN-1')).rejects.toThrow(/zitiert/)
    await getDb().ruleEdits.delete('R1')
    await resetResource('EIGEN-1')
    expect(await getResource('EIGEN-1')).toBeUndefined()
  })
})
