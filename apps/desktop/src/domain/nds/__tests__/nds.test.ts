import { describe, expect, it } from 'vitest'
import type { CocoDb } from '../../storage/db'
import type { CoachInputs, NdsAggregate, NdsRecord } from '../../types'
import { makeCoachInputs, makeNds } from '../../rules/__tests__/factory'
import {
  adoptNdsFields,
  dropEditedNdsFields,
  ndsDatesDiffer,
  ndsFieldDiffs,
  ndsStateLabel,
  ndsSuggestions,
  participantsDiffer,
} from '../index'
import { clearNds, getNdsRecord, saveNdsAggregate, saveNdsLink } from '../store'

describe('ndsStateLabel', () => {
  it('maps known codes to German and keeps unknown codes raw', () => {
    expect(ndsStateLabel('PAYED_CH')).toBe('Ausbezahlt')
    expect(ndsStateLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(ndsStateLabel(null)).toBe('')
  })
})

describe('ndsSuggestions', () => {
  it('suggests registered + date from approvedOn', () => {
    expect(ndsSuggestions(makeNds({ approvedOn: '2031-05-20' }))).toEqual({ ndsRegistered: true, ndsRegisteredOn: '2031-05-20' })
  })
  it('suggests closed only for known closed states', () => {
    for (const s of ['WAITING_FOR_ASSESSMENT', 'PAYED_CH', 'PARTIALLY_PAYED']) {
      expect(ndsSuggestions(makeNds({ offerState: s }))).toEqual({ ndsClosed: true })
      expect(ndsSuggestions(makeNds({ offerItemState: s }))).toEqual({ ndsClosed: true })
    }
    expect(ndsSuggestions(makeNds({ offerState: 'UNFINISHED_BY_BATCH', offerItemState: 'WHATEVER' }))).toEqual({})
    expect(ndsSuggestions(makeNds())).toEqual({})
  })
})

describe('ndsFieldDiffs / adoptNdsFields', () => {
  const agg = makeNds({ approvedOn: '2031-05-20', offerState: 'PAYED_CH' })
  it('lists only suggested fields with same/fromNds flags', () => {
    const inputs = makeCoachInputs({ ndsRegistered: true, ndsFields: { ndsRegistered: 't' } })
    const d = ndsFieldDiffs(agg, inputs)
    expect(d.map((x) => x.field)).toEqual(['ndsRegistered', 'ndsRegisteredOn', 'ndsClosed'])
    expect(d[0]).toMatchObject({ same: true, fromNds: true })
    expect(d[1]).toMatchObject({ ndsValue: '2031-05-20', currentValue: null, same: false, fromNds: false })
    expect(ndsFieldDiffs(makeNds(), null)).toEqual([])
    expect(ndsFieldDiffs(agg, null)[0].currentValue).toBeNull()
  })
  it('adopts accepted fields with badge = fetchedAt, leaves others', () => {
    const out = adoptNdsFields(makeCoachInputs(), agg, ['ndsRegistered', 'ndsRegisteredOn'], 'now')
    expect(out).toMatchObject({ ndsRegistered: true, ndsRegisteredOn: '2031-05-20', ndsClosed: false })
    expect(out.ndsFields).toEqual({ ndsRegistered: agg.fetchedAt, ndsRegisteredOn: agg.fetchedAt })
    // no suggestion -> skipped
    const none = adoptNdsFields(makeCoachInputs(), makeNds(), ['ndsClosed'], 'now')
    expect(none.ndsClosed).toBe(false)
    expect(none.ndsFields).toEqual({})
  })
})

describe('dropEditedNdsFields', () => {
  const prev: CoachInputs = makeCoachInputs({ ndsRegistered: true, ndsRegisteredOn: '2031-05-20', ndsFields: { ndsRegistered: 't', ndsRegisteredOn: 't' } })
  it('returns next unchanged without badges', () => {
    const next = makeCoachInputs()
    expect(dropEditedNdsFields(prev, next)).toBe(next)
  })
  it('drops only the edited field badge', () => {
    const next = { ...prev, ndsRegisteredOn: '2031-05-25' }
    expect(dropEditedNdsFields(prev, next).ndsFields).toEqual({ ndsRegistered: 't' })
  })
  it('keeps all badges when nothing changed, drops all without prev', () => {
    expect(dropEditedNdsFields(prev, { ...prev }).ndsFields).toEqual(prev.ndsFields)
    expect(dropEditedNdsFields(null, { ...prev }).ndsFields).toEqual(prev.ndsFields)
    const flipped = { ...prev, ndsRegistered: false, ndsRegisteredOn: null }
    expect(dropEditedNdsFields(prev, flipped).ndsFields).toEqual({})
  })
})

describe('comparison helpers', () => {
  it('ndsDatesDiffer ignores missing dates', () => {
    const a = makeNds()
    expect(ndsDatesDiffer(a, '2031-07-12', '2031-07-16')).toBe(false)
    expect(ndsDatesDiffer(a, '2031-07-12T00:00:00', '2031-07-17')).toBe(true)
    expect(ndsDatesDiffer({ ...a, start: null }, '2031-07-12', '2031-07-16')).toBe(false)
    expect(ndsDatesDiffer(a, null, null)).toBe(false)
  })
  it('participantsDiffer uses a 20 % threshold on the larger value', () => {
    expect(participantsDiffer(20, 25)).toBe(false) // exactly 20 %
    expect(participantsDiffer(20, 26)).toBe(true)
    expect(participantsDiffer(null, 20)).toBe(false)
    expect(participantsDiffer(0, 20)).toBe(false)
  })
})

describe('nds store', () => {
  function fakeDb(): CocoDb {
    const rows = new Map<string, NdsRecord>()
    return {
      nds: {
        get: async (k: string) => rows.get(k),
        put: async (r: NdsRecord) => void rows.set(r.campIri, r),
        delete: async (k: string) => void rows.delete(k),
      },
    } as unknown as CocoDb
  }
  const CAMP = '/api/camps/1'
  const agg = (camp: string): NdsAggregate => makeNds({ campBusinessId: camp, offerBusinessId: 'o1' })

  it('returns null when nothing stored', async () => expect(await getNdsRecord(CAMP, fakeDb())).toBeNull())

  it('saves a link tagged red-derived and keeps the aggregate only for the same link', async () => {
    const db = fakeDb()
    const r = await saveNdsLink(CAMP, { offerBusinessId: 'o1', campBusinessId: 'c1' }, db)
    expect(r).toMatchObject({ zone: 'red-derived', link: { offerBusinessId: 'o1', campBusinessId: 'c1' }, aggregate: null, fetchedAt: null })
    await saveNdsAggregate(CAMP, agg('c1'), db)
    expect((await saveNdsLink(CAMP, { offerBusinessId: 'o1', campBusinessId: 'c1' }, db)).aggregate).not.toBeNull()
    const other = await saveNdsLink(CAMP, { offerBusinessId: 'o1', campBusinessId: 'c2' }, db)
    expect(other.aggregate).toBeNull()
    expect(other.fetchedAt).toBeNull()
  })

  it('saves an aggregate (creating the link) and rejects one of another camp', async () => {
    const db = fakeDb()
    const rec = await saveNdsAggregate(CAMP, agg('c1'), db)
    expect(rec).toMatchObject({ zone: 'red-derived', link: { offerBusinessId: 'o1', campBusinessId: 'c1' }, fetchedAt: agg('c1').fetchedAt })
    await expect(saveNdsAggregate(CAMP, agg('c9'), db)).rejects.toThrow(/anderen Lager/)
  })

  it('clears', async () => {
    const db = fakeDb()
    await saveNdsAggregate(CAMP, agg('c1'), db)
    await clearNds(CAMP, db)
    expect(await getNdsRecord(CAMP, db)).toBeNull()
  })
})
