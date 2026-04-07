// Vercel Serverless: POST /api/james/generate/batch-messages
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openai } from '../../_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  try {
    const { leads, salonName } = req.body as {
      leads: Array<{ name: string; source: string }>
      salonName: string
    }

    const toneBySource: Record<string, string> = {
      maps: 'formal e profissional.',
      instagram: 'descontraída e social.',
      csv: 'direta e exclusiva.',
      manual: 'próxima e personalizada.',
      inbound_whatsapp: 'próxima e consultiva.',
    }

    const results: Record<string, string> = {}

    for (let i = 0; i < (leads || []).length; i += 3) {
      const batch = leads.slice(i, i + 3)
      await Promise.all(batch.map(async lead => {
        const tone = toneBySource[lead.source] ?? toneBySource.manual
        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: `Você é James, assistente de ${salonName}. Tom: ${tone} Máximo 2 linhas, com emoji.` },
              { role: 'user', content: `Escreva 1 mensagem de WhatsApp para prospectar "${lead.name}".` },
            ],
            max_tokens: 100,
            temperature: 0.85,
          })
          results[lead.name] = completion.choices[0]?.message?.content?.trim() ?? ''
        } catch {
          results[lead.name] = `Olá, ${lead.name}! Somos ${salonName} e adoraríamos conhecer você. Podemos conversar?`
        }
      }))
    }

    res.json({ results })
  } catch (err) {
    console.error('[BATCH-MESSAGES] Error:', err)
    res.status(500).json({ error: { message: 'Falha ao gerar mensagens em lote' } })
  }
}
