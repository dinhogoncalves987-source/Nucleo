// Vercel Serverless: POST /api/james/transcribe
import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'
import { IncomingForm, File as FormFile } from 'formidable'
import fs from 'fs'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

// Disable body parser so formidable can handle multipart
export const config = { api: { bodyParser: false } }

function parseForm(req: VercelRequest): Promise<{ files: Record<string, FormFile | FormFile[]> }> {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({ maxFileSize: 25 * 1024 * 1024 })
    form.parse(req as any, (err, _fields, files) => {
      if (err) reject(err)
      else resolve({ files: files as Record<string, FormFile | FormFile[]> })
    })
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (process.env.API_SECRET && req.headers['x-api-secret'] !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  try {
    const { files } = await parseForm(req)
    const audioFile = Array.isArray(files.audio) ? files.audio[0] : files.audio

    if (!audioFile) {
      res.status(400).json({ error: 'Campo audio obrigatório' }); return
    }

    const fileBuffer = fs.readFileSync(audioFile.filepath)
    const blob = new Blob([fileBuffer], { type: audioFile.mimetype || 'audio/wav' })
    const file = new File([blob], audioFile.originalFilename || 'audio.wav', {
      type: audioFile.mimetype || 'audio/wav',
    })

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'pt',
    })

    const text = transcription.text?.trim() ?? ''
    console.log(`[TRANSCRIBE] "${text.slice(0, 60)}"`)
    res.json({ text })
  } catch (err) {
    console.error('[TRANSCRIBE] Error:', err)
    res.status(500).json({ error: 'Falha na transcrição' })
  }
}
