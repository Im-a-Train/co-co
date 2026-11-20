import { describe, expect, it } from 'vitest'
import { renderFeedbackText } from '../../engine'
import type { NdsAggregate, NdsAttendance, NdsCampDetails } from '@/domain/types'
import { allPredicates as p } from '../predicates'
import { CAT_LA, FactsBuilder, makeCtx, makeNds, msg, ruleMeta } from '../factory'

const f = new FactsBuilder().facts

const attendance = (over: Partial<NdsAttendance> = {}): NdsAttendance => ({
  activitiesTotal: 4,
  activitiesRead: 4,
  activitiesChecked: 4,
  participants: 12,
  supervisors: 3,
  participantsNeverPresent: 0,
  participantsNotEligible: 0,
  overlapParticipants: 0,
  overlapSupervisors: 0,
  overlapActivities: 0,
  overlapOfferNumbers: [],
  overlapDates: [],
  mountainGuides: 0,
  byDate: [],
  truncated: false,
  ...over,
})

const details = (over: Partial<NdsCampDetails> = {}): NdsCampDetails => ({
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
  ...over,
})

const withAtt = (over: Partial<NdsAttendance>): NdsAggregate => makeNds({ attendance: attendance(over) })
const withDet = (over: Partial<NdsCampDetails>): NdsAggregate => makeNds({ campDetails: details(over) })
const ctxOf = (nds: NdsAggregate | null, facts = f) => makeCtx(facts, { nds })

describe('CMP-NDS-05 double booking', () => {
  it('has the expected metadata and a feedbackText', () => {
    expect(ruleMeta('CMP-NDS-05')).toMatchObject({ kind: 'hard', severity: 'should', confidence: 'unverified', module: 'js', scope: 'camp' })
    expect(ruleMeta('CMP-NDS-05').feedbackText).toBeTruthy()
  })
  it('is silent without NDS, without attendance (old aggregate) or without overlaps', () => {
    expect(p['CMP-NDS-05'](makeCtx(f))).toEqual([])
    expect(p['CMP-NDS-05'](ctxOf(makeNds()))).toEqual([])
    expect(p['CMP-NDS-05'](ctxOf(makeNds({ attendance: null })))).toEqual([])
    expect(p['CMP-NDS-05'](ctxOf(withAtt({})))).toEqual([])
  })
  it('flags overlaps with params, red inputs, evidence and the NDS source', () => {
    const hits = p['CMP-NDS-05'](
      ctxOf(withAtt({ overlapParticipants: 2, overlapSupervisors: 1, overlapOfferNumbers: ['111', '222'], overlapDates: ['2031-07-13', '2031-07-14'] })),
    )
    expect(hits).toHaveLength(1)
    expect(hits[0].params).toMatchObject({ participants: 2, supervisors: 1, offers: '111, 222', dates: '13.07.2031, 14.07.2031', stand: '01.01.2031' })
    expect(hits[0].redKeys).toEqual(['overlapParticipants', 'overlapSupervisors'])
    expect(hits[0].evidence).toHaveLength(1)
    expect(msg('CMP-NDS-05', hits[0])).toContain('Quelle: NDS, Stand 01.01.2031')
    expect(renderFeedbackText(ruleMeta('CMP-NDS-05'), hits[0])).toContain('2 Teilnehmende und 1 Leitende')
  })
  it('uses a dash when offers or dates are unknown', () => {
    const hits = p['CMP-NDS-05'](ctxOf(withAtt({ overlapSupervisors: 1 })))
    expect(hits[0].params).toMatchObject({ offers: '–', dates: '–' })
  })
})

