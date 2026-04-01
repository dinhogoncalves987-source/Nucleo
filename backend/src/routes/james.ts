// ============================================================
// routes/james.ts - Endpoints do James para o Frontend
//   POST /api/james/transcribe -> Whisper STT
//   POST /api/james/think -> resposta do James
//   POST /api/james/tts -> OpenAI TTS -> MP3
// ============================================================
import { Router } from 'express'
import multer from 'multer'
import OpenAI from 'openai'
import { handleJamesRequest, clearSession, getSessionInfo, buildMessages, addTurnPublic, saveMemory } from '../services/james-engine'
import { logger } from '../logger'

export const router = Router()

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

async function completeText(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], opts?: {
  max_tokens?: number
  temperature?: number
}): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: opts?.max_tokens ?? 200,
    temperature: opts?.temperature ?? 0.7,
  })

  return completion.choices[0]?.message?.content?.trim() ?? ''
}

// multer in-memory para receber o blob de audio
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

// POST /api/james/transcribe
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Campo audio obrigatorio' }); return }

    const blob = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype || 'audio/wav' })
    const file = new File([blob], req.file.originalname || 'audio.wav', { type: req.file.mimetype || 'audio/wav' })

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'pt',
    })

    const text = transcription.text?.trim() ?? ''
    logger.info(`[JAMES TRANSCRIBE] "${text.slice(0, 60)}"`)
    res.json({ text })
  } catch (err) {
    logger.error('[JAMES TRANSCRIBE] Erro', err)
    res.status(500).json({ error: 'Falha na transcricao' })
  }
})

// POST /api/james/think
router.post('/think', async (req, res) => {
  try {
    const { message, tenant_id, origin, sessionId } = req.body as {
      message: string; tenant_id: string; origin?: string; sessionId?: string
    }

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message e obrigatorio' }); return
    }
    if (!tenant_id || typeof tenant_id !== 'string') {
      res.status(400).json({ error: 'tenant_id e obrigatorio' }); return
    }

    const validOrigins = ['frontend', 'whatsapp', 'personal']
    const safeOrigin = validOrigins.includes(origin ?? '')
      ? (origin as 'frontend' | 'whatsapp' | 'personal')
      : 'frontend'

    const reply = await handleJamesRequest({
      message,
      tenant_id,
      origin: safeOrigin,
      sessionId: sessionId ?? tenant_id,
    })

    res.json({ reply })
  } catch (err) {
    logger.error('[JAMES THINK] Erro', err)
    res.status(500).json({ error: 'Erro interno do James' })
  }
})

// POST /api/james/session/reset
router.post('/session/reset', async (req, res) => {
  const { sessionId } = req.body as { sessionId?: string }
  if (sessionId) clearSession(sessionId)
  res.json({ ok: true })
})

// GET /api/james/session/info
router.get('/session/info', (req, res) => {
  const { sessionId } = req.query
  const info = getSessionInfo(String(sessionId ?? ''))
  res.json(info ?? { message: 'Sessao nao encontrada' })
})

