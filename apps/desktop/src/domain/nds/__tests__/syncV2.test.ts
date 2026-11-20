import { describe, expect, it } from 'vitest'
import { makeCoachInputs, makeNds } from '../../rules/__tests__/factory'
import type { NdsProtocol } from '../../types'
import { formatChf, presentTotal } from '../format'
import { adoptNdsFields, dropEditedNdsFields, ndsFieldDiffs, ndsRegisteredOnIsSubmission, ndsSuggestions, NDS_FIELDS } from '../index'

const protocol = (over: Partial<NdsProtocol>): NdsProtocol => ({ events: [], submittedOn: null, approvedOn: null, closedOn: null, truncated: false, ...over })

describe('ndsSuggestions with protocol', () => {
  it('prefers the submission date over approvedOn and suggests the closing date', () => {
    const agg = makeNds({ approvedOn: '2031-05-20', protocol: protocol({ submittedOn: '2031-05-10', closedOn: '2031-09-01' }) })
    expect(ndsSuggestions(agg)).toEqual({ ndsRegistered: true, ndsRegisteredOn: '2031-05-10', ndsClosed: true, ndsClosedOn: '2031-09-01' })
  })
  it('protocol without dates changes nothing; submission alone registers', () => {
    expect(ndsSuggestions(makeNds({ approvedOn: '2031-05-20', protocol: protocol({}) }))).toEqual({ ndsRegistered: true, ndsRegisteredOn: '2031-05-20' })
    expect(ndsSuggestions(makeNds({ protocol: protocol({ submittedOn: '2031-05-10' }) }))).toEqual({ ndsRegistered: true, ndsRegisteredOn: '2031-05-10' })
  })
  it('adopts, diffs and drops ndsClosedOn like the other fields', () => {
    const agg = makeNds({ protocol: protocol({ closedOn: '2031-09-01' }) })
    expect(NDS_FIELDS).toContain('ndsClosedOn')
    const inputs = makeCoachInputs({})
    const adopted = adoptNdsFields(inputs, agg, ['ndsClosed', 'ndsClosedOn'], 'now')
    expect(adopted.ndsClosedOn).toBe('2031-09-01')
    expect(adopted.ndsFields?.ndsClosedOn).toBe(agg.fetchedAt)
    expect(ndsFieldDiffs(agg, adopted).find((d) => d.field === 'ndsClosedOn')).toMatchObject({ same: true, fromNds: true })
    expect(dropEditedNdsFields(adopted, { ...adopted, ndsClosedOn: '2031-09-02' }).ndsFields?.ndsClosedOn).toBeUndefined()
  })
})

describe('ndsRegisteredOnIsSubmission', () => {
  const agg = makeNds({ protocol: protocol({ submittedOn: '2031-05-10' }) })
  it('is true only for an adopted date equal to the submission date', () => {
    const base = makeCoachInputs({ ndsRegisteredOn: '2031-05-10' })
    expect(ndsRegisteredOnIsSubmission(agg, { ...base, ndsFields: { ndsRegisteredOn: 'x' } })).toBe(true)
    expect(ndsRegisteredOnIsSubmission(agg, base)).toBe(false)
    expect(ndsRegisteredOnIsSubmission(agg, { ...base, ndsRegisteredOn: '2031-05-11', ndsFields: { ndsRegisteredOn: 'x' } })).toBe(false)
    expect(ndsRegisteredOnIsSubmission(makeNds(), { ...base, ndsFields: { ndsRegisteredOn: 'x' } })).toBe(false)
    expect(ndsRegisteredOnIsSubmission(null, null)).toBe(false)
  })
})

describe('format', () => {
  it('formatChf', () => {
    expect(formatChf(1234.5)).toBe("1'234.50")
    expect(formatChf(1234567)).toBe("1'234'567.00")
    expect(formatChf(0)).toBe('0.00')
    expect(formatChf(999.999)).toBe("1'000.00")
    expect(formatChf(null)).toBeNull()
  })
  it('presentTotal', () => {
    expect(presentTotal({ maleChildren: 3, femaleChildren: null, maleAdolescents: 2, femaleAdolescents: 1, supervisors: 9 })).toBe(6)
    expect(presentTotal({ maleChildren: null, femaleChildren: null, maleAdolescents: null, femaleAdolescents: null, supervisors: 4 })).toBeNull()
  })
})
