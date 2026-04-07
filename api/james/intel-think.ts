// Vercel Serverless: POST /api/james/intel-think
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openai } from '../_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  const { message, systemPrompt } = req.body as {
    message?: string; systemPrompt?: string
  }

  if (!message || message.trim().length < 2) {
    res.status(400).json({ error: 'message é obrigatório' }); return
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt || 'Você é James, um assistente executivo digital.' },
        { role: 'user', content: message.trim() },
      ],
      max_tokens: 300,
      temperature: 0.7,
    })

    const reply = completion.choices[0]?.message?.content?.trim() ?? ''
    res.json({ reply })
  } catch (err) {
    console.error('[INTEL-THINK] Error:', err)
    res.status(500).json({ error: 'Erro ao processar.' })
  }
}
