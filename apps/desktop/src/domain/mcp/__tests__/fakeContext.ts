/** Test helper: an in-memory McpContext over a FactsBuilder camp (no Dexie, no Tauri). */
import { vi } from 'vitest'
import { CAMP, CAT_LS, FactsBuilder } from '@/domain/rules/__tests__/factory'
import type {
  CollaboratorFact,
  Deadline,
  FeedbackItem,
  Finding,
  Override,
  ReviewState,
  ResourceRecord,
  ReviewStatus,
  Round,
  RuleEditPatch,
  RuleEditRecord,
  RulePack,
} from '@/domain/types'
import type { McpContext } from '../types'

export const NAME = 'Anna Beispiel'
export const EMAIL = 'anna.beispiel@example.com'

export function collaborator(over: Partial<CollaboratorFact> = {}): CollaboratorFact {
  return {
    iri: '/api/camp_collaborations/cc1',
    userIri: '/api/users/u9',
    role: 'manager',
    status: 'established',
    displayName: NAME,
    nickname: 'Anna',
    firstname: 'Anna',
    surname: 'Beispiel',
    abbreviation: null,
    isCurrentUser: false,
    ...over,
  }
}

export function makeFinding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'JS-X-01:/api/activities/a1',
    ruleId: 'JS-X-01',
    ruleVersion: '1',
    packId: 'basis',
    severity: 'must',
    confidence: 'verified',
    title: 'Sicherheitskonzept fehlt',
    message: 'Für die Aktivität fehlt ein Sicherheitskonzept.',
    scope: 'activity',
    targets: ['/api/activities/a1'],
    evidence: [{ kind: 'activity', iri: '/api/activities/a1', label: 'Aktivität', snippet: 'Kein Text' }],
    source: { title: 'J+S', url: 'https://www.jugendundsport.ch' },
    origin: 'rule',
    tags: [],
    override: null,
    ...over,
  }
}

export function makeFeedback(over: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'f1',
    campIri: CAMP,
    scope: 'activity',
    activityIri: '/api/activities/a1',
    kind: 'suggestion',
    text: 'Bitte ergänzen.',
    status: 'draft',
    createdAt: '2031-01-01T00:00:00.000Z',
    updatedAt: '2031-01-01T00:00:00.000Z',
    ...over,
  }
}

export interface FakeState {
  feedback: FeedbackItem[]
  overrides: Override[]
  review: ReviewState | null
  rounds: Round[]
  findings: Finding[]
  deadlines: Deadline[]
  packs: RulePack[]
  resources: ResourceRecord[]
  ruleEdits: RuleEditRecord[]
  confirmAnswer: boolean
}

export function makeFakeContext(over: Partial<FakeState> = {}) {
  const b = new FactsBuilder({ title: 'Sommerlager' })
  b.facts.collaborators.push(collaborator())
  b.facts.categories.push({ iri: CAT_LS, short: 'LS', name: 'Lagersport', color: '#fff', numberingStyle: null })
  const a1 = b.activity(`Wanderung mit ${NAME} (${EMAIL})`, CAT_LS, {
    location: 'Waldhütte',
    content: { storyboardText: `Treffpunkt: ${NAME}, ${EMAIL}`, safetyText: 'Notfallplan bei Anna', hasSafetyConsiderations: true },
  })
  a1.iri = '/api/activities/a1'
  b.entry(a1, 1, '09:00', '11:00')
  const a2 = b.activity('Abendspiel', CAT_LS)
  a2.iri = '/api/activities/a2'
  b.entry(a2, 2, '19:00', '20:00')

  const state: FakeState = {
    feedback: [],
    overrides: [],
    review: null,
    rounds: [],
    findings: [makeFinding()],
    deadlines: [],
    packs: [],
    resources: [],
    ruleEdits: [],
    confirmAnswer: true,
    ...over,
  }
  const facts = b.facts
  let idCounter = 0
  const ctx: McpContext & { state: FakeState } = {
    state,
    now: () => new Date('2031-01-01T12:00:00Z'),
    listCamps: vi.fn(async () => [
      { iri: CAMP, id: 'c1', title: 'Sommerlager', shortTitle: null, motto: 'Abenteuer', start: '2031-07-12', end: '2031-07-16', role: 'manager' as const, isPrototype: false },
    ]),
    loadFacts: vi.fn(async () => facts),
    getMapping: vi.fn(async () => null),
    findings: vi.fn(async () => state.findings),
    rulePacks: () => state.packs,
    listResources: vi.fn(async () => state.resources),
    getResource: vi.fn(async (key: string) => state.resources.find((r) => r.key === key)),
    updateResource: vi.fn(async (key: string, patch: Partial<ResourceRecord>) => {
      const rec = state.resources.find((r) => r.key === key)
      if (!rec) throw new Error('Unbekanntes Hilfsmittel.')
      Object.assign(rec, patch, { modified: true, updatedBy: 'mcp' })
      return rec
    }),
    listRuleEdits: vi.fn(async () => state.ruleEdits),
    saveRuleEdit: vi.fn(async (ruleId: string, patch: RuleEditPatch, opts: { reason?: string; resourceKeys?: string[] }) => {
      const rec: RuleEditRecord = {
        ruleId,
        baseVersion: '1',
        patch,
        reason: opts.reason,
        resourceKeys: opts.resourceKeys,
        updatedAt: '2031-01-01T12:00:00.000Z',
        updatedBy: 'mcp',
      }
      state.ruleEdits = [...state.ruleEdits.filter((e) => e.ruleId !== ruleId), rec]
      for (const p of state.packs) for (const r of p.rules) if (r.meta.id === ruleId) Object.assign(r.meta, patch)
      return rec
    }),
    deadlines: vi.fn(async () => state.deadlines),
    listFeedback: vi.fn(async () => state.feedback),
    getFeedback: vi.fn(async (id: string) => state.feedback.find((f) => f.id === id) ?? null),
    saveFeedback: vi.fn(async (item: FeedbackItem) => {
      state.feedback = [...state.feedback.filter((f) => f.id !== item.id), item]
    }),
    listOverrides: vi.fn(async () => state.overrides),
    addOverride: vi.fn(async (campIri: string, findingId: string, ruleId: string, reason: string) => {
      const o: Override = { id: 'o1', campIri, findingId, ruleId, reason, createdAt: '2031-01-01T12:00:00.000Z' }
      state.overrides.push(o)
      return o
    }),
    listRounds: vi.fn(async () => state.rounds),
    getReview: vi.fn(async () => state.review),
    setReviewStatus: vi.fn(async (campIri: string, status: ReviewStatus, note: string | null) => {
      state.review = {
        campIri,
        status,
        history: [...(state.review?.history ?? []), { status, at: '2031-01-01T12:00:00.000Z', note }],
        updatedAt: '2031-01-01T12:00:00.000Z',
      }
      return state.review
    }),
    postFeedbackComment: vi.fn(async (id: string) => {
      const item = state.feedback.find((f) => f.id === id)!
      const posted: FeedbackItem = { ...item, status: 'posted', postedParts: 1 }
      state.feedback = state.feedback.map((f) => (f.id === id ? posted : f))
      return posted
    }),
    confirm: vi.fn(async () => state.confirmAnswer),
    newId: () => `new-${++idCounter}`,
  }
  return { ctx, facts, state }
}
