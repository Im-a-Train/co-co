/** "Feedback erstellen" from a finding: itemFromFinding + saveFeedback, then jump to the feedback tab. */
import type { Router } from 'vue-router'
import { campIdFromIri } from '@/domain/iri'
import { itemFromFinding } from '@/domain/feedback'
import { saveFeedback } from '@/domain/feedback/store'
import type { Finding, Iri } from '@/domain/types'

/** Resolves with null on success, or the (German/technical) error message. Never throws. */
export async function createFeedbackFromFinding(
  router: Router,
  campIri: Iri,
  finding: Finding,
): Promise<string | null> {
  try {
    const item = itemFromFinding(finding, campIri)
    await saveFeedback(item)
    await router.push({
      name: 'camp-feedback',
      params: { campId: campIdFromIri(campIri) },
      query: { item: item.id },
    })
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