describe('CMP-NDS-06 never present / not eligible', () => {
  it('has the expected metadata', () => {
    expect(ruleMeta('CMP-NDS-06')).toMatchObject({ kind: 'hard', severity: 'hint', confidence: 'unverified', module: 'js', scope: 'camp' })
  })
  it('is silent without data, with zero counts, or when no activity was checked', () => {
    expect(p['CMP-NDS-06'](makeCtx(f))).toEqual([])
    expect(p['CMP-NDS-06'](ctxOf(makeNds()))).toEqual([])
    expect(p['CMP-NDS-06'](ctxOf(withAtt({})))).toEqual([])
    expect(p['CMP-NDS-06'](ctxOf(withAtt({ activitiesChecked: 0, participantsNeverPresent: 5 })))).toEqual([])
  })
  it('never variant', () => {
    const hits = p['CMP-NDS-06'](ctxOf(withAtt({ participantsNeverPresent: 2 })))
    expect(hits[0].variant).toBe('never')
    expect(hits[0].redKeys).toEqual(['participantsNeverPresent', 'participantsNotEligible'])
    expect(hits[0].evidence).toHaveLength(1)
    expect(msg('CMP-NDS-06', hits[0])).toContain('2 Teilnehmende waren in keiner kontrollierten Aktivität anwesend')
    expect(msg('CMP-NDS-06', hits[0])).toContain('Quelle: NDS')
  })
  it('notEligible variant (also without checked activities)', () => {
    const hits = p['CMP-NDS-06'](ctxOf(withAtt({ activitiesChecked: 0, participantsNotEligible: 1 })))
    expect(hits[0].variant).toBe('notEligible')
    expect(msg('CMP-NDS-06', hits[0])).toContain('1 Teilnehmende sind nicht beitragsberechtigt')
  })
  it('both -> the base message', () => {
    const hits = p['CMP-NDS-06'](ctxOf(withAtt({ participantsNeverPresent: 2, participantsNotEligible: 1 })))
    expect(hits[0].variant).toBeUndefined()
    expect(msg('CMP-NDS-06', hits[0])).toContain('2 Teilnehmende nie anwesend, 1 nicht beitragsberechtigt')
  })
})

describe('CMP-NDS-07 day without supervisors present', () => {
  it('has the expected metadata and a feedbackText', () => {
    expect(ruleMeta('CMP-NDS-07')).toMatchObject({ kind: 'hard', severity: 'should', confidence: 'unverified', module: 'js', scope: 'camp' })
    expect(ruleMeta('CMP-NDS-07').feedbackText).toBeTruthy()
  })
  it('is silent without data or when every day has supervisors', () => {
    expect(p['CMP-NDS-07'](makeCtx(f))).toEqual([])
    expect(p['CMP-NDS-07'](ctxOf(makeNds()))).toEqual([])
    expect(p['CMP-NDS-07'](ctxOf(withAtt({})))).toEqual([])
    const ok = withAtt({ byDate: [{ date: '2031-07-13', activities: 2, participantsPresent: 10, supervisorsPresent: 2 }, { date: '2031-07-14', activities: 1, participantsPresent: 0, supervisorsPresent: 0 }] })
    expect(p['CMP-NDS-07'](ctxOf(ok))).toEqual([])
  })
  it('one camp hit listing the affected dates', () => {
    const nds = withAtt({
      byDate: [
        { date: '2031-07-13', activities: 2, participantsPresent: 10, supervisorsPresent: 0 },
        { date: '2031-07-14', activities: 1, participantsPresent: 8, supervisorsPresent: 2 },
        { date: '2031-07-15', activities: 1, participantsPresent: 9, supervisorsPresent: 0 },
      ],
    })
    const hits = p['CMP-NDS-07'](ctxOf(nds))
    expect(hits).toHaveLength(1)
    expect(hits[0].params).toMatchObject({ dates: '13.07.2031, 15.07.2031', count: 2 })
    expect(hits[0].redKeys).toEqual(['daysWithoutSupervisors'])
    expect(hits[0].evidence).toHaveLength(1)
    expect(msg('CMP-NDS-07', hits[0])).toContain('Quelle: NDS, Stand 01.01.2031')
    expect(renderFeedbackText(ruleMeta('CMP-NDS-07'), hits[0])).toContain('13.07.2031, 15.07.2031')
  })
})

