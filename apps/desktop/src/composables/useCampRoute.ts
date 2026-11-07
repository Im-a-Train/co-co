/** Current camp from the route (/lager/:campId/...). Shared by all modules; change with care. */
import { computed, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { campIriFromId } from '@/domain/iri'

export function useCampRoute(): { campId: ComputedRef<string>; campIri: ComputedRef<string> } {
  const route = useRoute()
  const campId = computed(() => {
    const p = route.params.campId
    return Array.isArray(p) ? (p[0] ?? '') : (p ?? '')
  })
  return { campId, campIri: computed(() => campIriFromId(campId.value)) }
}
