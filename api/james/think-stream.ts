// Vercel Serverless: POST /api/james/think-stream
// Streaming GPT + TTS chunks via Server-Sent Events
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { buildMessages, addTurnAndSave, saveMemory, openai } from '../_lib/james-engine'

export const config = {
  maxDuration: 60, // Allow up to 60s for streaming (Vercel Pro)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  const { message, tenant_id, origin, sessionId } = req.body as {
    message: string; tenant_id: string; origin?: string; sessionId?: string
  }

  if (!message || !tenant_id) {
    res.status(400).json({ error: 'message e tenant_id são obrigatórios' }); return
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

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
    } catch { return null }
  }

  const SENTENCE_END = /[.!?]\s/
  const MIN_CHUNK_LEN = 30

  try {
    const messages = await buildMessages({
      message, tenant_id,
      origin: (['frontend', 'whatsapp', 'personal'].includes(origin ?? '') ? origin : 'frontend') as any,
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

    // Save session and memory
    await addTurnAndSave(sessionId ?? tenant_id, 'user', message)
    await addTurnAndSave(sessionId ?? tenant_id, 'assistant', fullText.trim())
    saveMemory(message, fullText.trim(), tenant_id, false).catch(() => {})

    sendEvent({ type: 'done', fullText: fullText.trim() })
    res.end()
  } catch (err) {
    console.error('[STREAM] Error:', err)
    sendEvent({ type: 'error', message: 'Erro interno no streaming' })
    res.end()
  }
}
