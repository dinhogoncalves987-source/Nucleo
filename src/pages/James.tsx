import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import JamesCoreWrapper from '../components/james-core/JamesCoreWrapper'
// MicVAD replaced by native MediaRecorder VAD (no external deps)

// ─── Types ────────────────────────────────────────────────────────────────────
type NucleoState =
  | 'nucleus'     // dormindo, ouvindo wake word
  | 'opening'     // animação de abertura
  | 'active'      // acordado, VAD ativo, aguardando fala
  | 'listening'   // usuário está falando AGORA
  | 'waiting'     // usuário disse "ok" → James espera mais contexto
  | 'speaking'    // James fala (TTS)
  | 'thinking'    // processando Whisper + GPT
  | 'closing'     // animação de fechamento

declare global {
  interface Window {
    SpeechRecognition: new () => ISpeechRecognition
    webkitSpeechRecognition: new () => ISpeechRecognition
  }
}
type ISpeechRecognition = {
  lang: string; continuous: boolean; interimResults: boolean
  onstart: (() => void) | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onresult: ((e: any) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void; stop(): void
}

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) || ''
const API_SECRET  = (import.meta.env.VITE_API_SECRET  as string | undefined) || ''

// ─── Backend helpers (todo o cérebro vive no backend) ──────────────────────

// Envia áudio WAV → backend → Whisper → texto
async function transcribeBackend(wavBlob: Blob): Promise<string> {
  try {
    const form = new FormData()
    form.append('audio', wavBlob, 'audio.wav')
    const res = await fetch(`${BACKEND_URL}/api/james/transcribe`, {
      method:  'POST',
      headers: { 'x-api-secret': API_SECRET },
      body:    form,
      signal:  AbortSignal.timeout(25_000),
    })
    if (!res.ok) return ''
    const data = await res.json() as { text?: string }
    return data.text?.trim() ?? ''
  } catch { return '' }
}

// ─── callBackendStream: GPT streaming → TTS por frase → toca em ordem ──────
// onChunkReady: chamado com cada URL de áudio pronto para tocar, em sequência
async function callBackendStream(
  message:      string,
  tenantId:     string,
  sessionId:    string,
  onChunkReady: (audioUrl: string, text: string) => void,
  onDone:       (fullText: string) => void,
  onError:      () => void,
): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/james/think-stream`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-secret': API_SECRET },
      body:    JSON.stringify({ message, tenant_id: tenantId, origin: 'frontend', sessionId }),
      signal:  AbortSignal.timeout(60_000),
    })
    if (!res.ok || !res.body) { onError(); return }

    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let   buf     = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      const parts = buf.split('\n\n')
      buf = parts.pop() ?? ''

      for (const part of parts) {
        const line = part.trim()
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6)) as {
            type: string; data?: string; text?: string; fullText?: string
          }
          if (evt.type === 'audio' && evt.data) {
            const binary = atob(evt.data)
            const bytes  = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            const audioUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
            onChunkReady(audioUrl, evt.text ?? '')
          } else if (evt.type === 'done') {
            onDone(evt.fullText ?? '')
          } else if (evt.type === 'error') {
            onError()
          }
        } catch { /* JSON malformado — ignora */ }
      }
    }
  } catch { onError() }
}

// Limpa o histórico de sessão no backend quando James é dispensado
async function resetSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/james/session/reset`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-secret': API_SECRET },
      body:    JSON.stringify({ sessionId }),
    })
  } catch { /* não bloqueia o dismiss */ }
}



