import { describe, expect, it } from 'vitest'
import { germanRoleLabel, roleLabelKey } from '../roleLabels'

describe('roleLabelKey', () => {
  it('maps hitobito type segments, full type strings and NDS codes', () => {
    expect(roleLabelKey('AssistantLeader')).toBe('leader')
    expect(roleLabelKey('Event::Camp::Role::AssistantLeader')).toBe('leader')
    expect(roleLabelKey('Event::Camp::Role::Leader')).toBe('mainLeader')
    expect(roleLabelKey('Speaker')).toBe('communication')
    expect(roleLabelKey('cook')).toBe('cook')
    expect(roleLabelKey('LeaderMountainSecurity')).toBe('securityMountain')
    expect(roleLabelKey('MAIN_SUPERVISOR')).toBe('mainLeader')
    expect(roleLabelKey('JS_COACH')).toBe('coach')
    expect(roleLabelKey('CHILD')).toBe('child')
  })
  it('returns null for unknown or German labels', () => {
    expect(roleLabelKey('Hauptleitung')).toBeNull()
    expect(roleLabelKey('toString')).toBeNull()
    expect(roleLabelKey('')).toBeNull()
  })
})

describe('germanRoleLabel', () => {
  const t = (k: string) => `T(${k})`
  it('translates known and passes through unknown', () => {
    expect(germanRoleLabel('Helper', t)).toBe('T(persons.role.helper)')
    expect(germanRoleLabel('Küche', t)).toBe('Küche')
  })
})
