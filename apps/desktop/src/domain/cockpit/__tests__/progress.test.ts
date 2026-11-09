import { describe, expect, it } from 'vitest'
import { isDocumentReviewed, reviewProgress, type ReviewProgressInput } from '../progress'

const empty: ReviewProgressInput = {
  reviewStatus: null,
  mappingConfirmed: false,
  coachInputsPresent: false,
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
  coachInputsPresent: true,
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
  it('needs docCheck, a manual finding or a link', () => {
    expect(isDocumentReviewed({ docCheck: null, activityIris: [] }, 0)).toBe(false)
    expect(isDocumentReviewed({ docCheck: {}, activityIris: [] }, 0)).toBe(true)
    expect(isDocumentReviewed({ docCheck: null, activityIris: [] }, 1)).toBe(true)
    expect(isDocumentReviewed({ docCheck: null, activityIris: ['x'] }, 0)).toBe(true)
  })
})
