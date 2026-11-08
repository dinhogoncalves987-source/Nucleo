import type { Session } from '@supabase/supabase-js'
import type { Tenant, User } from '../types'

export interface IdentityState {
  session: Session | null
  user: User | null
  tenant: Tenant | null
  loading: boolean
}

interface IdentitySource {
  getSession: () => Promise<{ data: { session: Session | null }; error?: unknown }>
  subscribe: (callback: (event: string, session: Session | null) => void) => () => void
  profile: (id: string) => Promise<User>
  tenant: (id: string) => Promise<Tenant>
  signOut: () => Promise<unknown>
}

export const emptyIdentity = (loading = false): IdentityState => ({
  session: null, user: null, tenant: null, loading,
})

// Every asynchronous continuation belongs to one generation of this mounted owner.
export function createIdentityLifecycle(source: IdentitySource, publish: (state: IdentityState) => void) {
  let active = true
  let generation = 0
  let signedOut = false
  let logoutPending: Promise<void> | null = null
  const current = (version: number) => active && generation === version
  const clear = (loading = false) => { if (active) publish(emptyIdentity(loading)) }

  const load = async (session: Session | null) => {
    const version = ++generation
    clear(!!session?.user)
    if (!session?.user) return
    // Supabase auth callbacks must return before starting another client operation.
    await Promise.resolve()
    if (!current(version)) return
    try {
      const user = await source.profile(session.user.id)
      if (!current(version)) return
      if (!user || user.id !== session.user.id || !user.tenant_id) throw new Error('Invalid profile')
      const tenant = await source.tenant(user.tenant_id)
      if (!current(version)) return
      if (!tenant || tenant.id !== user.tenant_id) throw new Error('Invalid tenant')
      publish({ session, user, tenant, loading: false })
    } catch {
      if (current(version)) clear()
    }
  }

  // Subscribe before reading the snapshot; any event supersedes that snapshot.
  const unsubscribe = source.subscribe((event, session) => {
    if (!active || (event === 'INITIAL_SESSION' && generation !== 0)) return
    if (logoutPending) return
    if (signedOut && event !== 'SIGNED_IN') return
    if (event === 'SIGNED_IN') signedOut = false
    if (event === 'SIGNED_OUT') signedOut = true
    void load(session)
  })
  const initialVersion = generation
  void (async () => {
    try {
      const { data, error } = await source.getSession()
      if (!current(initialVersion) || initialVersion !== 0) return
      if (error) throw error
      await load(data.session)
    } catch {
      if (initialVersion === 0 && current(initialVersion)) { ++generation; clear() }
    }
  })()

  return {
    waitForLogout: () => logoutPending ?? Promise.resolve(),
    logout: (): Promise<void> => {
      if (!active) return Promise.resolve()
      if (logoutPending) return logoutPending
      ++generation
      signedOut = true
      clear()
      // Fence auth events immediately, including events emitted by signOut itself.
      logoutPending = Promise.resolve().then(() => source.signOut()).then(
        () => undefined, () => undefined,
      ).finally(() => { logoutPending = null })
      return logoutPending
    },
    dispose: () => { active = false; ++generation; unsubscribe() },
  }
}
