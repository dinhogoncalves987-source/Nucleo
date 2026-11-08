import { supabase } from './supabase'

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) || ''

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessao expirada. Entre novamente.')

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${session.access_token}`)
  return fetch(`${BACKEND_URL}${path}`, { ...init, headers })
}
