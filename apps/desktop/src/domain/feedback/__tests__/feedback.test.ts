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
  it('marks findings that quote MiData as redDerived', () => {
    const f = { ...finding, tags: ['midata'], message: 'Keine Wasser-Qualifikation (Quelle: MiData, Stand 01.06.2026)' } as Finding
    expect(itemFromFinding(f, '/api/camps/c1').redDerived).toBe(true)
    expect(itemFromFinding(finding, '/api/camps/c1').redDerived).toBeUndefined()
  })
  it('creates camp-scope suggestion for non-must', () => {
    const f = { ...finding, severity: 'hint', scope: 'camp', targets: ['/api/camps/c1'] } as Finding
    const it2 = itemFromFinding(f, '/api/camps/c1')
    expect(it2.kind).toBe('suggestion')
    expect(it2.scope).toBe('camp')
    expect(it2.activityIri).toBeUndefined()
  })
})


describe('eCamp links', () => {
  const url = 'https://dev.ecamp3.ch/camps/c1/Berge/program/activity/a1/s1/Postenlauf'
  const lctx = { ...ctx, activityUrls: { '/api/activities/a1': url } }
  const items = [
    item({ id: '1', kind: 'must', scope: 'activity', activityIri: '/api/activities/a1', text: 'Bitte Sicherheit ergänzen.' }),
    item({ id: '2', kind: 'kudos', text: 'Tolles Programm!' }),
  ]
  const short = 'https://dev.ecamp3.ch/camps/c1/-/program/activity/a1'
  const sctx = { ...lctx, activityShortUrls: { '/api/activities/a1': short } }
  it('plain and email keep a one-line fallback with the short URL', () => {
    for (const ch of ['plain', 'email'] as const) {
      const r = renderFeedback(items, ch, sctx)
      expect(r.body).toContain(`- 1.2 Postenlauf: Bitte Sicherheit ergänzen. (eCamp: ${short})`)
      expect(r.body).not.toContain(url)
      expect(r.body.match(/eCamp:/g)).toHaveLength(1)
    }
  })
  it('plain fallback uses the long URL when no short URL exists', () => {
    expect(renderFeedback(items, 'plain', lctx).body).toContain(`(eCamp: ${url})`)
  })
  it('whatsapp has no URL at all and no html', () => {
    const r = renderFeedback(items, 'whatsapp', sctx)
    expect(r.body).toContain('⚠️ *1.2 Postenlauf*: Bitte Sicherheit ergänzen.')
    expect(r.body).not.toContain('http')
    expect(r.body).not.toContain('eCamp:')
    expect(r.html).toBeNull()
  })
  it('block numbers prefix the title in whatsapp, plain fallback and html', () => {
    const nctx = {
      ...sctx,
      activityTitles: { '/api/activities/a1': 'Postenlauf' },
      activityNumbers: { '/api/activities/a1': '1.2/3.4' },
    }
    expect(renderFeedback(items, 'whatsapp', { ...nctx, includeLinks: false }).body).toContain('⚠️ *1.2/3.4 Postenlauf*: Bitte')
    expect(renderFeedback(items, 'plain', nctx).body).toContain('- 1.2/3.4 Postenlauf: Bitte')
    expect(renderFeedback(items, 'email', nctx).html).toContain(`<a href="${url}">1.2/3.4 Postenlauf</a>`)
    // no number -> title only
    expect(renderFeedback(items, 'whatsapp', { ...nctx, activityNumbers: {} }).body).toContain('*Postenlauf*:')
  })
  it('email/plain html links the title and keeps the long URL only in href', () => {
    for (const ch of ['plain', 'email'] as const) {
      const r = renderFeedback(items, ch, sctx)
      expect(r.html).toContain(`- <a href="${url}">1.2 Postenlauf</a>: Bitte Sicherheit ergänzen.`)
      expect(r.html).toMatch(/<b>[^<]+:<\/b><br>- <a /)
      expect(r.html).toContain('<br>')
    }
  })
  it('html escapes titles, text, href and template parts', () => {
    const evil = 'https://x.ch/a?b=1&c="2"'
    const r = renderFeedback(
      [item({ id: 'e', kind: 'must', scope: 'activity', activityIri: '/api/activities/a1', text: 'A & B <i>"q"</i>\'s' })],
      'email',
      {
        campTitle: 'Camp <b>&',
        activityTitles: { '/api/activities/a1': '<script>alert(1)</script> & Co' },
        activityUrls: { '/api/activities/a1': evil },
        template: 'Betreff: S\n\nHallo {{camp}}\n\n{{items}}\n\nGruss {{coach}}',
        coachName: '<c>',
      },
    )
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('<a href="https://x.ch/a?b=1&amp;c=&quot;2&quot;">&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co</a>')
    expect(r.html).toContain('A &amp; B &lt;i&gt;&quot;q&quot;&lt;/i&gt;&#39;s')
    expect(r.html).toContain('Hallo Camp &lt;b&gt;&amp;<br><br>')
    expect(r.html).toContain('Gruss &lt;c&gt;')
    expect(r.html).not.toContain('\u0000')
    expect(r.subject).toBe('S')
  })
  it('titleless linked item gets an "In eCamp öffnen" anchor', () => {
    const r = renderFeedback(
      [item({ id: 'n', scope: 'activity', activityIri: '/api/activities/zz', text: 'Hm' })],
      'plain',
      { ...ctx, activityUrls: { '/api/activities/zz': url } },
    )
    expect(r.html).toContain(`- Hm <a href="${url}">In eCamp öffnen</a>`)
  })
  it('html is null without links, with includeLinks=false and for camp items', () => {
    expect(renderFeedback(items, 'email', ctx).html).toBeNull()
    expect(renderFeedback(items, 'email', { ...sctx, includeLinks: false }).html).toBeNull()
    expect(renderFeedback([item({ id: 'c', text: 'Lager' })], 'plain', sctx).html).toBeNull()
  })
  it('includeLinks=false and missing URL render without link', () => {
    expect(renderFeedback(items, 'plain', { ...lctx, includeLinks: false }).body).not.toContain('http')
    expect(renderFeedback(items, 'plain', ctx).body).not.toContain('http')
    expect(renderFeedback(items, 'plain', { ...lctx, activityUrls: {} }).body).not.toContain('http')
  })
  it('camp-scope items never get a link', () => {
    const r = renderFeedback([item({ id: 'c', activityIri: '/api/activities/a1', text: 'Lager' })], 'plain', lctx)
    expect(r.body).not.toContain('http')
  })
  it('eCamp comments stay without the link', () => {
    expect(toCommentHtmlParts('Bitte Sicherheit ergänzen.')).toEqual(['Bitte Sicherheit ergänzen.'])
  })
})
