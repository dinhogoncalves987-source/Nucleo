import { useState, useEffect, ReactNode, useRef } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Tenant, User } from '../types'
import { TenantContext } from './tenant-context'

// ── Dev Mode: bypass auth in development ──────────────────
const DEV_MODE = import.meta.env.DEV

const DEFAULT_TENANT: Tenant = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'The Beauty Hub',
  created_at: new Date().toISOString(),
}

const DEV_USER: User = {
  id: 'dev-superadmin-0000',
  tenant_id: DEFAULT_TENANT.id,
  email: 'dev@nucleohub.local',
  role: 'superadmin',
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenantState] = useState<Tenant | null>(null)
  const [user, setUserState] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const initialized = useRef(false)

  useEffect(() => {
    // Guard: run only once even in dev environments
    if (initialized.current) return
    initialized.current = true

    let cancelled = false

    const init = async () => {
      // ── DEV bypass: skip Supabase, log in instantly ──
      if (DEV_MODE) {
        console.log('%c🔓 DEV MODE — Auto-login como superadmin', 'color: #00B4FF; font-weight: bold; font-size: 13px')
        setUserState(DEV_USER)
        setTenantState(DEFAULT_TENANT)
        setLoading(false)
        return
      }

      try {
        // Hard timeout: if supabase doesn't respond in 3s, bail out
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 3000))
        ])

        if (cancelled) return

        const sess = result && 'data' in result ? result.data.session : null

        if (sess?.user) {
          setSession(sess)
          // Set user from session directly (no extra DB query that might fail)
          setUserState({
            id: sess.user.id,
            tenant_id: '00000000-0000-0000-0000-000000000001',
            email: sess.user.email ?? '',
            role: 'superadmin',
          })
          setTenantState(DEFAULT_TENANT)
          // Try to enrich with profile data in the background (non-blocking)
          supabase.from('profiles').select('*').eq('id', sess.user.id).maybeSingle()
            .then(
              ({ data }) => { if (data && !cancelled) setUserState({ id: data.id, tenant_id: data.tenant_id, email: data.email, role: data.role }) },
              () => { /* silently ignore profile errors */ }
            )
        }
      } catch {
        // Ignore errors — just show login
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    init()

    return () => { cancelled = true }
  }, [])

  const loginWithSupabase = async (email: string, password: string): Promise<{ error: string | null }> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      if (error.message.includes('Invalid login credentials')) return { error: 'E-mail ou senha incorretos.' }
      if (error.message.includes('Email not confirmed')) return { error: 'Confirme seu e-mail antes de entrar.' }
      return { error: error.message }
    }

    if (data.session) {
      setSession(data.session)
      setUserState({
        id: data.session.user.id,
        tenant_id: '00000000-0000-0000-0000-000000000001',
        email: data.session.user.email ?? email,
        role: 'superadmin',
      })
      setTenantState(DEFAULT_TENANT)
    }

    return { error: null }
  }

  const logout = async () => {
    await supabase.auth.signOut().catch(() => {})
    setSession(null)
    setUserState(null)
    setTenantState(null)
  }

  return (
    <TenantContext.Provider value={{
      tenant, user, session,
      isAuthenticated: DEV_MODE ? !!user : !!session,
      loading,
      setTenant: setTenantState,
      setUser: setUserState,
      logout,
      loginWithSupabase,
    }}>
      {children}
    </TenantContext.Provider>
  )
}
