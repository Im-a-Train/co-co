import { describe, expect, it } from 'vitest'
import {
  COMMENT_MAX_LENGTH,
  fillTemplate,
  getTemplate,
  itemFromFinding,
  itemFromFindingGroup,
  postedActivityCount,
  postedItems,
  postedSinceLastSend,
  previewItems,
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
    expect(r.body.startsWith('*Allgemein*\n🌟 Tolles Programm!\n❓ Wer leitet den Posten?')).toBe(true)
    expect(r.body).toContain('_1.2 Postenlauf_\n⚠️ Bitte Sicherheit ergänzen.')
    expect(r.body.indexOf('🌟')).toBeLessThan(r.body.indexOf('❓'))
    expect(r.body.indexOf('❓')).toBeLessThan(r.body.indexOf('⚠️'))
  })
  it('email has subject and body from template', () => {
    const r = renderFeedback(items, 'email', { ...ctx, templateId: 'grobprogramm' })
    expect(r.subject).toBe('Feedback Grobprogramm Auf in die Berge')
    expect(r.body).toContain('Auf in die Berge')
    expect(r.body).toContain('- Kudos: Tolles Programm!')
    expect(r.body).toContain('Coach C')
    expect(r.body).not.toContain('{{')
    expect(r.body).not.toContain('Betreff:')
  })
  it('adds one line about the eCamp comments in every channel, before the closing', () => {
    expect(renderFeedback(items, 'whatsapp', { ...ctx, postedCount: 0 }).body).not.toContain('direkt in eCamp')
    const wa = renderFeedback(items, 'whatsapp', { ...ctx, postedCount: 1 })
    expect(wa.body.endsWith('Zu einer Aktivität habe ich direkt in eCamp kommentiert.')).toBe(true)
    const plain = renderFeedback(items, 'plain', { ...ctx, postedCount: 3 })
    expect(plain.body).toContain('Zu 3 Aktivitäten habe ich direkt in eCamp kommentiert.')
    const mail = renderFeedback(items, 'email', { ...ctx, templateId: 'auflagen', postedCount: 2 })
    expect(mail.body.indexOf('Zu 2 Aktivitäten')).toBeGreaterThan(mail.body.indexOf('Bitte Sicherheit ergänzen.'))
    expect(mail.body.indexOf('Zu 2 Aktivitäten')).toBeLessThan(mail.body.indexOf('Gebt mir kurz Bescheid'))
  })
  it('plain without template lists sections only', () => {
    const r = renderFeedback(items, 'plain', ctx)
    expect(r.subject).toBeNull()
    expect(r.body.startsWith('Allgemein:\n- Kudos: Tolles Programm!')).toBe(true)
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
    expect(it2.text).toBe('Keine Sicherheitsüberlegungen. Wie wollt ihr das lösen?')
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


describe('itemFromFinding texts', () => {
  const base = { id: 'R:x', ruleId: 'R', severity: 'hint', title: 'Titel', scope: 'camp', targets: ['/api/camps/c1'], evidence: [] }
  it('uses the bare message for non-must findings, adding a full stop', () => {
    const t = itemFromFinding({ ...base, message: 'Das Programm ist dicht' } as unknown as Finding, '/api/camps/c1').text
    expect(t).toBe('Das Programm ist dicht.')
  })
  it('adds a full stop after a closing parenthesis', () => {
    const t = itemFromFinding({ ...base, message: 'Zu wenig Zeit (siehe 1.2)' } as unknown as Finding, '/api/camps/c1').text
    expect(t).toBe('Zu wenig Zeit (siehe 1.2).')
  })
  it('keeps existing sentence punctuation', () => {
    expect(itemFromFinding({ ...base, message: 'Wirklich?' } as unknown as Finding, '/api/camps/c1').text).toBe('Wirklich?')
  })
  it('prefers the rule feedbackText', () => {
    expect(itemFromFinding({ ...base, message: 'm', feedbackText: 'Ihr Lieben, bitte ergänzen.' } as unknown as Finding, '/api/camps/c1').text).toBe('Ihr Lieben, bitte ergänzen.')
  })
})

describe('itemFromFindingGroup', () => {
  const mk = (n: number, severity: 'must' | 'should' = 'should') =>
    ({ id: `R:d${n}`, ruleId: 'R', severity, title: 'T', message: `Keine Mahlzeiten am Tag ${n}.`, scope: 'day', targets: [`/api/days/d${n}`], evidence: [] }) as unknown as Finding
  const group = (findings: Finding[]) => ({ key: 'group:R', ruleId: 'R', severity: findings[0]!.severity, findings, dates: [] as string[] })
  it('creates one item linked to all findings with the dates sentence', () => {
    const it2 = itemFromFindingGroup(group([mk(1), mk(2), mk(3)]), '/api/camps/c1', '24.01. bis 26.01.', new Date('2026-02-03T04:05:06Z'))
    expect(it2.findingId).toBe('R:d1')
    expect(it2.findingIds).toEqual(['R:d1', 'R:d2', 'R:d3'])
    expect(it2.scope).toBe('camp')
    expect(it2.text).toBe('Keine Mahlzeiten am Tag 1. Das betrifft 3 Tage: 24.01. bis 26.01.')
    expect(it2.createdAt).toBe('2026-02-03T04:05:06.000Z')
  })
  it('becomes a Muss item with the Muss wording when any finding is a Muss (dates before the question)', () => {
    const it2 = itemFromFindingGroup(group([mk(1), mk(2, 'must')]), '/api/camps/c1', '24.01., 25.01.')
    expect(it2.kind).toBe('must')
    expect(it2.text).toBe('Keine Mahlzeiten am Tag 1. Das betrifft 2 Tage: 24.01., 25.01. Wie wollt ihr das lösen?')
    expect(lintItems([it2])).toEqual([])
  })
  it('appends the dates sentence to the rule feedbackText', () => {
    const withText = (n: number) => ({ ...mk(n), feedbackText: 'Tragt ihr die Fixpunkte noch ein?' }) as Finding
    const it2 = itemFromFindingGroup(group([withText(1), withText(2)]), '/api/camps/c1', 'Fr 24.01. – Sa 25.01.')
    expect(it2.text).toBe('Tragt ihr die Fixpunkte noch ein? Das betrifft 2 Tage: Fr 24.01. – Sa 25.01.')
    expect(it2.kind).toBe('suggestion')
  })
  it('uses the rule group text with {n} and {dates} filled and no extra «Das betrifft» sentence', () => {
    const withGroup = (n: number) =>
      ({ ...mk(n), feedbackText: 'Am 24.01.2031 reicht es nicht.', feedbackTextGroup: 'An {n} Tagen ({dates}) reicht das Programm nicht. Wie wollt ihr es anpassen?' }) as Finding
    const it2 = itemFromFindingGroup(group([withGroup(1), withGroup(2), withGroup(3)]), '/api/camps/c1', '25.–27.01.2031')
    expect(it2.text).toBe('An 3 Tagen (25.–27.01.2031) reicht das Programm nicht. Wie wollt ihr es anpassen?')
    expect(it2.text).not.toContain('Das betrifft')
    expect(it2.findingIds).toHaveLength(3)
  })
  it('group text: {n} counts the listed days, a missing dates label drops «({dates})», a Muss keeps its own question', () => {
    const withGroup = (n: number, severity: 'must' | 'should' = 'should') =>
      ({ ...mk(n, severity), feedbackTextGroup: 'An {n} Tagen ({dates}) sind Pausen zu kurz. Könnt ihr mehr Zeit einplanen?' }) as Finding
    // A combined end-day hit covers two dates: three dates from two findings.
    const g = { ...group([withGroup(1), withGroup(2, 'must')]), dates: ['2031-01-24', '2031-01-25', '2031-01-30'] }
    const it2 = itemFromFindingGroup(g, '/api/camps/c1', '24., 25., 30.01.2031')
    expect(it2.text).toBe('An 3 Tagen (24., 25., 30.01.2031) sind Pausen zu kurz. Könnt ihr mehr Zeit einplanen?')
    expect(it2.kind).toBe('must')
    expect(lintItems([it2])).toEqual([])
    expect(itemFromFindingGroup(group([withGroup(1), withGroup(2)]), '/api/camps/c1', '').text).toBe(
      'An 2 Tagen sind Pausen zu kurz. Könnt ihr mehr Zeit einplanen?',
    )
  })
  it('a group of one equals itemFromFinding (no findingIds)', () => {
    const it2 = itemFromFindingGroup(group([mk(1)]), '/api/camps/c1', 'x')
    expect(it2.findingIds).toBeUndefined()
    expect(it2.text).toBe('Keine Mahlzeiten am Tag 1.')
  })
  it('throws on an empty group', () => {
    expect(() => itemFromFindingGroup(group([]) as never, '/api/camps/c1', '')).toThrow()
  })
})

describe('previewItems / postedItems', () => {
  const items = [item({ id: 'd', status: 'draft' }), item({ id: 's', status: 'sent' }), item({ id: 'p', status: 'posted' })]
  it('default: drafts only', () => expect(previewItems(items).map((i) => i.id)).toEqual(['d']))
  it('includeSent adds sent, never posted', () => expect(previewItems(items, { includeSent: true }).map((i) => i.id)).toEqual(['d', 's']))
  it('empty input', () => expect(previewItems([])).toEqual([]))
  it('postedItems returns posted only', () => expect(postedItems(items).map((i) => i.id)).toEqual(['p']))
  it('postedSinceLastSend: only posts after the newest sent item (earlier ones were named in that message)', () => {
    const at = (h: number) => `2026-01-0${h}T10:00:00.000Z`
    const list = [
      item({ id: 'old', status: 'posted', activityIri: '/api/activities/a1', updatedAt: at(1) }),
      item({ id: 'sent', status: 'sent', updatedAt: at(2) }),
      item({ id: 'new1', status: 'posted', activityIri: '/api/activities/a2', updatedAt: at(3) }),
      item({ id: 'new2', status: 'posted', activityIri: '/api/activities/a2', updatedAt: at(4) }),
      item({ id: 'draft', status: 'draft', updatedAt: at(5) }),
    ]
    expect(postedSinceLastSend(list).map((i) => i.id)).toEqual(['new1', 'new2'])
    expect(postedSinceLastSend(list.filter((i) => i.status !== 'sent')).map((i) => i.id)).toEqual(['old', 'new1', 'new2'])
    // Two posts on one activity are one activity in the leaders' line.
    expect(postedActivityCount(postedSinceLastSend(list))).toBe(1)
    expect(postedActivityCount(list)).toBe(2)
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
      expect(r.body).toContain(`1.2 Postenlauf (eCamp: ${short})\n- Auflage: Bitte Sicherheit ergänzen.`)
      expect(r.body).not.toContain(url)
      expect(r.body.match(/eCamp:/g)).toHaveLength(1)
    }
  })
  it('plain fallback uses the long URL when no short URL exists', () => {
    expect(renderFeedback(items, 'plain', lctx).body).toContain(`1.2 Postenlauf (eCamp: ${url})`)
  })
  it('whatsapp has no URL at all and no html', () => {
    const r = renderFeedback(items, 'whatsapp', sctx)
    expect(r.body).toContain('_1.2 Postenlauf_\n⚠️ Bitte Sicherheit ergänzen.')
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
    expect(renderFeedback(items, 'whatsapp', { ...nctx, includeLinks: false }).body).toContain('_1.2/3.4 Postenlauf_\n⚠️ Bitte')
    expect(renderFeedback(items, 'plain', nctx).body).toContain('1.2/3.4 Postenlauf (eCamp: ')
    expect(renderFeedback(items, 'email', nctx).html).toContain(`<a href="${url}">1.2/3.4 Postenlauf</a>`)
    // no number -> title only
    expect(renderFeedback(items, 'whatsapp', { ...nctx, activityNumbers: {} }).body).toContain('_Postenlauf_')
  })
  it('the eCamp-comments line is also in the linked html, after the items', () => {
    const r = renderFeedback(items, 'email', { ...sctx, templateId: 'auflagen', postedCount: 2 })
    expect(r.html).toContain('Bitte Sicherheit ergänzen.<br><br>Zu 2 Aktivitäten habe ich direkt in eCamp kommentiert.')
    expect(r.html!.indexOf('Zu 2 Aktivitäten')).toBeLessThan(r.html!.indexOf('Gebt mir kurz Bescheid'))
  })
  it('email/plain html links the title and keeps the long URL only in href', () => {
    for (const ch of ['plain', 'email'] as const) {
      const r = renderFeedback(items, ch, sctx)
      expect(r.html).toContain(`<a href="${url}">1.2 Postenlauf</a><br>- Auflage: Bitte Sicherheit ergänzen.`)
      expect(r.html).toMatch(/<b>Allgemein:<\/b><br>- Kudos: Tolles Programm!<br><br><a /)
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
    expect(r.html).toContain(`<a href="${url}">In eCamp öffnen</a><br>- Vorschlag: Hm`)
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
