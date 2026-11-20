import { describe, expect, it } from 'vitest'
import { isDocumentReviewed, reviewProgress, reviewVerdict, toCampProgressSummary, REVIEW_STEP_ROUTES, type ReviewProgressInput } from '../progress'
import type { ApprovalBlockers } from '../../rounds'

const empty: ReviewProgressInput = {
  reviewStatus: null,
  mappingConfirmed: false,
  missingInputs: 2,
  suggestedModules: [],
  triage: { done: 0, total: 4 },
  manualFindingCount: 0,
  documents: { total: 2, reviewed: 0 },
  checklist: { done: 0, total: 5 },
  feedback: { total: 0, draft: 0, posted: 0, sent: 0 },
  rounds: 0,
}
const full: ReviewProgressInput = {
  reviewStatus: 'bewilligt',
  mappingConfirmed: true,
  missingInputs: 0,
  suggestedModules: [],
  triage: { done: 4, total: 4 },
  manualFindingCount: 1,
  documents: { total: 2, reviewed: 2 },
  checklist: { done: 5, total: 5 },
  feedback: { total: 3, draft: 0, posted: 1, sent: 2 },
  rounds: 2,
}

describe('reviewProgress', () => {
  it('starts at 0 with ordered steps and a hint on the first open step only', () => {
    const p = reviewProgress(empty)
    expect(p.percent).toBe(0)
    expect(p.steps.map((s) => s.key)).toEqual(['mapping', 'inputs', 'triage', 'documents', 'checklist', 'feedback', 'status'])
    expect(p.steps.filter((s) => s.hintKey).map((s) => s.key)).toEqual(['mapping'])
  })
  it('reaches 100 when everything is done, without hints', () => {
    const p = reviewProgress(full)
    expect(p.percent).toBe(100)
    expect(p.steps.every((s) => s.done && !s.hintKey)).toBe(true)
  })
  it('counts partial triage and treats empty triage/checklist as done', () => {
    const half = reviewProgress({ ...empty, triage: { done: 2, total: 4 } })
    expect(half.percent).toBe(Math.round(25 * 0.5))
    expect(half.steps[2]).toMatchObject({ done: false, value: 2, total: 4 })
    const none = reviewProgress({ ...empty, triage: { done: 0, total: 0 }, checklist: { done: 0, total: 0 } })
    expect(none.steps.find((s) => s.key === 'triage')?.done).toBe(true)
    expect(none.steps.find((s) => s.key === 'checklist')?.done).toBe(true)
  })
  it('feedback: any item is done, posted/sent raises the fraction', () => {
    const draft = reviewProgress({ ...empty, feedback: { total: 2, draft: 2, posted: 0, sent: 0 } })
    expect(draft.steps.find((s) => s.key === 'feedback')?.done).toBe(true)
    expect(draft.percent).toBe(Math.round(15 * 0.5))
  })
  it('status: approved done, changes requested partial, in review nothing', () => {
    const st = (reviewStatus: ReviewProgressInput['reviewStatus']) => reviewProgress({ ...empty, reviewStatus })
    expect(st('bewilligt_mit_auflagen').steps[6].done).toBe(true)
    expect(st('aenderungen_angefragt').percent).toBe(Math.round(15 * 0.5))
    expect(st('aenderungen_angefragt').steps[6].done).toBe(false)
    expect(st('in_review').percent).toBe(0)
  })
  it('documents without any document are not done', () => {
    const p = reviewProgress({ ...full, documents: { total: 0, reviewed: 0 } })
    expect(p.steps.find((s) => s.key === 'documents')?.done).toBe(false)
  })
})

