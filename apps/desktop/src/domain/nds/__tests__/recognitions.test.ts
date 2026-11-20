import { describe, expect, it } from 'vitest'
import type { NdsRecognition, NdsRecognitionsResult } from '../../types'
import { isRecognitionInactive, ndsRecognitionsToDeadlines } from '../recognitions'

const rec = (over: Partial<NdsRecognition>): NdsRecognition => ({
  businessId: 'r1',
  title: 'J+S-Coach',
  educationField: null,
  state: 'VALID',
  validFrom: null,
  validUntil: '2027-03-31',
  omittedSince: null,
  invalidSince: null,
  archivedSince: null,
  targetAudienceGroup: null,
  sport: null,
  supplements: [],
  ...over,
})
const res = (recognitions: NdsRecognition[]): NdsRecognitionsResult => ({ recognitions, personSupplements: [], failedFields: [], fetchedAt: 'x' })
const labels = { expires: (t: string) => `${t}: läuft ab`, omitted: (t: string, s: string | null) => `${t}: sistiert ${s ?? ''}` }

describe('ndsRecognitionsToDeadlines', () => {
  it('builds sorted deadlines and skips inactive / undated ones', () => {
    const d = ndsRecognitionsToDeadlines(
      res([
        rec({ businessId: 'b', validUntil: '2028-01-01' }),
        rec({ businessId: 'a', validUntil: '2027-03-31' }),
        rec({ businessId: 'c', archivedSince: '2025-01-01' }),
        rec({ businessId: 'd', invalidSince: '2025-01-01' }),
        rec({ businessId: 'e', state: 'INVALID' }),
        rec({ businessId: 'f', validUntil: null }),
      ]),
      labels,
    )
    expect(d.map((x) => x.campIri)).toEqual(['nds:recognition:a', 'nds:recognition:b'])
    expect(d[0]).toEqual({
      campIri: 'nds:recognition:a',
      campTitle: 'NDS',
      kind: 'nds-recognition',
      due: '2027-03-31',
      done: false,
      ruleId: null,
      source: null,
      title: 'J+S-Coach: läuft ab',
      audience: 'coach',
    })
  })
  it('uses the omitted label for OMITTED or omittedSince', () => {
    const d = ndsRecognitionsToDeadlines(res([rec({ state: 'OMITTED', omittedSince: '2026-05-01' }), rec({ businessId: 'z', validUntil: '2030-01-01', omittedSince: '2026-06-01' })]), labels)
    expect(d[0]!.title).toBe('J+S-Coach: sistiert 2026-05-01')
    expect(d[1]!.title).toBe('J+S-Coach: sistiert 2026-06-01')
  })
  it('null result gives no deadlines; isRecognitionInactive', () => {
    expect(ndsRecognitionsToDeadlines(null)).toEqual([])
    expect(isRecognitionInactive(rec({}))).toBe(false)
    expect(isRecognitionInactive(rec({ state: 'ARCHIVED' }))).toBe(true)
  })
})
