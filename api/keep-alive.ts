// Vercel Serverless: GET /api/keep-alive
// Faz um SELECT leve no Supabase para manter o projeto ativo
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.CRON_SECRET
  if (!expected || req.headers.authorization !== `Bearer ${expected}`) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
  )

  const { count, error } = await supabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })

  if (error) {
    console.error('[KEEP-ALIVE] Erro:', error.message)
    res.status(500).json({ ok: false, error: error.message, at: new Date().toISOString() })
    return
  }

  console.log(`[KEEP-ALIVE] ✅ Supabase ativo — ${count} tenants — ${new Date().toISOString()}`)
  res.json({ ok: true, tenants: count, at: new Date().toISOString() })
}