describe('isDocumentReviewed', () => {
  it('needs a coach action: decision, confirmed item, manual finding or a link (not the automatic docCheck)', () => {
    expect(isDocumentReviewed({ docCheck: {}, activityIris: [] } as never, 0)).toBe(false)
    expect(isDocumentReviewed({ safetyConcept: null, docCheckConfirmed: [], activityIris: [] }, 0)).toBe(false)
    expect(isDocumentReviewed({ safetyConcept: false, activityIris: [] }, 0)).toBe(true)
    expect(isDocumentReviewed({ safetyConcept: true, activityIris: [] }, 0)).toBe(true)
    expect(isDocumentReviewed({ docCheckConfirmed: ['emergencyNumbers'], activityIris: [] }, 0)).toBe(true)
    expect(isDocumentReviewed({ activityIris: [] }, 1)).toBe(true)
    expect(isDocumentReviewed({ activityIris: ['x'] }, 0)).toBe(true)
  })
})

describe('inputs / mapping steps', () => {
  it('inputs is done at 0 missing, open otherwise', () => {
    expect(reviewProgress({ ...full, missingInputs: 0 }).steps[1]?.done).toBe(true)
    expect(reviewProgress({ ...full, missingInputs: 3 }).steps[1]?.done).toBe(false)
  })
  it('mapping needs a confirmed mapping AND no suggested module', () => {
    expect(reviewProgress({ ...full, suggestedModules: ['berg'] }).steps[0]?.done).toBe(false)
    expect(reviewProgress({ ...full, mappingConfirmed: false }).steps[0]?.done).toBe(false)
    expect(reviewProgress({ ...full, suggestedModules: [] }).steps[0]?.done).toBe(true)
  })
})

describe('REVIEW_STEP_ROUTES', () => {
  it('maps every step to a real camp route name', () => {
    expect(REVIEW_STEP_ROUTES).toEqual({
      mapping: 'camp-grid',
      inputs: 'camp-inputs',
      triage: 'camp-findings',
      documents: 'camp-documents',
      checklist: 'camp-checklist',
      feedback: 'camp-feedback',
      status: 'camp-rounds',
    })
  })
})

const blockers = (over: Partial<ApprovalBlockers> = {}): ApprovalBlockers => ({
  openMust: 0, untriaged: 0, unsentMust: 0, unsentDrafts: 0, jsDays: null, mappingUnconfirmed: false, any: false, ...over,
})

describe('reviewVerdict', () => {
  it('approved wins, with or without date', () => {
    const b = blockers({ openMust: 1, any: true })
    expect(reviewVerdict({ blockers: b, reviewStatus: 'bewilligt', approvedAt: '2026-01-01T10:00:00Z' })).toEqual({ kind: 'approved', at: '2026-01-01T10:00:00Z' })
    expect(reviewVerdict({ blockers: b, reviewStatus: 'bewilligt_mit_auflagen', approvedAt: null })).toEqual({ kind: 'approved', at: null })
  })
  it('waiting while changes are requested', () => {
    expect(reviewVerdict({ blockers: blockers(), reviewStatus: 'aenderungen_angefragt', approvedAt: null })).toEqual({ kind: 'waiting' })
  })
  it('blocked with blockers, ready without', () => {
    const b = blockers({ openMust: 2, any: true })
    expect(reviewVerdict({ blockers: b, reviewStatus: 'in_review', approvedAt: null })).toEqual({ kind: 'blocked', blockers: b })
    expect(reviewVerdict({ blockers: blockers(), reviewStatus: null, approvedAt: null })).toEqual({ kind: 'ready' })
  })
})

describe('toCampProgressSummary', () => {
  it('takes percent, first open step and counts', () => {
    const now = new Date('2026-05-06T07:08:09Z')
    expect(toCampProgressSummary(reviewProgress(empty), { triageOpen: 4, openMust: 1 }, now)).toEqual({
      percent: 0, nextStep: 'mapping', triageOpen: 4, openMust: 1, updatedAt: '2026-05-06T07:08:09.000Z',
    })
  })
  it('nextStep is null when everything is done', () => {
    expect(toCampProgressSummary(reviewProgress(full), { triageOpen: 0, openMust: 0 }).nextStep).toBeNull()
  })
})
