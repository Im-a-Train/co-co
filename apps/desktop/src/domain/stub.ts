/** Helpers for contract stubs. FROZEN (architect). Builders remove their stub calls when implementing. */

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`)
    this.name = 'NotImplementedError'
  }
}

/** Throws NotImplementedError. Extra args are accepted so stub parameters count as used. */
export function notImplemented(what: string, ...args: unknown[]): never {
  void args
  throw new NotImplementedError(what)
}
