import { describe, expect, it } from 'vitest'
import {
  COMMENT_MAX_LENGTH,
  fillTemplate,
  getTemplate,
  itemFromFinding,
  lintItems,
  orderItems,
  renderFeedback,
  splitTemplate,
  toCommentHtmlParts,
  TEMPLATE_IDS,
} from '../index'
import type { FeedbackItem, Finding } from '../../types'

function item(p: Partial<FeedbackItem> & { id: string }): FeedbackItem {
  return {
    campIri: '/api/camps/c1',
    scope: 'camp',
    kind: 'suggestion',
    text: 'Text',
    status: 'draft',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    ...p,
  }
}

const ctx = { campTitle: 'Auf in die Berge', activityTitles: { '/api/activities/a1': '1.2 Postenlauf' }, coachName: 'Coach C' }

describe('orderItems', () => {
  it('sorts kudos -> must -> suggestion -> question, camp before activity, then createdAt', () => {
    const items = [
      item({ id: 'q', kind: 'question' }),
      item({ id: 's2', kind: 'suggestion', scope: 'activity', activityIri: '/api/activities/a1' }),
      item({ id: 's1', kind: 'suggestion', createdAt: '2026-01-02T00:00:00.000Z' }),
      item({ id: 'm', kind: 'must' }),
      item({ id: 'k', kind: 'kudos' }),
    ]
    expect(orderItems(items).map((i) => i.id)).toEqual(['k', 'm', 's1', 's2', 'q'])
  })
  it('is stable and does not mutate', () => {
    const items = [item({ id: 'a' }), item({ id: 'b' })]
    expect(orderItems(items).map((i) => i.id)).toEqual(['a', 'b'])
    expect(items.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('renderFeedback', () => {
  const items = [
    item({ id: '1', kind: 'question', text: 'Wer leitet den Posten?' }),
    item({ id: '2', kind: 'kudos', text: 'Tolles Programm!' }),
    item({ id: '3', kind: 'must', scope: 'activity', activityIri: '/api/activities/a1', text: 'Bitte Sicherheit ergänzen.' }),
  ]
  it('whatsapp uses bold and emoji bullets', () => {
    const r = renderFeedback(items, 'whatsapp', ctx)
    expect(r.subject).toBeNull()
    expect(r.body).toContain('*Das gefällt uns*')
    expect(r.body).toContain('🌟 Tolles Programm!')
    expect(r.body).toContain('⚠️ *1.2 Postenlauf*: Bitte Sicherheit ergänzen.')
    expect(r.body.indexOf('🌟')).toBeLessThan(r.body.indexOf('⚠️'))
    expect(r.body.indexOf('⚠️')).toBeLessThan(r.body.indexOf('❓'))
  })
  it('email has subject and body from template', () => {
    const r = renderFeedback(items, 'email', { ...ctx, templateId: 'grobprogramm' })
    expect(r.subject).toBe('Feedback Grobprogramm Auf in die Berge')
    expect(r.body).toContain('Auf in die Berge')
    expect(r.body).toContain('- Tolles Programm!')
    expect(r.body).toContain('Coach C')
    expect(r.body).not.toContain('{{')
    expect(r.body).not.toContain('Betreff:')
  })
  it('plain without template lists sections only', () => {
    const r = renderFeedback(items, 'plain', ctx)
    expect(r.subject).toBeNull()
    expect(r.body.startsWith('Das gefällt uns:')).toBe(true)
  })
  it('skips empty items', () => {
    expect(renderFeedback([item({ id: 'x', text: '  ' })], 'plain', ctx).body).toBe('')
  })
  it('custom template override works', () => {
    const r = renderFeedback(items, 'plain', { ...ctx, template: 'Betreff: S {{camp}}\n\nHi\n{{items}}' })
    expect(r.body.startsWith('S Auf in die Berge\n\nHi')).toBe(true)
  })
})

describe('templates', () => {
  it('all templates exist with subject and items placeholder', () => {
    for (const id of TEMPLATE_IDS) {
      const t = getTemplate(id)
      expect(t, id).toContain('{{items}}')
      expect(splitTemplate(t).subject, id).toBeTruthy()
    }
  })
  it('fillTemplate blanks unknown keys', () => {
    expect(fillTemplate('a {{x}} b {{y}}', { x: '1' })).toBe('a 1 b ')
  })
})

describe('lintItems', () => {
  it('flags must without question or next step', () => {
    const l = lintItems([
      item({ id: 'a', kind: 'must', text: 'Das geht so nicht.' }),
      item({ id: 'b', kind: 'must', text: 'Wie löst ihr das?' }),
      item({ id: 'c', kind: 'must', text: 'Bitte ergänzen.' }),
      item({ id: 'd', kind: 'kudos', text: 'Super.' }),
    ])
    expect(l).toEqual([{ itemId: 'a', code: 'must-without-next-step' }])
  })
  it('flags empty and too long activity items', () => {
    const l = lintItems([
      item({ id: 'e', text: ' ' }),
      item({ id: 'f', scope: 'activity', text: 'x'.repeat(1100) }),
      item({ id: 'g', scope: 'camp', text: 'x'.repeat(1100) }),
    ])
    expect(l).toEqual([
      { itemId: 'e', code: 'empty-text' },
      { itemId: 'f', code: 'too-long-for-comment' },
    ])
  })
})

describe('toCommentHtmlParts', () => {
  it('escapes html and converts newlines', () => {
    expect(toCommentHtmlParts('a <b> & c\nd')).toEqual(['a &lt;b&gt; &amp; c<br>d'])
  })
  it('returns [] for empty', () => {
    expect(toCommentHtmlParts('  ')).toEqual([])
  })
  it('splits long text into parts <= 1024 with prefixes', () => {
    const text = Array.from({ length: 400 }, (_, i) => `wort${i}`).join(' ')
    const parts = toCommentHtmlParts(text)
    expect(parts.length).toBeGreaterThan(1)
    for (const [i, p] of parts.entries()) {
      expect(p.length).toBeLessThanOrEqual(COMMENT_MAX_LENGTH)
      expect(p.startsWith(`(${i + 1}/${parts.length}) `)).toBe(true)
    }
    const joined = parts.map((p) => p.replace(/^\(\d+\/\d+\) /, '')).join(' ')
    expect(joined).toBe(text)
  })
  it('splits unbroken text and escaped chars within limit', () => {
    const parts = toCommentHtmlParts('<'.repeat(2000), 200)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(200)
    expect(parts.join('').replace(/\(\d+\/\d+\) /g, '').replace(/&lt;/g, '').length).toBe(0)
  })
})

describe('itemFromFinding', () => {
  const finding = {
    id: 'CMP-ACT-03:/api/activities/a1',
    ruleId: 'CMP-ACT-03',
    severity: 'must',
    title: 'Sicherheit fehlt',
    message: 'Keine Sicherheitsüberlegungen.',
    scope: 'activity',
    targets: ['/api/activities/a1'],
  } as unknown as Finding
  it('creates a must draft for activity findings with a question', () => {
    const it2 = itemFromFinding(finding, '/api/camps/c1', new Date('2026-02-03T04:05:06Z'))
    expect(it2).toMatchObject({
      scope: 'activity',
      activityIri: '/api/activities/a1',
      kind: 'must',
      status: 'draft',
      ruleId: 'CMP-ACT-03',
      findingId: finding.id,
      createdAt: '2026-02-03T04:05:06.000Z',
    })
    expect(it2.text).toContain('Sicherheit fehlt')
    expect(lintItems([it2])).toEqual([])
  })
  it('creates camp-scope suggestion for non-must', () => {
    const f = { ...finding, severity: 'hint', scope: 'camp', targets: ['/api/camps/c1'] } as Finding
    const it2 = itemFromFinding(f, '/api/camps/c1')
    expect(it2.kind).toBe('suggestion')
    expect(it2.scope).toBe('camp')
    expect(it2.activityIri).toBeUndefined()
  })
})
