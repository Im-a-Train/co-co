/**
 * Per-table encryption config: the allowlist of fields that stay PLAINTEXT in IndexedDB (primary key and
 * indexed fields). Everything else goes into the encrypted `_enc` envelope (ADR 0009, plan section 4).
 * Every table in TABLE_NAMES needs an entry (enforced by contracts/encryptionGuard.test.ts and at db open).
 * Plaintext metadata is limited to opaque ids (camp IRIs, finding ids), `rounds.number` and `aiLog.at`.
 */
export interface TableEncryptionConfig {
  /** Fields stored in the clear (the primary key field(s) are always added). */
  plain: readonly string[]
}

export const TABLE_ENCRYPTION: Readonly<Record<string, TableEncryptionConfig>> = {
  settings: { plain: ['key'] },
  coachInputs: { plain: ['campIri'] },
  mappings: { plain: ['campIri'] },
  overrides: { plain: ['id', 'campIri', 'findingId'] },
  campSummaries: { plain: ['campIri'] },
  feedback: { plain: ['id', 'campIri'] },
  reviews: { plain: ['campIri'] },
  rounds: { plain: ['id', 'campIri', 'number'] },
  snapshots: { plain: ['id', 'campIri'] },
  documents: { plain: ['id', 'campIri'] },
  watchedFolders: { plain: ['id', 'campIri'] },
  aiLog: { plain: ['id', 'at'] },
  midata: { plain: ['campIri'] },
  nds: { plain: ['campIri'] },
  selfChecks: { plain: ['id', 'campIri'] },
}
