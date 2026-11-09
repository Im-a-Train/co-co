/**
 * Safety-concept document check config (packs/jslst/keywords/docCheck.yaml, catalog v2 §3.12):
 * labels, emergency numbers and regex patterns used by documents/checkSafetyConcept and SAFE-DOC-01.
 */
import { parse } from 'yaml'
import type { SafetyCheckKey } from '../../types'

const files = import.meta.glob('../packs/jslst/keywords/docCheck.yaml', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

export interface DocCheckConfig {
  labels: Record<SafetyCheckKey, string>
  emergencyNumbers: { numbers: string[]; required: string[]; minCount: number }
  /** Pattern per key except emergencyNumbers / campAddress (flags gi). */
  patterns: Partial<Record<SafetyCheckKey, RegExp>>
  coordinates: RegExp
}

export function parseDocCheckYaml(text: string): DocCheckConfig {
  const raw = parse(text) as Record<string, unknown>
  const labels = raw.labels as Record<SafetyCheckKey, string>
  const en = raw.emergencyNumbers as { numbers: unknown[]; required: unknown[]; minCount: number }
  const patterns: Partial<Record<SafetyCheckKey, RegExp>> = {}
  for (const [k, v] of Object.entries((raw.patterns ?? {}) as Record<string, string>)) patterns[k as SafetyCheckKey] = new RegExp(v, 'gi')
  return {
    labels,
    emergencyNumbers: { numbers: en.numbers.map(String), required: en.required.map(String), minCount: Number(en.minCount) },
    patterns,
    coordinates: new RegExp(String(raw.coordinates), 'gi'),
  }
}

const text = Object.values(files)[0]
if (!text) throw new Error('packs/jslst/keywords/docCheck.yaml fehlt')

export const DOC_CHECK: DocCheckConfig = parseDocCheckYaml(text)
