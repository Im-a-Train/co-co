import type { ViewState } from '@/domain/persons/view'

export const STATE_COLOR: Record<ViewState, string> = {
  match: 'success',
  field_diff: 'warning',
  missing_in_nds: 'error',
  only_in_nds: 'info',
  ambiguous: 'warning',
  notRelevant: 'grey',
  notCompared: 'grey',
}