describe('CMP-NDS-08 risk activity not declared in the NDS', () => {
  const risky = () => {
    const b = new FactsBuilder()
    b.activity('Geländespiel im Wald', CAT_LA)
    b.activity('Baden im See', CAT_LA)
    b.activity('Basteln', CAT_LA)
    return b.facts
  }
  it('has the expected metadata and the CMP-ACT-03 keyword sets', () => {
    const m = ruleMeta('CMP-NDS-08')
    expect(m).toMatchObject({ kind: 'hard', severity: 'should', confidence: 'heuristic', module: 'js', scope: 'camp' })
    expect(m.feedbackText).toBeTruthy()
    expect(m.keywords).toEqual(ruleMeta('CMP-ACT-03').keywords)
  })
  it('is silent without NDS / details / a "false" answer, and without risk activities', () => {
    const facts = risky()
    expect(p['CMP-NDS-08'](makeCtx(facts))).toEqual([])
    expect(p['CMP-NDS-08'](ctxOf(makeNds(), facts))).toEqual([])
    expect(p['CMP-NDS-08'](ctxOf(withDet({ riskActivitiesPlanned: null }), facts))).toEqual([])
    expect(p['CMP-NDS-08'](ctxOf(withDet({ riskActivitiesPlanned: true }), facts))).toEqual([])
    const plain = new FactsBuilder()
    plain.activity('Basteln', CAT_LA)
    expect(p['CMP-NDS-08'](ctxOf(withDet({ riskActivitiesPlanned: false }), plain.facts))).toEqual([])
  })
  it('flags J+S risk activities when the NDS says none are planned', () => {
    const hits = p['CMP-NDS-08'](ctxOf(withDet({ riskActivitiesPlanned: false }), risky()))
    expect(hits).toHaveLength(1)
    expect(hits[0].params).toMatchObject({ activities: 'Geländespiel im Wald, Baden im See', count: 2 })
    expect(hits[0].redKeys).toEqual(['riskActivitiesPlanned'])
    expect(hits[0].evidence).toHaveLength(1)
    expect(msg('CMP-NDS-08', hits[0])).toContain('Quelle: NDS, Stand 01.01.2031')
  })
  it('lists at most five activities', () => {
    const b = new FactsBuilder()
    for (let i = 1; i <= 7; i++) b.activity(`Wald ${i}`, CAT_LA)
    const hits = p['CMP-NDS-08'](ctxOf(withDet({ riskActivitiesPlanned: false }), b.facts))
    expect(hits[0].params).toMatchObject({ count: 7, activities: 'Wald 1, Wald 2, Wald 3, Wald 4, Wald 5, …' })
  })
  it('is silent when the J+S model is not ok (no mapping)', () => {
    expect(p['CMP-NDS-08'](makeCtx(risky(), { nds: withDet({ riskActivitiesPlanned: false }), mapping: null }))).toEqual([])
  })
})

describe('CMP-NDS-09 minimum requirements reported by the NDS', () => {
  it('has the expected metadata and a feedbackText', () => {
    expect(ruleMeta('CMP-NDS-09')).toMatchObject({ kind: 'hard', severity: 'should', confidence: 'unverified', module: 'js', scope: 'camp' })
    expect(ruleMeta('CMP-NDS-09').feedbackText).toBeTruthy()
  })
  it('is silent without data, null or empty messages', () => {
    expect(p['CMP-NDS-09'](makeCtx(f))).toEqual([])
    expect(p['CMP-NDS-09'](ctxOf(makeNds()))).toEqual([])
    expect(p['CMP-NDS-09'](ctxOf(withDet({ minimalRequirementsMessages: null })))).toEqual([])
    expect(p['CMP-NDS-09'](ctxOf(withDet({ minimalRequirementsMessages: [] })))).toEqual([])
  })
  it('lists the messages (max 5)', () => {
    const hits = p['CMP-NDS-09'](ctxOf(withDet({ minimalRequirementsMessages: ['A fehlt', 'B fehlt'] })))
    expect(hits[0].params).toMatchObject({ count: 2, messages: 'A fehlt; B fehlt' })
    expect(hits[0].redKeys).toEqual(['minimalRequirementMessages'])
    expect(hits[0].evidence).toHaveLength(1)
    expect(msg('CMP-NDS-09', hits[0])).toContain('Quelle: NDS, Stand 01.01.2031')
    const many = p['CMP-NDS-09'](ctxOf(withDet({ minimalRequirementsMessages: ['1', '2', '3', '4', '5', '6'] })))
    expect(many[0].params).toMatchObject({ count: 6, messages: '1; 2; 3; 4; 5; …' })
    expect(renderFeedbackText(ruleMeta('CMP-NDS-09'), hits[0])).toContain('A fehlt; B fehlt')
  })
})

