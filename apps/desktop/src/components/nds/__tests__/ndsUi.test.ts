import { describe, expect, it } from 'vitest'
import { adoptNdsFields } from '@/composables/useNds'
import nds from '@/locales/de/nds.json'
import rules from '@/locales/de/rules.json'
import type { NdsCampDetails } from '@/domain/types'
import { countEntries, formatChf, hasCampDetails, ndsLinkLabel, ndsPreChecked, ndsValueKey, presentParticipants, protocolKindColor, triKey } from '../format'

describe('nds format helpers', () => {
  it('ndsLinkLabel names the camp, the id only as last resort', () => {
    const t = (k: string, p: Record<string, unknown>) => (k === 'nds.card.link.offer' ? `Angebot ${String(p.n)}` : k)
    const link = { offerBusinessId: 'o', campBusinessId: 'camp-9001' }
    expect(ndsLinkLabel({ ...link, groupName: 'Musterstufe', offerNumber: '999001', start: '2031-01-24', end: '2031-01-30' }, null, t)).toBe(
      'Musterstufe · Angebot 999001 (24.–30.01.2031)',
    )
    expect(ndsLinkLabel(link, { offerNumber: '999001', start: null, end: null }, t)).toBe('Angebot 999001')
    expect(ndsLinkLabel(link, { offerNumber: null, start: '2031-01-24', end: null }, t)).toBe('camp-9001 (24.01.2031)')
    expect(ndsLinkLabel(link, null, t)).toBe('camp-9001')
  })
  it('countEntries sorts by count, keeps unknown codes raw', () => {
    const rows = countEntries({ B_CODE: 1, A_CODE: 3, C_CODE: 1 })
    expect(rows.map((r) => r.code)).toEqual(['A_CODE', 'B_CODE', 'C_CODE'])
    expect(rows[0].n).toBe(3)
    expect(rows[0].label).toBeTruthy()
  })
  it('countEntries uses the role mapping when t is given', () => {
    const t = (k: string) => (k === 'persons.role.child' ? 'Kind' : k)
    const rows = countEntries({ CHILD: 18, SOME_NEW_STATE: 1 }, t)
    expect(rows.find((r) => r.code === 'CHILD')!.label).toBe('Kind')
    expect(rows.find((r) => r.code === 'SOME_NEW_STATE')!.label).toBe('SOME_NEW_STATE')
  })
  it('ndsValueKey', () => {
    expect(ndsValueKey(null)).toBeNull()
    expect(ndsValueKey(true)).toEqual({ key: 'yes' })
    expect(ndsValueKey('2026-05-03')).toEqual({ text: '2026-05-03' })
  })
  it('ndsPreChecked only when NDS value known, differs and current is empty or no', () => {
    expect(ndsPreChecked({ ndsValue: true, currentValue: null, same: false })).toBe(true)
    expect(ndsPreChecked({ ndsValue: true, currentValue: false, same: false })).toBe(true)
    expect(ndsPreChecked({ ndsValue: '2026-05-03', currentValue: '2026-05-01', same: false })).toBe(false)
    expect(ndsPreChecked({ ndsValue: null, currentValue: null, same: false })).toBe(false)
    expect(ndsPreChecked({ ndsValue: true, currentValue: true, same: true })).toBe(false)
  })
})

describe('adoptNdsFields', () => {
  it('is exported for the Lager-Angaben view', () => {
    expect(typeof adoptNdsFields).toBe('function')
  })
})

const emptyDetails = (): NdsCampDetails => ({
  riskActivitiesPlanned: null,
  riskActivityAnswers: [null, null, null],
  supervisorExpertisePresent: null,
  overnightStay: null,
  lateSubmission: null,
  approvalWithReservation: null,
  campDaysWithActivities: null,
  campDaysWithoutActivities: null,
  activityDurationFirstDay: null,
  activityDurationLastDay: null,
  present: { maleChildren: null, femaleChildren: null, maleAdolescents: null, femaleAdolescents: null, supervisors: null },
  subsidies: { planned: null, actual: null, total: null },
  minimalRequirementsMessages: null,
  offerFlags: { lateSubmittedItems: null, lateSubmittedItemsUnapproved: null, itemsInCorrection: null, handicapRegistration: null, evaluationState: null },
})

