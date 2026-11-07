/**
 * Tiny refresh signal: the UI increments `midataVersion` after saving/clearing a MiData record
 * (or accepting MiData fields), so useFindings re-reads the aggregate and re-evaluates.
 */
import { ref } from 'vue'

export const midataVersion = ref(0)

export function bumpMidata(): void {
  midataVersion.value++
}
