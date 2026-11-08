import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || '',
)

export async function requireApiAuth(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const match = /^Bearer ([^\s,]+)$/.exec(req.headers.authorization ?? '')
  if (!match) { res.status(401).json({ error: 'Unauthorized' }); return false }
  const { data, error } = await supabase.auth.getClaims(match[1])
  const userId = data?.claims?.sub
  if (error || typeof userId !== 'string') { res.status(401).json({ error: 'Unauthorized' }); return false }
  const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', userId).single()
  if (!profile?.tenant_id) { res.status(403).json({ error: 'Perfil sem empresa autorizada' }); return false }
  if (req.body && typeof req.body === 'object') req.body.tenant_id = profile.tenant_id
  return true
}
