/**
 * Tiny refresh signal: the UI increments `ndsVersion` after saving/clearing an NDS record
 * (or accepting NDS fields), so useFindings re-reads the aggregate and re-evaluates.
 */
import { ref } from 'vue'

export const ndsVersion = ref(0)

export function bumpNds(): void {
  ndsVersion.value++
}