describe('CMP-NDS-10 check the NDS status', () => {
  const flags = (over: Partial<NdsCampDetails['offerFlags']>) => ({ ...details().offerFlags, ...over })
  it('has the expected metadata', () => {
    expect(ruleMeta('CMP-NDS-10')).toMatchObject({ kind: 'hard', severity: 'hint', confidence: 'unverified', module: 'js', scope: 'camp' })
  })
  it('is silent without data or without flags', () => {
    expect(p['CMP-NDS-10'](makeCtx(f))).toEqual([])
    expect(p['CMP-NDS-10'](ctxOf(makeNds()))).toEqual([])
    expect(p['CMP-NDS-10'](ctxOf(withDet({})))).toEqual([])
    expect(p['CMP-NDS-10'](ctxOf(withDet({ lateSubmission: false, approvalWithReservation: false })))).toEqual([])
  })
  it('one variant per single cause', () => {
    const cases: [Partial<NdsCampDetails>, string, string][] = [
      [{ offerFlags: flags({ itemsInCorrection: true }) }, 'correction', 'in Korrektur'],
      [{ approvalWithReservation: true }, 'reservation', 'mit Vorbehalt'],
      [{ lateSubmission: true }, 'late', 'verspätet'],
      [{ offerFlags: flags({ lateSubmittedItemsUnapproved: true }) }, 'late', 'verspätet'],
    ]
    for (const [over, variant, text] of cases) {
      const hits = p['CMP-NDS-10'](ctxOf(withDet(over)))
      expect(hits).toHaveLength(1)
      expect(hits[0].variant).toBe(variant)
      expect(hits[0].evidence).toHaveLength(1)
      expect(hits[0].redKeys).toEqual(['statusFlags'])
      expect(msg('CMP-NDS-10', hits[0])).toContain(text)
      expect(msg('CMP-NDS-10', hits[0])).toContain('Quelle: NDS, Stand 01.01.2031')
    }
  })
  it('several causes -> the generic message', () => {
    const hits = p['CMP-NDS-10'](ctxOf(withDet({ approvalWithReservation: true, lateSubmission: true })))
    expect(hits[0].variant).toBeUndefined()
    expect(msg('CMP-NDS-10', hits[0])).toContain('mehrere Statushinweise')
  })
})

describe('CMP-NDS-11 J+S days NDS vs eCamp', () => {
  it('has the expected metadata', () => {
    expect(ruleMeta('CMP-NDS-11')).toMatchObject({ kind: 'hard', severity: 'hint', confidence: 'unverified', module: 'js', scope: 'camp' })
  })
  it('is silent without data, with a null count, or when equal', () => {
    expect(p['CMP-NDS-11'](makeCtx(f))).toEqual([])
    expect(p['CMP-NDS-11'](ctxOf(makeNds()))).toEqual([])
    expect(p['CMP-NDS-11'](ctxOf(withDet({ campDaysWithActivities: null })))).toEqual([])
    const days = makeCtx(f).js.jsDayCount
    expect(p['CMP-NDS-11'](ctxOf(withDet({ campDaysWithActivities: days })))).toEqual([])
  })
  it('is silent when the J+S model is not ok', () => {
    expect(p['CMP-NDS-11'](makeCtx(f, { nds: withDet({ campDaysWithActivities: 9 }), mapping: null }))).toEqual([])
  })
  it('flags a difference with both numbers', () => {
    const days = makeCtx(f).js.jsDayCount
    const hits = p['CMP-NDS-11'](ctxOf(withDet({ campDaysWithActivities: days + 2 })))
    expect(hits).toHaveLength(1)
    expect(hits[0].params).toMatchObject({ nds: days + 2, ecamp: days, stand: '01.01.2031' })
    expect(hits[0].redKeys).toEqual(['ndsCampDays'])
    expect(hits[0].evidence).toHaveLength(1)
    expect(msg('CMP-NDS-11', hits[0])).toContain('Quelle: NDS, Stand 01.01.2031')
  })
})
