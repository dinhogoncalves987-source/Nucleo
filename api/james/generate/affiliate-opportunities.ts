// Vercel Serverless: POST /api/james/generate/affiliate-opportunities
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openai } from '../../_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  try {
    const { affiliateSummary, slowDays } = req.body as { affiliateSummary: string; slowDays?: string[] }
    const timingContext = slowDays?.length
      ? ` Baixa ocupação às ${slowDays.join(' e ')}. Sugira como usar o cashback nesses dias.`
      : ''

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Você é James, auditor comercial da rede Beauty Hub. Analise e sugira 1 ação concreta em até 2 frases.${timingContext}` },
        { role: 'user', content: `Rede: ${(affiliateSummary || '').slice(0, 400)}. Melhor ação agora?` },
      ],
      max_tokens: 120,
      temperature: 0.7,
    })

    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    res.json({ text })
  } catch (err) {
    console.error('[AFFILIATE-OPS] Error:', err)
    res.status(500).json({ error: { message: 'Falha ao analisar oportunidades' } })
  }
}
