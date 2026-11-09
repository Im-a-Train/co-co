import { describe, expect, it } from 'vitest'
import { TABLE_NAMES } from '../../storage/db'
import {
  BackupError,
  exportFileName,
  exportFromStore,
  importIntoStore,
  parseExport,
  summarizeExport,
  validateExport,
  type BackupStore,
  type BackupTable,
} from '../index'

/** In-memory table keyed by pk field (aiLog: auto-increment). */
function memTable(pk: string): BackupTable {
  const rows = new Map<unknown, unknown>()
  let auto = 1
  return {
    toArray: async () => [...rows.values()],
    clear: async () => void rows.clear(),
    bulkPut: async (rs) => {
      for (const r of rs) rows.set((r as Record<string, unknown>)[pk], r)
    },
    bulkAdd: async (rs) => {
      for (const r of rs) {
        const row = { ...(r as object) } as Record<string, unknown>
        if (row[pk] === undefined) row[pk] = auto++
        rows.set(row[pk], row)
      }
    },
    keys: async () => [...rows.keys()],
  }
}
const PK: Record<string, string> = {
  settings: 'key',
  coachInputs: 'campIri',
  mappings: 'campIri',
  overrides: 'id',
  campSummaries: 'campIri',
  feedback: 'id',
  reviews: 'campIri',
  rounds: 'id',
  snapshots: 'id',
  documents: 'id',
  watchedFolders: 'id',
  aiLog: 'id',
  midata: 'campIri',
  nds: 'campIri',
  selfChecks: 'id',
  campRuleConfig: 'campIri',
}
function makeStore(): BackupStore {
  return Object.fromEntries(TABLE_NAMES.map((n) => [n, memTable(PK[n]!)]))
}

