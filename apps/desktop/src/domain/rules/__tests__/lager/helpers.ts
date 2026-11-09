import type { DocCheckItem, DocCheckResult, SafetyCheckKey } from '@/domain/types'

export const ALL_CHECKS: SafetyCheckKey[] = ['emergencyNumbers', 'hospital', 'crisisContact', 'evacuation', 'badWeather', 'threeByThree', 'firstAid', 'campAddress']

export const checkItems = (found: SafetyCheckKey[]): DocCheckItem[] => ALL_CHECKS.map((key) => ({ key, found: found.includes(key), snippets: [] }))

export const docCheck = (found: SafetyCheckKey[]): DocCheckResult => ({ items: checkItems(found), complete: found.length === ALL_CHECKS.length, checkedAt: '' })

export const ids = (hits: { targets: string[] }[]) => hits.map((h) => h.targets.join('|'))
