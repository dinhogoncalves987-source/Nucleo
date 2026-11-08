import type { RequestHandler } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

export function createTenantContext(supabase: SupabaseClient): RequestHandler {
  return async (req, res, next) => {
    if (!req.auth?.userId) { res.status(401).json({ error: 'Unauthorized' }); return }
    const { data, error } = await supabase.from('profiles')
      .select('tenant_id, role').eq('id', req.auth.userId).single()
    if (error || !data?.tenant_id) {
      res.status(403).json({ error: 'Perfil sem empresa autorizada' }); return
    }
    req.auth.tenantId = data.tenant_id
    req.auth.appRole = data.role
    if (req.body && typeof req.body === 'object' && 'tenant_id' in req.body) {
      req.body.tenant_id = data.tenant_id
    }
    next()
  }
}
