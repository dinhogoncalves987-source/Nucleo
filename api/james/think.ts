// Vercel Serverless: POST /api/james/think
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleJamesRequest } from '../_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  const { message, tenant_id, origin, sessionId } = req.body as {
    message: string; tenant_id: string; origin?: string; sessionId?: string
  }

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message é obrigatório' }); return
  }
  if (!tenant_id || typeof tenant_id !== 'string') {
    res.status(400).json({ error: 'tenant_id é obrigatório' }); return
  }

  const validOrigins = ['frontend', 'whatsapp', 'personal']
  const safeOrigin = validOrigins.includes(origin ?? '')
    ? (origin as 'frontend' | 'whatsapp' | 'personal')
    : 'frontend'

  try {
    const reply = await handleJamesRequest({
      message, tenant_id, origin: safeOrigin,
      sessionId: sessionId ?? tenant_id,
    })
    res.json({ reply })
  } catch (err) {
    console.error('[THINK] Error:', err)
    res.status(500).json({ error: 'Erro interno do James' })
  }
}
