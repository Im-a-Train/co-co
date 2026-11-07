/** Persistence of category mappings + coach inputs (tables `mappings`, `coachInputs`). OWNER: data builder. */
import { getDb, nowIso } from '../storage/db'
import type { CategoryMapping, CoachInputs, Iri } from '../types'

export function getMapping(campIri: Iri): Promise<CategoryMapping | null> {
  return getDb()
    .mappings.get(campIri)
    .then((m) => m ?? null)
}

export async function saveMapping(mapping: CategoryMapping): Promise<void> {
  await getDb().mappings.put({ ...mapping, updatedAt: nowIso() })
}

/** Empty inputs (all null / false) for a camp. Pure. */
export function emptyCoachInputs(campIri: Iri, now: Date = new Date()): CoachInputs {
  return {
    campIri,
    isJsCamp: null,
    participantsCount: null,
    participantsJsAgeCount: null,
    minAge: null,
    maxAge: null,
    stufe: null,
    leadersCount: null,
    slrgCount: null,
    lagerleiterAttested: null,
    ndsRegistered: false,
    ndsRegisteredOn: null,
    ndsClosed: false,
    ndsClosedOn: null,
    leihmaterialOrdered: false,
    landeskartenOrdered: false,
    lagerbewilligungDone: false,
    notes: '',
    updatedAt: now.toISOString(),
  }
}

export function getCoachInputs(campIri: Iri): Promise<CoachInputs | null> {
  return getDb()
    .coachInputs.get(campIri)
    .then((i) => i ?? null)
}

export function listCoachInputs(): Promise<CoachInputs[]> {
  return getDb().coachInputs.toArray()
}

export async function saveCoachInputs(inputs: CoachInputs): Promise<void> {
  await getDb().coachInputs.put({ ...inputs, updatedAt: nowIso() })
}
