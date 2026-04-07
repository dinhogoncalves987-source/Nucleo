// Vercel Serverless: POST /api/james/generate/health
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openai } from '../../_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
    await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      temperature: 0,
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('[HEALTH] Error:', err)
    res.status(500).json({ error: { message: 'Backend IA indisponível' } })
  }
}
