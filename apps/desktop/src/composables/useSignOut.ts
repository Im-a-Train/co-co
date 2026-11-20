import { useCamps } from './useCamps'
import { useSession } from './useSession'

/**
 * Logs out of eCamp and clears the cached camp list. Shared by the header account menu and
 * Einstellungen so the two sign-out paths cannot drift (UX review FIRST-09).
 */
export function useSignOut(): () => Promise<void> {
  const { logout } = useSession()
  const camps = useCamps()
  return async () => {
    await logout()
    camps.reset()
  }
}