// ─── Energy Grid Background ────────────────────────────────────────────────
function EnergyGrid({ active }: { active: boolean }) {
  return (
    <>
      <style>{`
        .eg-base {
          position: absolute; inset: 0; pointer-events: none;
          background-image:
            linear-gradient(rgba(0,180,255,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,180,255,0.06) 1px, transparent 1px);
          background-size: 60px 60px;
        }
        @keyframes sweep-h {
          0%   { transform: translateX(-100%); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateX(100vw); opacity: 0; }
        }
        @keyframes sweep-v {
          0%   { transform: translateY(-100%); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        @keyframes spark { 0%,100% { opacity: 0; } 50% { opacity: 1; } }
        .eg-sweep-h {
          position: absolute; left: 0; width: 200px; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(0,180,255,0.7), rgba(212,160,23,0.4), transparent);
          animation: sweep-h linear infinite; pointer-events: none;
        }
        .eg-sweep-v {
          position: absolute; top: 0; width: 1px; height: 200px;
          background: linear-gradient(180deg, transparent, rgba(0,180,255,0.6), rgba(0,180,255,0.2), transparent);
          animation: sweep-v linear infinite; pointer-events: none;
        }
        .eg-spark {
          position: absolute; width: 3px; height: 3px; border-radius: 50%;
          background: #00B4FF; box-shadow: 0 0 6px #00B4FF, 0 0 12px rgba(0,180,255,0.5);
          animation: spark ease-in-out infinite; pointer-events: none; opacity: 0;
        }
      `}</style>
      <div className="eg-base" />
      <div className="eg-sweep-h" style={{ top: '15%', animationDuration: '4.5s', animationDelay: '0s',   opacity: active ? 1 : 0.4 }} />
      <div className="eg-sweep-h" style={{ top: '33%', animationDuration: '6s',   animationDelay: '1.5s', width: 140, opacity: active ? 1 : 0.3 }} />
      <div className="eg-sweep-h" style={{ top: '55%', animationDuration: '3.8s', animationDelay: '0.8s', opacity: active ? 1 : 0.3 }} />
      <div className="eg-sweep-h" style={{ top: '72%', animationDuration: '5.2s', animationDelay: '2.2s', width: 160, opacity: active ? 1 : 0.35 }} />
      <div className="eg-sweep-h" style={{ top: '88%', animationDuration: '7s',   animationDelay: '3s',   width: 120, opacity: active ? 1 : 0.25 }} />
      <div className="eg-sweep-v" style={{ left: '12%', animationDuration: '5s',   animationDelay: '0.3s', opacity: active ? 0.9 : 0.3 }} />
      <div className="eg-sweep-v" style={{ left: '28%', animationDuration: '7s',   animationDelay: '1.8s', height: 160, opacity: active ? 0.8 : 0.25 }} />
      <div className="eg-sweep-v" style={{ left: '50%', animationDuration: '4.2s', animationDelay: '0s',   opacity: active ? 1 : 0.4 }} />
      <div className="eg-sweep-v" style={{ left: '68%', animationDuration: '6.5s', animationDelay: '2.5s', height: 140, opacity: active ? 0.9 : 0.3 }} />
      <div className="eg-sweep-v" style={{ left: '85%', animationDuration: '3.5s', animationDelay: '1s',   opacity: active ? 0.8 : 0.25 }} />
      <div className="eg-spark" style={{ top: '15%', left: '12%', animationDuration: '2.8s', animationDelay: '0.4s' }} />
      <div className="eg-spark" style={{ top: '33%', left: '50%', animationDuration: '3.5s', animationDelay: '1.1s' }} />
      <div className="eg-spark" style={{ top: '55%', left: '28%', animationDuration: '2.2s', animationDelay: '0s'   }} />
      <div className="eg-spark" style={{ top: '72%', left: '68%', animationDuration: '4s',   animationDelay: '2s'   }} />
      <div className="eg-spark" style={{ top: '88%', left: '85%', animationDuration: '3s',   animationDelay: '0.8s' }} />
      <div className="eg-spark" style={{ top: '20%', left: '68%', animationDuration: '2.5s', animationDelay: '1.5s' }} />
    </>
  )
}


// HibernationOverlay removed — the 3D nucleus handles all visual states

// ─── Main Nucleus Component — FULL SCREEN background ──────────────────────
function Nucleus({ state }: { state: NucleoState }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <JamesCoreWrapper nucleoState={state} />
    </div>
  )
}


