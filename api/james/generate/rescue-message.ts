// Vercel Serverless: POST /api/james/generate/rescue-message
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openai } from '../../_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  try {
    const { nome, diasAusente, salonName = 'o salão', affiliateLink } = req.body as {
      nome: string; diasAusente: number; salonName?: string; affiliateLink?: string
    }
    const linkInstr = affiliateLink ? ` Inclua no final: "Agende aqui 👉 ${affiliateLink}"` : ''

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Você é o assistente de ${salonName}. Escreva mensagens de WhatsApp curtas, calorosas e pessoais.${linkInstr}` },
        { role: 'user', content: `Cliente "${nome}" está há ${diasAusente} dias sem agendar. 1 mensagem de reativação com emoji, máximo 3 linhas.` },
      ],
      max_tokens: 150,
      temperature: 0.8,
    })

    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    res.json({ text })
  } catch (err) {
    console.error('[RESCUE-MESSAGE] Error:', err)
    res.status(500).json({ error: { message: 'Falha ao gerar mensagem' } })
  }
}
