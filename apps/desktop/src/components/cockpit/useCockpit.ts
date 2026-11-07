/** Shared setup of the three cockpit views: handles + tolerant loading (contract stubs may throw). */
import { onMounted } from 'vue'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { useCampSettings } from '@/composables/useCampSettings'
import { useFindings } from '@/composables/useFindings'

export function useCockpit() {
  const { campIri } = useCampRoute()
  const factsHandle = useCampFacts(campIri)
  const settings = useCampSettings(campIri)
  const findingsHandle = useFindings(campIri)

  onMounted(async () => {
    try {
      await settings.load()
    } catch {
      /* not implemented yet or storage unavailable: views fall back to NONE mapping */
    }
  })

  return { campIri, factsHandle, settings, findingsHandle }
}

/** Runs an action that may throw (stub or storage error); returns the message or null. */
export async function tryAction(fn: () => Promise<unknown> | unknown): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