// ─── Sound bars ────────────────────────────────────────────────────────────
function SoundBars({ state }: { state: NucleoState }) {
  const active = state === 'speaking' || state === 'listening' || state === 'waiting'
  const color  = state === 'listening' ? '#4ade80' : state === 'waiting' ? '#f59e0b' : '#00B4FF'
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:'clamp(2px,0.3vw,5px)', height:40,
      opacity: ['active','listening','waiting','speaking'].includes(state) ? 1 : 0,
      transition:'opacity 0.5s ease',
    }}>
      <style>{`
        @keyframes b0{from{height:3px}to{height:32px}} @keyframes b1{from{height:5px}to{height:22px}}
        @keyframes b2{from{height:2px}to{height:36px}} @keyframes b3{from{height:7px}to{height:18px}}
        @keyframes b4{from{height:4px}to{height:28px}}
      `}</style>
      {Array.from({length:18}).map((_,i)=>(
        <div key={i} style={{
          width:'clamp(2px,0.25vw,4px)', minHeight:2, borderRadius:3,
          background:color, opacity: active ? 0.8 : 0.07,
          height: active ? undefined : 3,
          animation: active ? `b${i%5} ${0.34+(i%5)*0.1}s ease-in-out infinite alternate` : 'none',
          transition:'opacity 0.5s',
        }}/>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── MAIN JAMES PAGE ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
export default function James() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const tenantId  = tenant?.id ?? 'personal'
  const [state, setState] = useState<NucleoState>('nucleus')

  const stateRef   = useRef<NucleoState>('nucleus')
  stateRef.current = state

  // ── Session ID — único por sessão de página, enviado ao backend
  const sessionIdRef = useRef<string>(`${tenantId}-${Date.now()}`)

  // ── Core refs ──────────────────────────────────────────────────────────────
  const audioRef      = useRef<HTMLAudioElement | null>(null)
  const vadRef        = useRef<{ pause: () => void; start: () => void; destroy: () => void } | null>(null)
  const busyRef       = useRef(false)
  const vadInitLock   = useRef(false)
  const watchdogRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCtxRef = useRef<string>('')
  const audioUnlocked = useRef(false)

  // ── Desbloquear autoplay do browser (DEVE ser chamado em gesto do usuário) ──
  const unlockAudio = useCallback(() => {
    if (audioUnlocked.current) return
    try {
      // Criar AudioContext no gesto do usuário desbloqueia autoplay
      const ctx = new AudioContext()
      const buf = ctx.createBuffer(1, 1, 22050)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start(0)
      // Também criar e tocar um Audio vazio para desbloquear HTMLAudioElement.play()
      const silence = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=')
      silence.volume = 0
      silence.play().catch(() => {})
      audioUnlocked.current = true
      console.log('[James] Audio autoplay desbloqueado')
    } catch (e) {
      console.warn('[James] Falha ao desbloquear audio:', e)
    }
  }, [])


  // ── TTS via backend — sem chave no frontend ──────────────────────────────────
  // Chama /api/james/tts. Funciona sem OPENAI_API_KEY no browser.
  const speak = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) return
    console.log('[James] speak() chamado:', text.slice(0, 60))
    setState('speaking')
    vadRef.current?.pause()

    try {
      const res = await fetch(`${BACKEND_URL}/api/james/tts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': API_SECRET },
        body:    JSON.stringify({ text: text.slice(0, 4096), voice: 'onyx' }),
        signal:  AbortSignal.timeout(20_000),
      })
      if (!res.ok) {
        console.error('[James] TTS respondeu com', res.status)
        throw new Error(`TTS ${res.status}`)
      }

      console.log('[James] TTS respondeu 200, reproduzindo áudio...')
      audioRef.current?.pause()
      const url     = URL.createObjectURL(await res.blob())
      const audioEl = new Audio(url)
      audioRef.current = audioEl

      await new Promise<void>((resolve) => {
        const cleanup = () => { URL.revokeObjectURL(url); resolve() }
        audioEl.onended  = cleanup
        audioEl.onerror  = (e) => {
          console.error('[James] Erro no elemento de áudio:', e)
          cleanup()
        }
        audioEl.onpause  = () => { if (!audioEl.ended) setTimeout(cleanup, 50) }
        audioEl.play().then(() => {
          console.log('[James] Áudio tocando com sucesso!')
        }).catch((err) => {
          console.error('[James] FALHA no play():', err.message)
          // Tentativa 2: usar AudioContext como fallback
          try {
            const audioCtx = new AudioContext()
            fetch(url).then(r => r.arrayBuffer()).then(buf => {
              audioCtx.decodeAudioData(buf, (decoded) => {
                const source = audioCtx.createBufferSource()
                source.buffer = decoded
                source.connect(audioCtx.destination)
                source.onended = cleanup
                source.start(0)
                console.log('[James] Áudio tocando via AudioContext (fallback)')
              }, cleanup)
            }).catch(cleanup)
          } catch {
            cleanup()
          }
        })
      })
    } catch (err) {
      console.error('[James] TTS falhou completamente:', err)
    } finally {
      // IMPORTANTE: Mesmo se TTS falhou, manter James ativo (não voltar a dormir)
      if (stateRef.current === 'speaking') {
        setState('active')
        vadRef.current?.start()
        console.log('[James] Transição speaking → active, VAD iniciado')
      }
    }
  }, [])


  // ── Watchdog: if any state gets stuck >35s, force-recover ─────────────
  // FIX: guarantees we never stay in thinking/speaking with busyRef=true forever
  const resetWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current)
    watchdogRef.current = setTimeout(() => {
      const s = stateRef.current
      if (['thinking', 'speaking', 'listening'].includes(s)) {
        console.warn('[James Watchdog] Dead state detected in:', s, '— force recovering')
        audioRef.current?.pause()
        audioRef.current = null
        busyRef.current = false
        pendingCtxRef.current = ''
        setState('active')
        vadRef.current?.start()
      }
    }, 35_000)
  }, [])

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null }
  }, [])

  // ── Process speech segment (called when user stops speaking) ─────────────
  const onSpeechEnd = useCallback(async (audioBlob: Blob) => {
    if (busyRef.current) return
    busyRef.current = true
    setState('thinking')
    resetWatchdog()

    try {
      if (audioBlob.size < 1000) {
        console.log('[James] Audio muito curto, ignorando')
        busyRef.current = false
        clearWatchdog()
        setState('active')
        vadRef.current?.start()
        return
      }

      const rawText = await transcribeBackend(audioBlob)
      if (!rawText || rawText.length < 2) {
        console.log('[James] Transcrição vazia, retomando escuta')
        busyRef.current = false
        clearWatchdog()
        setState('active')
        vadRef.current?.start()
        return
      }

      const t = rawText.toLowerCase().replace(/[.,!?;:]/g, '').trim()

      // ═══ COMANDO 1: FINALIZAR — "Obrigado James" fecha o Núcleo ═══════════
      const isDismiss =
        t.includes('obrigado james') || t.includes('tchau james') ||
        t.includes('até mais james') || t.includes('ate mais james') ||
        t.includes('sair james')     || t.includes('dispensar james')
      if (isDismiss) {
        pendingCtxRef.current = ''
        busyRef.current = false
        clearWatchdog()
        audioRef.current?.pause()
        vadRef.current?.pause()
        // Fala de despedida antes de fechar
        speak('Até mais, Comandante. Estarei aqui quando precisar.')
          .catch(() => {})
          .finally(() => {
            resetSession(sessionIdRef.current).catch(() => {})
            setState('closing')
            setTimeout(() => setState('nucleus'), 700)
          })
        return
      }

      // ═══ COMANDO 2: TRAVAR — "Ok James" para de falar e escuta ═══════════
      const isPause =
        t === 'ok james' || t === 'okay james' || t === 'okey james' ||
        t === 'ok' || t === 'okay' ||
        t.startsWith('ok james') || t.startsWith('okay james')
      if (isPause) {
        audioRef.current?.pause()       // para o áudio atual
        audioRef.current = null
        pendingCtxRef.current = ''      // limpa contexto pendente
        busyRef.current = false
        clearWatchdog()
        setState('active')              // volta ao estado ativo (pronto para ouvir)
        vadRef.current?.start()         // retoma o VAD
        return
      }

      // ═══ COMANDO 3: INICIAR (quando já ativo, re-saudação) ═══════════════
      const isGreeting =
        t.includes('olá james') || t.includes('ola james') ||
        t.includes('bom dia james') || t.includes('boa tarde james') ||
        t.includes('boa noite james') || t.includes('hey james') ||
        t.includes('ei james') || t.includes('eai james') ||
        t.includes('e aí james') || t.includes('e ai james')
      if (isGreeting && stateRef.current !== 'nucleus') {
        // James já está ativo mas recebeu uma saudação — responde e fica pronto
        const hour = new Date().getHours()
        const period = hour < 12 ? 'bom dia' : hour < 18 ? 'boa tarde' : 'boa noite'
        busyRef.current = false
        clearWatchdog()
        speak(`${period.charAt(0).toUpperCase() + period.slice(1)}, Comandante! Estou pronto. O que precisa?`).catch(() => {})
        return
      }

      // Full response — streaming: James começa a falar na primeira frase
      const fullMessage = pendingCtxRef.current ? `${pendingCtxRef.current}\n${rawText}` : rawText
      pendingCtxRef.current = ''

      // Fila de reprodução sequencial: chunk N toca enquanto chunk N+1 chega
      const audioQueue:  string[] = []   // URLs de áudio pendentes
      let   isPlaying  = false
      let   streamDone = false
      const urlsToRevoke: string[] = []

      const playNext = async () => {
        if (isPlaying) return
        if (audioQueue.length === 0) {
          if (streamDone) {
            // Nada mais vem — encerra o ciclo
            busyRef.current = false
            clearWatchdog()
            const s = stateRef.current
            if (s !== 'nucleus' && s !== 'closing' && s !== 'speaking' && s !== 'waiting') {
              setState('active')
              vadRef.current?.start()
            }
          }
          return
        }
        isPlaying = true
        const url = audioQueue.shift()!
        setState('speaking')
        vadRef.current?.pause()

        await new Promise<void>(resolve => {
          const el = new Audio(url)
          audioRef.current = el
          const cleanup = () => { URL.revokeObjectURL(url); resolve() }
          el.onended  = cleanup
          el.onerror  = cleanup
          el.onpause  = () => { if (!el.ended) setTimeout(cleanup, 50) }
          el.play().catch(cleanup)
        })

        isPlaying = false
        playNext()  // automaticamente toca o próximo
      }

      await callBackendStream(
        fullMessage, tenantId, sessionIdRef.current,
        /* onChunkReady */ (audioUrl) => {
          urlsToRevoke.push(audioUrl)
          audioQueue.push(audioUrl)
          playNext()  // inicia se não está tocando nada
        },
        /* onDone */ () => { streamDone = true; playNext() },
        /* onError */ () => {
          streamDone = true
          busyRef.current = false
          clearWatchdog()
          setState('active')
          vadRef.current?.start()
        },
      )
      // Não encerra aqui — o finally abaixo foi substituído pela lógica interna do stream
      return

    } catch (err) {
      console.error('[James] onSpeechEnd error:', err)
    } finally {
      busyRef.current = false
      clearWatchdog()
      const s = stateRef.current
      if (s !== 'nucleus' && s !== 'closing' && s !== 'speaking' && s !== 'waiting') {
        setState('active')
        vadRef.current?.start()
      }
    }
  }, [resetWatchdog, clearWatchdog, tenantId, speak])


  // ── Native VAD (MediaRecorder + Web Audio AnalyserNode) ─────────────────
  // Replaces MicVAD/ONNX — zero external dependencies, works in all browsers.
  // Algorithm: RMS volume polling → speech start when above threshold,
  // speech end after 1.2s of silence, sends WebM blob to backend Whisper.
  const initVAD = useCallback(async () => {
    if (vadRef.current || vadInitLock.current) return
    vadInitLock.current = true

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      if (!vadInitLock.current) { stream.getTracks().forEach(t => t.stop()); return }

      const ctx       = new AudioContext()
      const src       = ctx.createMediaStreamSource(stream)
      const analyser  = ctx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)

      const dataArr   = new Uint8Array(analyser.frequencyBinCount)
      let recorder: MediaRecorder | null = null
      let chunks: Blob[]                 = []
      let speaking                       = false
      let paused                         = false   // ← NEW: tracks if VAD is paused
      let silenceTimer: ReturnType<typeof setTimeout> | null = null
      let rafId: number

      const SPEECH_THRESHOLD = 18   // RMS 0-128 — above = speech
      const SILENCE_MS       = 1200 // ms of silence before we cut

      const startRecording = () => {
        if (recorder && recorder.state === 'recording') return
        chunks = []
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/webm' })
          onSpeechEnd(blob)
        }
        recorder.start()
        setState('listening')
      }

      const stopRecording = () => {
        if (!recorder || recorder.state !== 'recording') return
        recorder.stop()
        setState('thinking')
      }

      const tick = () => {
        if (!vadInitLock.current && !vadRef.current) return  // destroyed
        analyser.getByteTimeDomainData(dataArr)
        const rms = Math.sqrt(dataArr.reduce((s, v) => s + (v - 128) ** 2, 0) / dataArr.length)

        // Skip detection when paused or busy
        if (paused || busyRef.current) {
          rafId = requestAnimationFrame(tick)
          return
        }

        if (rms > SPEECH_THRESHOLD) {
          if (!speaking) {
            speaking = true
            if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
            startRecording()
          } else if (speaking && silenceTimer) {
            clearTimeout(silenceTimer); silenceTimer = null
          }
        } else if (speaking) {
          if (!silenceTimer) {
            silenceTimer = setTimeout(() => {
              speaking = false
              silenceTimer = null
              stopRecording()
            }, SILENCE_MS)
          }
        }
        rafId = requestAnimationFrame(tick)
      }

      rafId = requestAnimationFrame(tick)

      vadRef.current = {
        pause: () => {
          paused = true
          speaking = false
          if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
          // Stop any active recording without triggering onSpeechEnd
          if (recorder?.state === 'recording') {
            recorder.ondataavailable = null
            recorder.onstop = null
            try { recorder.stop() } catch {}
          }
        },
        start: () => {
          paused = false
          speaking = false
          busyRef.current = false
          // RAF already running — just un-pause
        },
        destroy: () => {
          cancelAnimationFrame(rafId)
          if (silenceTimer) clearTimeout(silenceTimer)
          if (recorder?.state === 'recording') recorder.stop()
          stream.getTracks().forEach(t => t.stop())
          ctx.close().catch(() => {})
        },
      }
    } catch (err) {
      console.error('[James VAD] failed to init:', err)
    } finally {
      vadInitLock.current = false
    }
  }, [onSpeechEnd])

  const destroyVAD = useCallback(() => {
    vadInitLock.current = false
    vadRef.current?.destroy()
    vadRef.current = null
  }, [])

  // ── Start/destroy VAD based on state ────────────────────────────────────
  useEffect(() => {
    if (state === 'active' || state === 'listening' || state === 'waiting') {
      initVAD()
    } else if (state === 'nucleus' || state === 'closing') {
      destroyVAD()
    }
  }, [state, initVAD, destroyVAD])

  // ── Summon & dismiss ────────────────────────────────────────────────────
  const summon = useCallback((greeting?: string) => {
    if (stateRef.current !== 'nucleus') return
    setState('opening')
    setTimeout(() => {
      setState('active')
      // James responde com a saudação apropriada
      if (greeting) {
        const hour = new Date().getHours()
        const period = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
        const responses: Record<string, string> = {
          'ola':       `${period}, Comandante! James ativo. Como posso ajudar?`,
          'bom dia':   `Bom dia, Comandante! Pronto para o trabalho.`,
          'boa tarde': `Boa tarde, Comandante! Estou à disposição.`,
          'boa noite': `Boa noite, Comandante! No que posso ser útil?`,
          'default':   `${period}, Comandante! James online. O que precisa?`,
        }
        const reply = responses[greeting] ?? responses['default']
        speak(reply).catch(() => {})
      }
    }, 750)
  }, [speak])

  const dismiss = useCallback(() => {
    audioRef.current?.pause()
    destroyVAD()
    pendingCtxRef.current = ''
    busyRef.current = false
    setState('closing')
    setTimeout(() => setState('nucleus'), 700)
  }, [destroyVAD])

  // ── Wake word listener (Web Speech API — nucleus only) ──────────────────
  // Detecta saudações como "Olá James", "Bom dia James", etc.
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    let alive = true
    let rec: ISpeechRecognition | null = null

    const loop = () => {
      if (!alive) return
      if (stateRef.current !== 'nucleus') { setTimeout(loop, 800); return }
      try {
        rec = new SR()
        rec.lang = 'pt-BR'; rec.continuous = false; rec.interimResults = false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rec.onresult = (e: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const heard = Array.from(e.results as any[]).map((r: any) => r[0].transcript.toLowerCase()).join(' ')
          const h = heard.replace(/[.,!?;:]/g, '').trim()

          // Detecta qual tipo de saudação pra James responder adequadamente
          if (h.includes('bom dia') && (h.includes('james') || h.includes('núcleo') || h.includes('nucleo'))) {
            summon('bom dia')
          } else if (h.includes('boa tarde') && (h.includes('james') || h.includes('núcleo') || h.includes('nucleo'))) {
            summon('boa tarde')
          } else if (h.includes('boa noite') && (h.includes('james') || h.includes('núcleo') || h.includes('nucleo'))) {
            summon('boa noite')
          } else if ((h.includes('olá') || h.includes('ola') || h.includes('hey') || h.includes('ei') || h.includes('eai') || h.includes('e aí') || h.includes('e ai')) && (h.includes('james') || h.includes('núcleo') || h.includes('nucleo'))) {
            summon('ola')
          } else if (h.includes('james') || h.includes('núcleo') || h.includes('nucleo')) {
            summon('default')
          }
        }
        rec.onend  = () => { if (alive) setTimeout(loop, 400) }
        rec.onerror = () => { if (alive) setTimeout(loop, 1200) }
        rec.start()
      } catch { if (alive) setTimeout(loop, 1500) }
    }

    const t = setTimeout(loop, 600)
    return () => { alive = false; clearTimeout(t); try { rec?.stop() } catch {} }
  }, [summon])

  // ── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      destroyVAD()
    }
  }, [destroyVAD])

  // ── Orb click ───────────────────────────────────────────────────────────
  const handleOrbClick = useCallback(() => {
    // CRÍTICO: Desbloquear audio no gesto direto do usuário
    unlockAudio()
    const s = stateRef.current
    console.log('[James] Orb clicado, state:', s)
    if (s === 'nucleus')  { summon('default'); return }                      // clique acorda James com saudação
    if (s === 'opening')  return
    if (s === 'speaking') { audioRef.current?.pause(); setState('active');  return }
    if (s === 'active' || s === 'waiting') { dismiss();                     return }
  }, [dismiss, summon, unlockAudio])

  // ── UI helpers ──────────────────────────────────────────────────────────

  const isPresent = ['opening','active','listening','waiting','speaking','thinking'].includes(state)

  const hint =
    state === 'nucleus'   ? 'Diga "Olá James" · "Bom dia" · "Boa tarde" · "Boa noite James"' :
    state === 'active'    ? 'Ouço você — fale · "Ok James" = pausa · "Obrigado James" = sair' :
    state === 'listening' ? '🎤 Ouvindo…' :
    state === 'waiting'   ? 'Aguardo… · "Ok James" = pausa' :
    state === 'thinking'  ? '🧠 Processando…' :
    state === 'speaking'  ? '🔊 Falando… · "Ok James" = para imediatamente' : ''

  return (
    <div style={{
      width: '100vw', height: '100vh',
      overflow: 'hidden', position: 'relative',
      userSelect: 'none',
      background: '#030308',
    }}>
      {/* 3D Nucleus — full screen background */}
      <Nucleus state={state} />

      {/* Clickable overlay */}
      <div
        onClick={handleOrbClick}
        style={{
          position: 'absolute', inset: 0, zIndex: 2,
          cursor: 'pointer',
        }}
      />

      {/* Sound bars */}
      <div style={{ position: 'absolute', bottom: 'clamp(80px,10vh,120px)', left: '50%', transform: 'translateX(-50%)', zIndex: 5 }}>
        <SoundBars state={state} />
      </div>

      {/* Hint text */}
      {hint && (
        <div style={{
          position: 'absolute', bottom: 'clamp(40px,5vh,60px)', left: '50%', transform: 'translateX(-50%)',
          color: state === 'waiting' ? 'rgba(245,158,11,0.65)' : 'rgba(100,160,220,0.55)',
          fontSize: 'clamp(10px, 2.5vw, 12px)', zIndex: 5,
          letterSpacing: '0.08em', fontFamily: 'Inter, sans-serif',
          textAlign: 'center', maxWidth: '90vw',
          transition: 'color 0.5s ease',
        }}>
          {hint}
        </div>
      )}

      {/* Status dot */}
      <div style={{
        position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
        width: 5, height: 5, borderRadius: '50%',
        background: isPresent ? (
          state === 'listening' ? '#4ade80' :
          state === 'waiting'   ? '#f59e0b' : '#00B4FF'
        ) : 'rgba(0,180,255,0.2)',
        boxShadow: isPresent ? `0 0 8px ${
          state === 'listening' ? '#4ade80' :
          state === 'waiting'   ? '#f59e0b' : '#00B4FF'
        }` : 'none',
        transition: 'all 0.5s ease', zIndex: 10,
      }} />

      {/* Back button */}
      <button
        onClick={() => { dismiss(); navigate('/dashboard') }}
        style={{
          position: 'absolute', top: 14, left: 14, zIndex: 10,
          width: 30, height: 30, borderRadius: '50%',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', opacity: 0.35,
        }}
      >
        <span style={{ color: 'rgba(107,122,153,0.9)', fontSize: 13 }}>←</span>
      </button>
    </div>
  )
}
