import { describe, expect, it } from 'vitest'
import type { CollaboratorFact } from '../../types'
import { buildRedactor } from '../redact'

function collab(p: Partial<CollaboratorFact>): CollaboratorFact {
  return {
    iri: '/api/camp_collaborations/1',
    userIri: null,
    role: 'member',
    status: 'established',
    displayName: '?',
    nickname: null,
    firstname: null,
    surname: null,
    abbreviation: null,
    isCurrentUser: false,
    ...p,
  } as CollaboratorFact
}

const r = buildRedactor([
  collab({ displayName: 'Flinke', nickname: 'Flinke', firstname: 'Anna', surname: 'Meier' }),
  collab({ iri: '/api/camp_collaborations/2', displayName: 'Bär', nickname: 'Bär', firstname: 'Ben', surname: 'Keller' }),
])

describe('redact', () => {
  it('replaces names and nicknames stably', () => {
    const res = r.redact('Anna Meier und Bär leiten, Flinke hilft. Ben Keller auch.')
    expect(res.text).toBe('Leiter A und Leiter B leiten, Leiter A hilft. Leiter B auch.')
    expect(res.redactions.every((x) => x.kind === 'name')).toBe(true)
  })

  it('does not replace inside other words', () => {
    expect(r.redact('Bärenhöhle und Annahme').text).toBe('Bärenhöhle und Annahme')
  })

  it('removes emails, phones, AHV and addresses', () => {
    const t =
      'Mail anna@example.ch, Tel +41 79 123 45 67 oder 079 123 45 67, AHV 756.1234.5678.97, Hauptstrasse 12, 3000 Bern.'
    const res = r.redact(t)
    expect(res.text).not.toMatch(/example|123 45|756|Hauptstrasse|3000/)
    expect(res.text).toContain('[E-Mail]')
    expect(res.text).toContain('[AHV-Nr.]')
    expect(res.text).toContain('[Adresse]')
    expect(res.redactions.filter((x) => x.kind === 'phone')).toHaveLength(2)
  })

  it('keeps emergency numbers and times', () => {
    const t = 'Notruf 144, Rega 1414, 08:00 bis 12:30, 240 Minuten'
    expect(r.redact(t).text).toBe(t)
  })

  it('redactZoned marks yellow, passes green, throws on red', () => {
    const y = r.redactZoned({ zone: 'yellow', value: 'Hallo Anna' })
    expect(y.redacted).toBe(true)
    expect(y.value).toBe('Hallo Leiter A')
    expect(r.redactZoned({ zone: 'green', value: 'Anna' }).value).toBe('Anna')
    expect(() => r.redactZoned({ zone: 'red', value: 'x' })).toThrow()
  })

  it('deredacts labels for display', () => {
    expect(r.deredact('Leiter B soll das übernehmen, Leiter Z nicht.')).toBe('Bär soll das übernehmen, Leiter Z nicht.')
  })

  it('redacts common Swiss phone formats, unicode e-mails and inflected names', () => {
    for (const ph of ['079/123 45 67', '079-123-45-67', '+41-79-123-45-67', '+41 (0)79 123 45 67', '+41 79 123 45 67', '079 123 45 67'])
      expect(r.redact(`Tel ${ph} ok`).text).toBe('Tel [Telefon] ok')
    expect(r.redact('müller@bluewin.ch').text).toBe('[E-Mail]')
    expect(r.redact('Flinkes Gruppe und Bärs Aktivität').text).toBe('Leiter A Gruppe und Leiter B Aktivität')
  })
})
