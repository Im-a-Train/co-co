/** Errors of the encrypted local store (ADR 0009). Callers map these to German UI texts. */

/** The data store is locked (no key): nobody may read or write co-co data. */
export class LockedError extends Error {
  constructor() {
    super('Data store is locked')
    this.name = 'LockedError'
  }
}

/** A stored row could not be decrypted (wrong/lost key, tampering, row moved). Never swallowed into empty data. */
export class DecryptError extends Error {
  constructor(detail = 'Stored data could not be decrypted') {
    super(detail)
    this.name = 'DecryptError'
  }
}
