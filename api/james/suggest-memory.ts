// Vercel Serverless: POST /api/james/suggest-memory
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openai } from '../_lib/james-engine'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  const { question, category } = req.body as { question?: string; category?: string }

  if (!question || question.trim().length < 5) {
    res.status(400).json({ error: 'Preencha com pelo menos 5 caracteres.' }); return
  }

  try {
    const systemPrompt = `Você é James, um executivo digital de alto nível. Sua função é gerar respostas-modelo para treinar uma IA executiva.

Dado o contexto/pergunta abaixo, gere exatamente 3 variações de resposta ideal, cada uma com um estilo distinto:

1. **DIRETO** — Resposta curta, objetiva, sem floreio.
2. **ANALÍTICO** — Resposta com leitura de dados, causa-efeito e diagnóstico.
3. **ESTRATÉGICO** — Resposta de alto nível com visão de negócio.

Regras:
- Cada resposta: 40 a 120 palavras
- Tom executivo: sem linguagem de chatbot
- Categoria: ${category || 'geral'}

Retorne APENAS JSON:
[
  {"style": "direto", "label": "Direto", "response": "..."},
  {"style": "analitico", "label": "Analítico", "response": "..."},
  {"style": "estrategico", "label": "Estratégico", "response": "..."}
]`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question.trim() },
      ],
      max_tokens: 800,
      temperature: 0.8,
    })

    const result = completion.choices[0]?.message?.content?.trim() ?? ''
    const jsonMatch = result.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      res.status(500).json({ error: 'Falha ao gerar sugestões.' }); return
    }

    const suggestions = JSON.parse(jsonMatch[0])
    res.json({ suggestions })
  } catch (err) {
    console.error('[SUGGEST-MEMORY] Error:', err)
    res.status(500).json({ error: 'Erro ao gerar sugestões.' })
  }
}
