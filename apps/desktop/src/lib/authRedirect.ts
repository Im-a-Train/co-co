/** Pure redirect decision for login/logout transitions (used by App.vue). */
export interface AuthRouteInfo {
  /** Any matched route record requires an eCamp session. */
  requiresAuth: boolean
  /** Name of the current route. */
  name: string | symbol | null | undefined
  /** `redirect` query parameter, if any. */
  redirect?: unknown
}

/** Where to go after the login state changed; null = stay. */
export function authRedirect(loggedIn: boolean, route: AuthRouteInfo): string | null {
  if (!loggedIn) return route.requiresAuth ? '/verbindung' : null
  if (route.name === 'connection') {
    // Only same-app paths are honoured (no external or protocol-relative targets).
    const r = route.redirect
    return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/lager'
  }
  return null
}
