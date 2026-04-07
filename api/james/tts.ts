// Vercel Serverless: POST /api/james/tts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  // Auth
  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  const { text, voice } = req.body as { text?: string; voice?: string }
  if (!text || text.trim().length < 1) {
    res.status(400).json({ error: 'text é obrigatório' }); return
  }

  try {
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: (voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer') || 'onyx',
      input: text.trim().slice(0, 500),
      speed: 1.05,
    })

    const buffer = Buffer.from(await mp3.arrayBuffer())
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', String(buffer.length))
    res.send(buffer)
  } catch (err) {
    console.error('[TTS] Error:', err)
    res.status(500).json({ error: 'Erro ao gerar áudio.' })
  }
}
