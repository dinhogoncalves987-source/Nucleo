// Vercel Serverless: POST /api/james/generate/extract-contact
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireApiAuth } from '../../api/_lib/auth'
import { openai } from '../../api/_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!await requireApiAuth(req, res)) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
    const { text } = req.body as { text: string }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Extraia dados de contato e retorne APENAS JSON: {"nome":"","telefone":"","email":"","endereco":""}.' },
        { role: 'user', content: (text || '').slice(0, 800) },
      ],
      max_tokens: 150,
      temperature: 0,
    })

    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}'
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    res.json(jsonMatch ? JSON.parse(jsonMatch[0]) : { nome: '', telefone: '', email: '', endereco: '' })
  } catch (err) {
    console.error('[EXTRACT-CONTACT] Error:', err)
    res.status(500).json({ error: { message: 'Falha ao extrair contato' } })
  }
}
