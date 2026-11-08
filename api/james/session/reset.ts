// Vercel Serverless: POST /api/james/session/reset
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireApiAuth } from '../../_lib/auth'
import { clearSession } from '../../_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!await requireApiAuth(req, res)) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const { sessionId } = req.body as { sessionId?: string }
  if (sessionId) await clearSession(sessionId)
  res.json({ ok: true })
}
