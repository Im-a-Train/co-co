/** AI features are offered only when the coach enabled AI and an API key is stored in the OS keychain. */
export function aiAvailable(enabled: boolean, hasKey: boolean): boolean {
  return enabled && hasKey
}
