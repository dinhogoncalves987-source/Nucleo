import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Tenant, User } from '../types'

export interface TenantContextType {
  tenant: Tenant | null
  user: User | null
  session: Session | null
  isAuthenticated: boolean
  loading: boolean
  setTenant: (tenant: Tenant) => void
  setUser: (user: User) => void
  logout: () => Promise<void>
  loginWithSupabase: (email: string, password: string) => Promise<{ error: string | null }>
}

export const TenantContext = createContext<TenantContextType | null>(null)

export function useTenant() {
  const context = useContext(TenantContext)
  if (!context) throw new Error('useTenant must be used within TenantProvider')
  return context
}