describe('backup', () => {
  it('exports every table with header', async () => {
    const s = makeStore()
    await s.feedback!.bulkPut([{ id: 'f1', text: 'x' }])
    const ex = await exportFromStore(s, new Date('2026-11-07T10:00:00Z'))
    expect(ex).toMatchObject({ format: 'co-co-export', version: 1, exportedAt: '2026-11-07T10:00:00.000Z' })
    expect(Object.keys(ex.tables).sort()).toEqual([...TABLE_NAMES].sort())
    expect(ex.tables.feedback).toEqual([{ id: 'f1', text: 'x' }])
  })

  it('roundtrips through JSON (replace)', async () => {
    const a = makeStore()
    await a.settings!.bulkPut([{ key: 'app', value: { ai: { enabled: false }, backup: { lastExportAt: null } } }])
    await a.reviews!.bulkPut([{ campIri: '/api/camps/1', status: 'in_review', history: [], updatedAt: 'x' }])
    await a.snapshots!.bulkPut([{ id: 's', campIri: '/api/camps/1', roundId: 'r', entities: {}, facts: { t: 'äöü' } }])
    await a.aiLog!.bulkAdd([{ at: 't', feature: 'rephrase' }])
    const text = JSON.stringify(await exportFromStore(a))
    const b = makeStore()
    await b.feedback!.bulkPut([{ id: 'old' }])
    const rep = await importIntoStore(b, parseExport(text), 'replace')
    expect(rep.written.reviews).toBe(1)
    expect(await b.feedback!.toArray()).toEqual([])
    for (const n of TABLE_NAMES) expect(await b[n]!.toArray()).toEqual(await a[n]!.toArray())
  })

  it('roundtrips campRuleConfig (rules v2) through JSON', async () => {
    const a = makeStore()
    const cfg = {
      campIri: '/api/camps/1',
      zone: 'green',
      sport: 'lst',
      modules: { 'lst-berg': 'on' },
      activityTags: { '/api/activities/a1': ['sb-berg'] },
      sbApprovals: { camp: { approvedOn: '2031-06-01', kind: 'experte' } },
      camp: { region: 'alpen', campForm: 'zelt', winterSafeAccess: null, abroad: false },
      angebot: { other4DayCamp: null, unternehmungElsewhere: null, efCoveredElsewhere: null, lastActivityDate: null },
      params: { 'lst.treelineM': 1900 },
      checklist: { 'CL-1': { done: true, at: '2031-06-01T10:00:00.000Z' } },
      updatedAt: '2031-06-01T10:00:00.000Z',
    }
    await a.campRuleConfig!.bulkPut([cfg])
    const b = makeStore()
    const rep = await importIntoStore(b, parseExport(JSON.stringify(await exportFromStore(a))), 'replace')
    expect(rep.written.campRuleConfig).toBe(1)
    expect(await b.campRuleConfig!.toArray()).toEqual([cfg])
  })

  it('merge keeps local settings and existing rows, adds new ones, appends aiLog', async () => {
    const src = makeStore()
    await src.settings!.bulkPut([
      { key: 'app', value: 'remote' },
      { key: 'other', value: 1 },
    ])
    await src.feedback!.bulkPut([
      { id: 'f1', text: 'remote' },
      { id: 'f2', text: 'new' },
    ])
    await src.aiLog!.bulkAdd([{ at: 'remote' }])
    const data = parseExport(JSON.stringify(await exportFromStore(src)))
    const dst = makeStore()
    await dst.settings!.bulkPut([{ key: 'app', value: 'local' }])
    await dst.feedback!.bulkPut([{ id: 'f0', text: 'local' }])
    await dst.aiLog!.bulkAdd([{ at: 'local' }])
    const rep = await importIntoStore(dst, data, 'merge')
    expect((await dst.settings!.toArray()).find((r) => (r as { key: string }).key === 'app')).toMatchObject({ value: 'local' })
    expect(rep.written.settings).toBe(1)
    expect(await dst.feedback!.toArray()).toHaveLength(3)
    expect(await dst.aiLog!.toArray()).toHaveLength(2)
  })

  it('skips unknown tables and reports them', async () => {
    const data = validateExport({
      format: 'co-co-export',
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      tables: { feedback: [], future: [{ a: 1 }] },
    })
    const rep = await importIntoStore(makeStore(), data, 'replace')
    expect(rep.skippedTables).toEqual(['future'])
    expect(summarizeExport(data).unknownTables).toEqual(['future'])
  })

  const base = { format: 'co-co-export', version: 1, exportedAt: '2026-01-01T00:00:00Z', tables: {} }
  it('validation rejects bad input with codes', () => {
    const code = (f: () => unknown) => {
      try {
        f()
      } catch (e) {
        return (e as BackupError).code
      }
      return null
    }
    expect(code(() => parseExport('{nope'))).toBe('notJson')
    expect(code(() => validateExport(null))).toBe('notCoco')
    expect(code(() => validateExport({ ...base, format: 'x' }))).toBe('notCoco')
    expect(code(() => validateExport({ ...base, version: 99 }))).toBe('tooNew')
    expect(code(() => validateExport({ ...base, exportedAt: 'gestern' }))).toBe('notCoco')
    expect(code(() => validateExport({ ...base, tables: [] }))).toBe('badTables')
    expect(code(() => validateExport({ ...base, tables: { feedback: {} } }))).toBe('badTables')
    expect(code(() => validateExport({ ...base, tables: { feedback: [1] } }))).toBe('badRecord')
    expect(code(() => validateExport({ ...base, tables: { reviews: [{ status: 'neu' }] } }))).toBe('badRecord')
    expect(code(() => validateExport({ ...base, tables: { aiLog: [{ at: 'x' }] } }))).toBeNull()
  })

  it('omitRedDerived leaves out the midata table, default keeps it', async () => {
    const s = makeStore()
    await s.midata!.bulkPut([{ campIri: '/api/camps/1', zone: 'red-derived' }])
    await s.nds!.bulkPut([{ campIri: '/api/camps/1', zone: 'red-derived' }])
    const all = await exportFromStore(s)
    expect(all.tables.midata).toHaveLength(1)
    expect(all.tables.nds).toHaveLength(1)
    const lean = await exportFromStore(s, new Date(), { omitRedDerived: true })
    expect('midata' in lean.tables).toBe(false)
    expect('nds' in lean.tables).toBe(false)
    expect(Object.keys(lean.tables).sort()).toEqual(TABLE_NAMES.filter((n) => n !== 'midata' && n !== 'nds').sort())
  })

  it('replace-import of an export without the midata table (v1 / omitted) empties local midata; merge keeps it', async () => {
    const dst = makeStore()
    await dst.midata!.bulkPut([{ campIri: '/api/camps/9', zone: 'red-derived' }])
    const data = validateExport({
      format: 'co-co-export',
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      tables: { feedback: [{ id: 'f' }] },
    })
    const rep = await importIntoStore(dst, data, 'replace')
    expect(rep.written.midata).toBe(0)
    expect(await dst.midata!.toArray()).toHaveLength(0)
    await dst.midata!.bulkPut([{ campIri: '/api/camps/9', zone: 'red-derived' }])
    await importIntoStore(dst, data, 'merge')
    expect(await dst.midata!.toArray()).toHaveLength(1)
  })

  it('omitRedDerived strips values adopted from MiData from coachInputs', async () => {
    const s = makeStore()
    await s.coachInputs!.bulkPut([
      { campIri: '/c/1', participantsCount: 12, minAge: 9, leadersCount: 4, midataFields: { participantsCount: 'x', minAge: 'x' } },
    ])
    const lean = await exportFromStore(s, new Date(), { omitRedDerived: true })
    const row = lean.tables.coachInputs[0] as Record<string, unknown>
    expect(row.participantsCount).toBeNull()
    expect(row.minAge).toBeNull()
    expect(row.leadersCount).toBe(4)
    expect('midataFields' in row).toBe(false)
  })

  it('omitRedDerived strips values adopted from NDS from coachInputs', async () => {
    const s = makeStore()
    await s.coachInputs!.bulkPut([
      { campIri: '/c/1', ndsRegistered: true, ndsRegisteredOn: '2031-05-01', ndsClosed: true, ndsClosedOn: '2031-09-01', ndsFields: { ndsRegistered: 'x', ndsRegisteredOn: 'x' } },
    ])
    const lean = await exportFromStore(s, new Date(), { omitRedDerived: true })
    const row = lean.tables.coachInputs[0] as Record<string, unknown>
    expect(row.ndsRegistered).toBe(false)
    expect(row.ndsRegisteredOn).toBeNull()
    expect(row.ndsClosed).toBe(true)
    expect('ndsFields' in row).toBe(false)
  })

  it('omitRedDerived strips red-derived findings from selfChecks, default keeps them', async () => {
    const s = makeStore()
    const f = (id: string, redDerived: boolean) => ({ id, ruleId: 'r', severity: 'must', title: 't', message: 'm', targets: [], redDerived })
    await s.selfChecks!.bulkPut([{ id: 'sc1', campIri: '/c/1', createdAt: 'x', findings: [f('a', false), f('b', true)] }])
    const all = await exportFromStore(s)
    expect((all.tables.selfChecks![0] as { findings: unknown[] }).findings).toHaveLength(2)
    const lean = await exportFromStore(s, new Date(), { omitRedDerived: true })
    const row = lean.tables.selfChecks![0] as { id: string; findings: Array<{ id: string }> }
    expect(row.id).toBe('sc1')
    expect(row.findings.map((x) => x.id)).toEqual(['a'])
  })

  it('imports an export that contains midata', async () => {
    const src = makeStore()
    await src.midata!.bulkPut([{ campIri: '/api/camps/1', zone: 'red-derived' }])
    await src.nds!.bulkPut([{ campIri: '/api/camps/1', zone: 'red-derived' }])
    const dst = makeStore()
    const rep = await importIntoStore(dst, parseExport(JSON.stringify(await exportFromStore(src))), 'merge')
    expect(rep.written.midata).toBe(1)
    expect(rep.written.nds).toBe(1)
  })

  it('exportFileName uses local date', () => {
    expect(exportFileName(new Date(2026, 10, 7))).toBe('co-co-backup-2026-11-07.json')
  })

  it('import never enables AI or loosens document zones', async () => {
    const src = makeStore()
    await src.settings!.bulkPut([{ key: 'app', value: { ai: { enabled: true } } }])
    await src.documents!.bulkPut([{ id: 'd', zone: 'green', aiAllowed: true }])
    const dst = makeStore()
    await importIntoStore(dst, parseExport(JSON.stringify(await exportFromStore(src))), 'replace')
    expect(((await dst.settings!.toArray())[0] as any).value.ai.enabled).toBe(false)
    expect(await dst.documents!.toArray()).toEqual([{ id: 'd', zone: 'yellow', aiAllowed: false }])
  })

  it('import switches the MCP server off', async () => {
    const src = makeStore()
    await src.settings!.bulkPut([{ key: 'app', value: { ai: { enabled: true }, mcp: { enabled: true, port: 41731 } } }])
    const dst = makeStore()
    await importIntoStore(dst, parseExport(JSON.stringify(await exportFromStore(src))), 'replace')
    const value = ((await dst.settings!.toArray())[0] as any).value
    expect(value.mcp.enabled).toBe(false)
    expect(value.mcp.port).toBe(41731)
  })
})