describe('M21 display helpers', () => {
  it('triKey maps booleans and null', () => {
    expect([triKey(true), triKey(false), triKey(null), triKey(undefined)]).toEqual(['yes', 'no', 'unknown', 'unknown'])
  })
  it('formatChf groups thousands and keeps decimals only when fractional', () => {
    expect(formatChf(1432.5)).toBe('CHF 1’432.50')
    expect(formatChf(1520)).toBe('CHF 1’520')
    expect(formatChf(0)).toBe('CHF 0')
    expect(formatChf(1234567)).toBe('CHF 1’234’567')
    expect(formatChf(null)).toBe('–')
    expect(formatChf(Number.NaN)).toBe('–')
  })
  it('protocolKindColor', () => {
    expect(protocolKindColor('approved')).toBe('success')
    expect(protocolKindColor('submitted')).toBe('primary')
    expect(protocolKindColor('other')).toBeUndefined()
  })
  it('presentParticipants sums known counts, null when none known', () => {
    expect(presentParticipants({ maleChildren: 9, femaleChildren: 9, maleAdolescents: 3, femaleAdolescents: null })).toBe(21)
    expect(presentParticipants({ maleChildren: null, femaleChildren: null, maleAdolescents: null, femaleAdolescents: null })).toBeNull()
  })
  it('hasCampDetails is false for an all-null record and true as soon as one value is known', () => {
    expect(hasCampDetails(emptyDetails())).toBe(false)
    expect(hasCampDetails({ ...emptyDetails(), lateSubmission: false })).toBe(true)
    expect(hasCampDetails({ ...emptyDetails(), minimalRequirementsMessages: [] })).toBe(false)
    expect(hasCampDetails({ ...emptyDetails(), minimalRequirementsMessages: ['x'] })).toBe(true)
    expect(hasCampDetails({ ...emptyDetails(), subsidies: { planned: null, actual: 0, total: null } })).toBe(true)
  })
})

describe('M21 locale keys', () => {
  const at = (obj: unknown, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj)
  it('nds.* keys used by the new sections exist', () => {
    for (const k of [
      'tri.yes', 'tri.no', 'tri.unknown', 'attendance.title', 'attendance.overlaps', 'attendance.truncated', 'details.title', 'details.minimalRequirements',
      'protocol.title', 'protocol.submittedOn', 'picker.suggested', 'adopt.registeredOnHintProtocol', 'settings.person.title', 'settings.profile.load',
    ]) {
      expect(typeof at(nds.nds, k), k).toBe('string')
    }
  })
  it('every protocol kind, picker reason and flag has a label', () => {
    for (const k of ['submitted', 'approved', 'assessment', 'closed', 'paid', 'other']) expect(typeof at(nds.nds, `protocol.kind.${k}`), k).toBe('string')
    for (const k of ['sameDates', 'overlapDates', 'nameMatch', 'organisation']) expect(typeof at(nds.nds, `picker.reason.${k}`), k).toBe('string')
    for (const k of ['riskActivitiesPlanned', 'supervisorExpertise', 'overnightStay', 'lateSubmission', 'approvalWithReservation', 'itemsInCorrection', 'lateSubmittedItems', 'handicapRegistration']) {
      expect(typeof at(nds.nds, `details.flag.${k}`), k).toBe('string')
    }
  })
  it('rules.deadlines has the nds-recognition kind labels', () => {
    for (const group of ['kind', 'kindShort', 'kindTitle']) expect(typeof at(rules.rules, `deadlines.${group}.nds-recognition`), group).toBe('string')
    expect(typeof at(rules.rules, 'deadlines.ndsRecognitions.load')).toBe('string')
  })
})
