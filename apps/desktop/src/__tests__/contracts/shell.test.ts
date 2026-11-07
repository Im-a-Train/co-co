/** Contract checks for shared infrastructure. FROZEN (architect). */
import { describe, expect, it } from 'vitest'
import { deepMerge, feedbackTemplates, messages } from '@/locales/messages'
import { CocoDb, TABLE_NAMES } from '@/domain/storage/db'
import { mergeSettings } from '@/domain/storage/settings'
import { campIdFromIri, campIriFromId, idFromIri } from '@/domain/iri'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'

describe('i18n messages', () => {
  it('merges all German area files and keeps M0 keys', () => {
    const de = messages.de as Record<string, Record<string, unknown>>
    expect(de.app.name).toBe('co-co')
    expect((de.session as Record<string, unknown>).logout).toBe('Abmelden')
    expect(de.nav.camps).toBe('Meine Lager')
    for (const area of ['feedback', 'documents', 'rounds', 'backup', 'ai', 'settings', 'findings', 'cockpit', 'rules']) {
      expect(de[area], area).toBeTypeOf('object')
    }
  })

  it('rejects duplicate leaf keys', () => {
    expect(() => deepMerge({ a: { b: 'x' } }, { a: { b: 'y' } })).toThrow(/a\.b/)
  })

  it('loads feedback templates', () => {
    expect(Object.keys(feedbackTemplates)).toEqual(
      expect.arrayContaining(['de/grobprogramm', 'de/programmbesprechung', 'de/auflagen', 'de/nach-dem-lagerbesuch', 'de/abschluss']),
    )
  })
})

describe('db schema', () => {
  it('TABLE_NAMES matches the Dexie schema', () => {
    const db = new CocoDb('coco-contract-test')
    expect(db.tables.map((t) => t.name).sort()).toEqual([...TABLE_NAMES].sort())
  })
})

describe('settings + iri helpers', () => {
  it('fills defaults', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_APP_SETTINGS)
    expect(mergeSettings({ ai: { enabled: true, model: 'claude-opus-5-5' } }).gpx.paceLkmPerHour).toBe(4)
  })

  it('converts camp ids', () => {
    expect(campIriFromId('70ca971c992f')).toBe('/api/camps/70ca971c992f')
    expect(campIdFromIri('/api/camps/70ca971c992f')).toBe('70ca971c992f')
    expect(idFromIri('/api/content_node/single_texts/aa07?x=1')).toBe('aa07')
  })
})