// POST /api/james/think-stream
router.post('/think-stream', async (req, res) => {
  const { message, tenant_id, origin, sessionId } = req.body as {
    message: string; tenant_id: string; origin?: string; sessionId?: string
  }

  if (!message || !tenant_id) {
    res.status(400).json({ error: 'message e tenant_id sao obrigatorios' }); return
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()

  const sendEvent = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  const textToAudio = async (text: string): Promise<string | null> => {
    try {
      const mp3 = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'onyx',
        input: text.slice(0, 1000),
      })
      const buf = Buffer.from(await mp3.arrayBuffer())
      return buf.toString('base64')
    } catch {
      return null
    }
  }

  const SENTENCE_END = /[.!?]\s/
  const MIN_CHUNK_LEN = 30

  try {
    const messages = await buildMessages({
      message,
      tenant_id,
      origin: (origin ?? 'frontend') as 'frontend' | 'whatsapp' | 'personal',
      sessionId: sessionId ?? tenant_id,
    })

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.6,
      max_tokens: 200,
      stream: true,
      messages,
    })

    let buffer = ''
    let fullText = ''
    let chunkIdx = 0
    const ttsQueue: Promise<void>[] = []

    const flushChunk = (text: string) => {
      const t = text.trim()
      if (!t) return
      chunkIdx++
      const idx = chunkIdx
      const p = textToAudio(t).then(audio => {
        if (audio) sendEvent({ type: 'audio', data: audio, text: t, index: idx })
      })
      ttsQueue.push(p)
    }

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? ''
      if (!token) continue
      buffer += token
      fullText += token

      if (buffer.length >= MIN_CHUNK_LEN && SENTENCE_END.test(buffer)) {
        const match = buffer.search(/[.!?]\s[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ"'a-z]/)
        if (match !== -1) {
          const sentence = buffer.slice(0, match + 1).trim()
          buffer = buffer.slice(match + 2)
          flushChunk(sentence)
        }
      }
    }

    if (buffer.trim()) flushChunk(buffer.trim())

    await Promise.all(ttsQueue)

    addTurnPublic(sessionId ?? tenant_id, 'user', message)
    addTurnPublic(sessionId ?? tenant_id, 'assistant', fullText.trim())
    saveMemory(message, fullText.trim(), tenant_id, false).catch(() => {})

    sendEvent({ type: 'done', fullText: fullText.trim() })
    res.end()
  } catch (err) {
    logger.error('[JAMES STREAM] Erro', err)
    sendEvent({ type: 'error', message: 'Erro interno no streaming' })
    res.end()
  }
})

// POST /api/james/tts
router.post('/tts', async (req, res) => {
  try {
    const { text, voice = 'onyx' } = req.body as { text: string; voice?: string }
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text e obrigatorio' }); return
    }

    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: voice as 'onyx' | 'alloy' | 'echo' | 'fable' | 'nova' | 'shimmer',
      input: text.slice(0, 4096),
    })

    const buffer = Buffer.from(await mp3.arrayBuffer())
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'no-cache',
    })
    res.send(buffer)
  } catch (err) {
    logger.error('[JAMES TTS] Erro', err)
    res.status(500).json({ error: 'Falha no TTS' })
  }
})

// POST /api/james/generate/rescue-message
router.post('/generate/rescue-message', async (req, res) => {
  try {
    const { nome, diasAusente, salonName = 'o salao', affiliateLink } = req.body as {
      nome: string; diasAusente: number; salonName?: string; affiliateLink?: string
    }
    const linkInstr = affiliateLink ? ` Inclua no final: "Agende aqui 👉 ${affiliateLink}"` : ''
    const text = await completeText([
      { role: 'system', content: `Voce e o assistente de ${salonName}. Escreva mensagens de WhatsApp curtas, calorosas e pessoais.${linkInstr}` },
      { role: 'user', content: `Cliente "${nome}" esta ha ${diasAusente} dias sem agendar. 1 mensagem de reativacao com emoji, maximo 3 linhas.` },
    ], { max_tokens: 150, temperature: 0.8 })
    res.json({ text })
  } catch (err) {
    logger.error('[JAMES GENERATE rescue-message] Erro', err)
    res.status(500).json({ error: { message: 'Falha ao gerar mensagem de resgate' } })
  }
})

// POST /api/james/generate/extract-contact
router.post('/generate/extract-contact', async (req, res) => {
  try {
    const { text } = req.body as { text: string }
    const raw = await completeText([
      { role: 'system', content: 'Extraia dados de contato e retorne APENAS JSON: {"nome":"","telefone":"","email":"","endereco":""}.' },
      { role: 'user', content: text.slice(0, 800) },
    ], { max_tokens: 150, temperature: 0 })

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    res.json(jsonMatch ? JSON.parse(jsonMatch[0]) : { nome: '', telefone: '', email: '', endereco: '' })
  } catch (err) {
    logger.error('[JAMES GENERATE extract-contact] Erro', err)
    res.status(500).json({ error: { message: 'Falha ao extrair contato' } })
  }
})

