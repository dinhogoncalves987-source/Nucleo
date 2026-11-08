import { useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Tenant, User } from '../types'
import { TenantContext } from './tenant-context'
import { createIdentityLifecycle, emptyIdentity } from './identity-lifecycle'

const DEV_MODE = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === 'true'
const DEFAULT_TENANT: Tenant = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'The Beauty Hub',
  created_at: new Date().toISOString(),
}
const DEV_USER: User = {
  id: 'dev-superadmin-0000', tenant_id: DEFAULT_TENANT.id,
  email: 'dev@example.invalid', role: 'superadmin',
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState(() => emptyIdentity(true))
  const lifecycle = useRef<ReturnType<typeof createIdentityLifecycle> | null>(null)
  const { tenant, user, session, loading } = identity

  useEffect(() => {
    if (DEV_MODE) {
      setIdentity({ session: null, user: DEV_USER, tenant: DEFAULT_TENANT, loading: false })
      return
    }
    const owner = createIdentityLifecycle({
      getSession: () => supabase.auth.getSession(),
      subscribe: callback => {
        const { data } = supabase.auth.onAuthStateChange(callback)
        return () => data.subscription.unsubscribe()
      },
      profile: async id => {
        const { data, error } = await supabase.from('profiles')
          .select('id, tenant_id, email, role').eq('id', id).single()
        if (error || !data) throw new Error('Perfil de acesso nao encontrado.')
        return data as User
      },
      tenant: async id => {
        const { data, error } = await supabase.from('tenants')
          .select('id, name, created_at').eq('id', id).single()
        if (error || !data) throw new Error('Empresa vinculada nao encontrada.')
        return data as Tenant
      },
      signOut: () => supabase.auth.signOut(),
    }, setIdentity)
    lifecycle.current = owner
    return () => { owner.dispose(); lifecycle.current = null }
  }, [])

  const loginWithSupabase = async (email: string, password: string) => {
    const owner = lifecycle.current
    await owner?.waitForLogout()
    if (!DEV_MODE && (!owner || lifecycle.current !== owner)) return { error: 'Acesso encerrado. Tente novamente.' }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error) return { error: null }
    if (error.message.includes('Invalid login credentials')) return { error: 'E-mail ou senha incorretos.' }
    if (error.message.includes('Email not confirmed')) return { error: 'Confirme seu e-mail antes de entrar.' }
    return { error: error.message }
  }

  const logout = async () => {
    if (DEV_MODE) { setIdentity(emptyIdentity()); return }
    await lifecycle.current?.logout()
  }

  return <TenantContext.Provider value={{
    tenant, user, session, isAuthenticated: DEV_MODE ? !!user : !!session && !!user && !!tenant,
    loading,
    setTenant: next => setIdentity(previous => previous.user ? { ...previous, tenant: next } : previous),
    setUser: next => setIdentity(previous => previous.user ? { ...previous, user: next } : previous),
    logout, loginWithSupabase,
  }}>{children}</TenantContext.Provider>
}
