/**
 * German display names for English role identifiers (pure, display only).
 * Sources: hitobito_pbs event role types (`Event::Camp::Role::X`, `Event::Course::Role::X`) as
 * delivered by MiData when no German `label` is set, and NDS codes (`MAIN_SUPERVISOR`, ...).
 * Rule logic must keep comparing the raw labels; only the UI uses this mapping.
 */

/** Normalised raw role (last `::` segment, lowercase, letters/digits only) -> i18n key suffix of `persons.role.<key>`. */
const ROLE_KEYS: Record<string, string> = {
  // hitobito: Event::Role::Leader = «Hauptleitung», AssistantLeader = «Leitung», Speaker = «Kommunikation».
  leader: 'mainLeader',
  assistantleader: 'leader',
  mainleader: 'mainLeader',
  mainsupervisor: 'mainLeader',
  supervisor: 'leader',
  instructor: 'instructor',
  assistantinstructor: 'assistantInstructor',
  coach: 'coach',
  jscoach: 'coach',
  cook: 'cook',
  kitchen: 'cook',
  helper: 'helper',
  participant: 'participant',
  child: 'child',
  adolescent: 'adolescent',
  treasurer: 'treasurer',
  speaker: 'communication',
  campleader: 'campLeader',
  leadermountainsecurity: 'securityMountain',
  leadersnowsecurity: 'securitySnow',
  leaderwatersecurity: 'securityWater',
  mountainsecurity: 'securityMountain',
  snowsecurity: 'securitySnow',
  watersecurity: 'securityWater',
  unitleader: 'unitLeader',
  communication: 'communication',
  advisor: 'advisor',
  supportingleader: 'supportingLeader',
}

/** i18n key suffix (`persons.role.<key>`) for a known English role / NDS code, or null (show the raw text). */
export function roleLabelKey(raw: string): string | null {
  const last = raw.split('::').pop() ?? raw
  const norm = last.toLowerCase().replace(/[^a-z0-9]/g, '')
  return Object.prototype.hasOwnProperty.call(ROLE_KEYS, norm) ? ROLE_KEYS[norm] : null
}

/** Translate a role with the given `t`; unknown (e.g. already German) labels pass through unchanged. */
export function germanRoleLabel(raw: string, t: (key: string) => string): string {
  const key = roleLabelKey(raw)
  return key ? t(`persons.role.${key}`) : raw
}
