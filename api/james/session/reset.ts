// Vercel Serverless: POST /api/james/session/reset
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { clearSession } from '../../_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  const { sessionId } = req.body as { sessionId?: string }
  if (sessionId) await clearSession(sessionId)
  res.json({ ok: true })
}
