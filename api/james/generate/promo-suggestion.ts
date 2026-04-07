// Vercel Serverless: POST /api/james/generate/promo-suggestion
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openai } from '../../_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  try {
    const { clientCount, lowSeasonMonth, salonName } = req.body as {
      clientCount: number; lowSeasonMonth: string; salonName: string
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Consultor de marketing para salões. Respostas curtas e acionáveis.' },
        { role: 'user', content: `Salão "${salonName}", ${clientCount} clientes. Sugira 1 promoção para ${lowSeasonMonth} em 2 linhas.` },
      ],
      max_tokens: 100,
      temperature: 0.7,
    })

    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    res.json({ text })
  } catch (err) {
    console.error('[PROMO-SUGGESTION] Error:', err)
    res.status(500).json({ error: { message: 'Falha ao gerar sugestão' } })
  }
}
