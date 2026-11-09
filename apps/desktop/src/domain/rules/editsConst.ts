/** Allowed enum values for rule edits (mirrors engine.ts; kept separate to avoid importing the engine here). */
export const SEVERITIES_LIST = ['must', 'should', 'hint'] as const
export const CONFIDENCES_LIST = ['verified', 'conflict', 'unverified', 'best-practice', 'heuristic'] as const
export const STATUSES_LIST = ['active', 'retired'] as const