// POST /api/james/generate/promo-suggestion
router.post('/generate/promo-suggestion', async (req, res) => {
  try {
    const { clientCount, lowSeasonMonth, salonName } = req.body as {
      clientCount: number; lowSeasonMonth: string; salonName: string
    }
    const text = await completeText([
      { role: 'system', content: 'Consultor de marketing para saloes. Respostas curtas e acionaveis.' },
      { role: 'user', content: `Salao "${salonName}", ${clientCount} clientes. Sugira 1 promocao para ${lowSeasonMonth} em 2 linhas.` },
    ], { max_tokens: 100, temperature: 0.7 })
    res.json({ text })
  } catch (err) {
    logger.error('[JAMES GENERATE promo-suggestion] Erro', err)
    res.status(500).json({ error: { message: 'Falha ao gerar sugestao' } })
  }
})

// POST /api/james/generate/affiliate-opportunities
router.post('/generate/affiliate-opportunities', async (req, res) => {
  try {
    const { affiliateSummary, slowDays } = req.body as { affiliateSummary: string; slowDays?: string[] }
    const timingContext = slowDays?.length
      ? ` Baixa ocupacao as ${slowDays.join(' e ')}. Sugira como usar o cashback especificamente nesses dias.`
      : ''
    const text = await completeText([
      { role: 'system', content: `Voce e James, auditor comercial da rede Beauty Hub. Analise e sugira 1 acao concreta com timing em ate 2 frases.${timingContext}` },
      { role: 'user', content: `Rede: ${affiliateSummary.slice(0, 400)}. Melhor acao agora?` },
    ], { max_tokens: 120, temperature: 0.7 })
    res.json({ text })
  } catch (err) {
    logger.error('[JAMES GENERATE affiliate-opportunities] Erro', err)
    res.status(500).json({ error: { message: 'Falha ao analisar oportunidades' } })
  }
})

// POST /api/james/generate/batch-messages
router.post('/generate/batch-messages', async (req, res) => {
  try {
    const { leads, salonName } = req.body as {
      leads: Array<{ name: string; source: string }>
      salonName: string
    }

    const results: Record<string, string> = {}
    const toneBySource: Record<string, string> = {
      maps: 'formal e profissional. Proposta de parceria ou indicacao de clientes.',
      instagram: 'descontraida e social. Mencione que acompanha o estilo do perfil.',
      csv: 'direta e exclusiva. Ofereca uma vantagem especial de boas-vindas.',
      manual: 'proxima e personalizada. Demonstre interesse genuino no negocio.',
      inbound_whatsapp: 'proxima e consultiva. Continue a conversa de forma humana e objetiva.',
    }

    for (let i = 0; i < leads.length; i += 3) {
      const batch = leads.slice(i, i + 3)
      await Promise.all(batch.map(async lead => {
        const tone = toneBySource[lead.source] ?? toneBySource.manual
        try {
          results[lead.name] = await completeText([
            { role: 'system', content: `Voce e James, assistente de ${salonName}. Tom: ${tone} Maximo 2 linhas, com emoji.` },
            { role: 'user', content: `Escreva 1 mensagem de WhatsApp para prospectar "${lead.name}".` },
          ], { max_tokens: 100, temperature: 0.85 })
        } catch {
          results[lead.name] = `Ola, ${lead.name}! Somos ${salonName} e adoraríamos conhecer voce. Podemos conversar?`
        }
      }))
    }

    res.json({ results })
  } catch (err) {
    logger.error('[JAMES GENERATE batch-messages] Erro', err)
    res.status(500).json({ error: { message: 'Falha ao gerar mensagens em lote' } })
  }
})

// POST /api/james/generate/health
router.post('/generate/health', async (_req, res) => {
  try {
    await completeText([{ role: 'user', content: 'ping' }], { max_tokens: 1, temperature: 0 })
    res.json({ ok: true })
  } catch (err) {
    logger.error('[JAMES GENERATE health] Erro', err)
    res.status(500).json({ error: { message: 'Backend IA indisponivel' } })
  }
})
