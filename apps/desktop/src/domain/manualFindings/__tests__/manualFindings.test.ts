import { describe, expect, it } from 'vitest'
import type { CampFacts, ManualFinding, ManualFindingCategory } from '../../types'
import { MANUAL_FINDING_CATEGORIES } from '../../types'
import {
  anchorLabel,
  feedbackKindOf,
  isManualCategory,
  isManualFindingId,
  MANUAL_COMMENT_MAX,
  MANUAL_RULE_ID,
  manualToFinding,
  newManualFinding,
  severityOf,
} from '..'

const NOW = '2026-07-01T10:00:00.000Z'
const base = { campIri: '/camps/1', scope: 'camp' as const, category: 'program' as const, comment: '  Gut geplant  ' }
const categoryLabel = (c: ManualFindingCategory) => `Label ${c}`

describe('newManualFinding', () => {
  it('trims the comment, prefixes the id and sets timestamps', () => {
    const m = newManualFinding(base, 'abc', NOW)
    expect(m).toMatchObject({ id: 'manual:abc', comment: 'Gut geplant', createdAt: NOW, updatedAt: NOW, scope: 'camp' })
    expect(isManualFindingId(m.id)).toBe(true)
    expect(m.activityIri).toBeUndefined()
  })

  it('rejects empty, too long and unknown input', () => {
    expect(() => newManualFinding({ ...base, comment: '   ' }, 'a', NOW)).toThrow()
    expect(() => newManualFinding({ ...base, comment: 'x'.repeat(MANUAL_COMMENT_MAX + 1) }, 'a', NOW)).toThrow()
    expect(() => newManualFinding({ ...base, comment: 'x'.repeat(MANUAL_COMMENT_MAX) }, 'a', NOW)).not.toThrow()
    expect(() => newManualFinding({ ...base, category: 'nope' as ManualFindingCategory }, 'a', NOW)).toThrow()
  })

  it('requires the target of the scope', () => {
    expect(() => newManualFinding({ ...base, scope: 'activity' }, 'a', NOW)).toThrow()
    expect(() => newManualFinding({ ...base, scope: 'document' }, 'a', NOW)).toThrow()
    expect(newManualFinding({ ...base, scope: 'activity', activityIri: '/a/1' }, 'a', NOW).activityIri).toBe('/a/1')
  })

  it('drops an empty anchor and copies a real one', () => {
    expect(newManualFinding({ ...base, anchor: {} }, 'a', NOW).anchor).toBeUndefined()
    expect(newManualFinding({ ...base, anchor: { page: 2 } }, 'a', NOW).anchor).toEqual({ page: 2 })
  })
})

describe('categories', () => {
  it('validates categories', () => {
    for (const c of MANUAL_FINDING_CATEGORIES) expect(isManualCategory(c)).toBe(true)
    expect(isManualCategory('x')).toBe(false)
    expect(isManualCategory(3)).toBe(false)
  })

  it('maps categories to feedback kind and severity', () => {
    expect(feedbackKindOf('positive')).toBe('kudos')
    expect(feedbackKindOf('question')).toBe('question')
    expect(feedbackKindOf('safety')).toBe('suggestion')
    expect(severityOf('positive')).toBe('hint')
    expect(severityOf('question')).toBe('hint')
    expect(severityOf('other')).toBe('hint')
    expect(severityOf('safety')).toBe('should')
    for (const c of MANUAL_FINDING_CATEGORIES) expect(['hint', 'should']).toContain(severityOf(c))
  })
})

describe('anchorLabel', () => {
  it('formats the parts', () => {
    expect(anchorLabel(undefined)).toBeNull()
    expect(anchorLabel({})).toBeNull()
    expect(anchorLabel({ page: 3 })).toBe('S. 3')
    expect(anchorLabel({ sheet: 'Budget', cell: 'B4' })).toBe('Budget, B4')
    expect(anchorLabel({ sheet: 'Budget' })).toBe('Budget')
    expect(anchorLabel({ cell: 'C2' })).toBe('C2')
    expect(anchorLabel({ km: 4.25 })).toBe('km 4.3')
    expect(anchorLabel({ page: 1, label: 'Karte' })).toBe('S. 1 · Karte')
  })
})

describe('manualToFinding', () => {
  const facts = { activities: [{ iri: '/a/1', title: 'Postenlauf' }] } as unknown as CampFacts
  const ctx = { facts, documentNames: { d1: 'Konzept.pdf' }, categoryLabel }
  const rec = (over: Partial<ManualFinding>): ManualFinding => ({
    id: 'manual:1',
    campIri: '/camps/1',
    scope: 'camp',
    category: 'safety',
    comment: 'Kommentar',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  })

  it('maps a camp finding', () => {
    const f = manualToFinding(rec({}), ctx)
    expect(f).toMatchObject({
      id: 'manual:1',
      ruleId: MANUAL_RULE_ID,
      origin: 'manual',
      severity: 'should',
      confidence: 'verified',
      title: 'Label safety',
      message: 'Kommentar',
      scope: 'camp',
      targets: ['/camps/1'],
      source: null,
      override: null,
    })
    expect(f.tags).toContain('kategorie:safety')
  })

  it('maps an activity finding with the activity title as evidence', () => {
    const f = manualToFinding(rec({ scope: 'activity', activityIri: '/a/1', category: 'positive' }), ctx)
    expect(f.scope).toBe('activity')
    expect(f.targets).toEqual(['/a/1'])
    expect(f.severity).toBe('hint')
    expect(f.evidence[0]).toMatchObject({ kind: 'activity', iri: '/a/1', label: 'Postenlauf' })
  })

  it('maps a document finding with anchor label', () => {
    const f = manualToFinding(rec({ scope: 'document', documentId: 'd1', anchor: { page: 2 } }), ctx)
    expect(f.scope).toBe('document')
    expect(f.targets).toEqual(['d1'])
    expect(f.evidence[0]).toMatchObject({ kind: 'document', documentId: 'd1', label: 'Konzept.pdf (S. 2)', anchor: { page: 2 } })
  })
})
