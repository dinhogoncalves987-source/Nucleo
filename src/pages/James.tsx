import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import JamesCoreWrapper from '../components/james-core/JamesCoreWrapper'
import { backendFetch } from '../lib/backend'
import { requestJamesConversation, accessJamesMemory, type JamesTurn } from '../lib/jamesConversation'
import { useTenant } from '../contexts/tenant-context'
import { transitionJamesWakeState } from '../lib/jamesWakeTransition'
import { startJamesWakeListener } from '../lib/jamesWakeListener'
import { advanceJamesVoiceContext, createJamesVoiceContext, cancelJamesRecognition, voiceCallbackIsCurrent } from '../lib/jamesVoiceContext'
import { createJamesOperationGate } from '../lib/jamesOperationGate'
import { assertMemoryMode, rememberSession } from '../lib/jamesSessionPointer'
// Entrada de voz via SpeechRecognition nativo do navegador

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
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}


// ─── Backend helpers (todo o cérebro vive no backend) ──────────────────────

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
void EnergyGrid


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
export default function James({ contactId = null }: { contactId?: string | null } = {}) {
  const navigate = useNavigate()
  const { tenant, user } = useTenant()
  const [draft, setDraft] = useState('')
  const [replyText, setReplyText] = useState('')
  const [conversationError, setConversationError] = useState('')
  const conversation = useRef<JamesTurn[]>([])
  const requestRef = useRef<AbortController | null>(null)
  const sessionRef = useRef('')
  const pendingTurn = useRef<{ id: string; message: string } | null>(null)
  const memoryKey = `nucleo.james.session:${tenant?.id ?? ''}:${user?.id ?? ''}:${contactId ?? 'general'}`
  const operationGate = useRef(createJamesOperationGate()).current
  operationGate.bind(memoryKey)
  const voiceContext = useRef(createJamesVoiceContext()).current
  voiceContext.bind(memoryKey)
  const [, requestVoiceRender] = useState(0)
  const voiceOrigin = voiceContext.snapshot()
  const [memoryMode, setMemoryMode] = useState<'loading' | 'disabled' | 'persistent'>('loading')
  const [memoryRefresh, setMemoryRefresh] = useState(0)
  const [state, setRenderedState] = useState<NucleoState>('nucleus')
  const stateRef = useRef<NucleoState>('nucleus')
  const wakeControllerRef = useRef<ReturnType<typeof startJamesWakeListener> | null>(null)
  const setState = useCallback((next: NucleoState) => {
    transitionJamesWakeState(next, wakeControllerRef.current, () => {
      stateRef.current = next
      setRenderedState(next)
    })
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    operationGate.invalidate()
    const operation = operationGate.begin()!
    const timer = setTimeout(() => controller.abort(), 15000)
    conversation.current = []; pendingTurn.current = null
    setReplyText(''); setDraft(''); setConversationError(''); setState('nucleus'); setMemoryMode('loading')
    let saved: string | null = null
    try { saved = localStorage.getItem(memoryKey) } catch { /* no browser storage: still use server memory */ }
    sessionRef.current = saved && /^[0-9a-f-]{36}$/i.test(saved) ? saved : crypto.randomUUID()
    const loadedSession = sessionRef.current
    void accessJamesMemory(backendFetch, 'load', loadedSession, contactId, controller.signal).then(result => {
      if (!operationGate.current(operation) || controller.signal.aborted) return
      assertMemoryMode(saved, result.memory)
      setMemoryMode(result.memory)
      if (result.memory === 'persistent') {
        try { rememberSession(localStorage, memoryKey, loadedSession, result.memory) } catch { /* storage inaccessible */ }
        conversation.current = result.turns
        setReplyText(result.turns.filter(turn => turn.role === 'assistant').slice(-1)[0]?.content ?? '')
        pendingTurn.current = result.pending ?? null
        if (result.pending) {
          setDraft(result.pending.message)
          setConversationError('Existe uma tentativa pendente. Retomar consulta o estado sem iniciar outra geração.')
        }
      }
    }).catch(() => {
      if (operationGate.current(operation)) {
        setMemoryMode('persistent')
        setConversationError('A memória está indisponível. Use Retomar conversa; nenhuma geração foi iniciada.')
      }
    }).finally(() => { clearTimeout(timer); operationGate.finish(operation) })
    return () => { voiceContext.invalidate(); cancelJamesRecognition(recognitionRef.current); recognitionRef.current = null; if (listenTimeoutRef.current) clearTimeout(listenTimeoutRef.current); listenTimeoutRef.current = null; operationGate.invalidate(); clearTimeout(timer); controller.abort(); requestRef.current?.abort(); requestRef.current = null; window.speechSynthesis?.cancel() }
  }, [memoryKey, contactId, memoryRefresh, operationGate, voiceContext])

  // ── Runtime refs ────────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recognitionRef = useRef<ISpeechRecognition | null>(null)
  const listenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioUnlocked = useRef(false)

  const unlockAudio = useCallback(() => {
    if (audioUnlocked.current) return
    try {
      const ctx = new AudioContext()
      const source = ctx.createBufferSource()
      source.buffer = ctx.createBuffer(1, 1, 22050)
      source.connect(ctx.destination)
      source.start(0)
      audioUnlocked.current = true
    } catch { /* fallback nativo não exige desbloqueio antecipado */ }
  }, [])

  const stopRecognition = useCallback(() => {
    if (listenTimeoutRef.current) clearTimeout(listenTimeoutRef.current)
    listenTimeoutRef.current = null
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (!recognition) return
    cancelJamesRecognition(recognition)
  }, [])

  const speakNative = useCallback((text: string) => new Promise<void>((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const voices = window.speechSynthesis.getVoices()
    utterance.voice = voices.find(voice => voice.lang.toLowerCase() === 'pt-br')
      ?? voices.find(voice => voice.lang.toLowerCase().startsWith('pt'))
      ?? null
    utterance.lang = 'pt-BR'
    utterance.rate = 1.02
    const timeout = setTimeout(() => { window.speechSynthesis.cancel(); resolve() }, 60_000)
    utterance.onend = () => { clearTimeout(timeout); resolve() }
    utterance.onerror = () => { clearTimeout(timeout); resolve() }
    window.speechSynthesis.speak(utterance)
  }), [])

  const speak = useCallback(async (text: string, operation: number): Promise<void> => {
    if (!text.trim()) return
    setState('speaking')
    try { await speakNative(text) }
    finally { if (operationGate.current(operation) && stateRef.current === 'speaking') setState('active') }
  }, [speakNative, operationGate])

  const submitCommand = useCallback(async (rawText: string) => {
    const command = rawText.trim()
    if (!voiceContext.current(voiceOrigin) || !command || requestRef.current || memoryMode === 'loading') return
    if (pendingTurn.current && pendingTurn.current.message !== command) { setConversationError('Consulte a tentativa pendente antes de mudar a mensagem.'); return }
    const operation = operationGate.begin()
    if (operation === null) return
    const submittedSession = sessionRef.current
    stopRecognition()
    setDraft(command)
    setConversationError('')
    setState('thinking')
    const controller = new AbortController()
    requestRef.current = controller
    const timeout = setTimeout(() => controller.abort(), 25000)
    try {
      if (memoryMode === 'persistent' && !pendingTurn.current) pendingTurn.current = { id: crypto.randomUUID(), message: command }
      const scope = memoryMode === 'persistent' && pendingTurn.current
        ? { sessionId: submittedSession, requestId: pendingTurn.current.id, contactId } : undefined
      const reply = await requestJamesConversation(backendFetch, command, conversation.current, controller.signal, scope)
      if (!operationGate.current(operation) || controller.signal.aborted || requestRef.current !== controller) return
      conversation.current = [...conversation.current, { role: 'user', content: command }, { role: 'assistant', content: reply }].slice(-6) as JamesTurn[]
      pendingTurn.current = null
      setReplyText(reply)
      setDraft('')
      await speak(reply, operation)
    } catch (error) {
      if (operationGate.current(operation) && requestRef.current === controller) {
        setConversationError(controller.signal.aborted ? 'A consulta foi interrompida. Sua mensagem foi preservada.' : error instanceof Error ? error.message : 'A conversa está indisponível.')
        setState('active')
      }
    } finally {
      clearTimeout(timeout)
      if (requestRef.current === controller) requestRef.current = null
      operationGate.finish(operation)
    }
  }, [speak, stopRecognition, memoryMode, contactId, operationGate, voiceContext, voiceOrigin])

  const startListening = useCallback(() => {
    if (!voiceContext.current(voiceOrigin) || memoryMode === 'loading' || stateRef.current === 'thinking' || stateRef.current === 'speaking') return
    stopRecognition()
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) { setState('active'); return }
    setState('listening')
    const recognition = new Recognition()
    recognition.lang = 'pt-BR'
    recognition.continuous = false
    recognition.interimResults = false
    recognitionRef.current = recognition
    const isCurrent = () => voiceCallbackIsCurrent(voiceContext, voiceOrigin, recognition, recognitionRef.current)
    recognition.onresult = event => {
      if (!isCurrent()) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = Array.from(event.results as any[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalText = results.map((result: any) => result[0]?.transcript ?? '').join(' ').trim()
      stopRecognition()
      if (finalText) void submitCommand(finalText)
      else setState('active')
    }
    recognition.onerror = () => { if (!isCurrent()) return; stopRecognition(); setState('active') }
    recognition.onend = () => {
      if (!isCurrent()) return
      stopRecognition()
      if (stateRef.current === 'listening') setState('active')
    }
    try {
      recognition.start()
      listenTimeoutRef.current = setTimeout(() => {
        if (isCurrent() && stateRef.current === 'listening') { stopRecognition(); setState('active') }
      }, 20_000)
    } catch { stopRecognition(); setState('active') }
  }, [stopRecognition, submitCommand, voiceContext, voiceOrigin, memoryMode])

  const summon = useCallback(() => {
    if (!voiceContext.current(voiceOrigin) || memoryMode === 'loading' || stateRef.current !== 'nucleus') return
    setState('opening')
    setTimeout(() => {
      if (!voiceContext.current(voiceOrigin)) return
      setState('active')
      setTimeout(() => { if (voiceContext.current(voiceOrigin)) startListening() }, 150)
    }, 750)
  }, [startListening, voiceContext, voiceOrigin, memoryMode])

  const dismiss = useCallback(() => {
    requestRef.current?.abort(); requestRef.current = null
    stopRecognition()
    audioRef.current?.pause()
    window.speechSynthesis?.cancel()
    setState('closing')
    setTimeout(() => { if (voiceContext.current(voiceOrigin)) setState('nucleus') }, 700)
  }, [stopRecognition, voiceContext, voiceOrigin])

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) return
    const controller = startJamesWakeListener({
      createRecognition: () => new Recognition(),
      isCurrent: () => voiceContext.current(voiceOrigin),
      shouldListen: () => memoryMode !== 'loading' && stateRef.current === 'nucleus',
      onWake: summon,
    })
    wakeControllerRef.current = controller
    return () => {
      if (wakeControllerRef.current === controller) wakeControllerRef.current = null
      controller()
    }
  }, [summon, voiceContext, voiceOrigin, memoryMode])

  useEffect(() => () => {
    stopRecognition()
    audioRef.current?.pause()
    window.speechSynthesis?.cancel()
    if (watchdogRef.current) clearTimeout(watchdogRef.current)
  }, [stopRecognition])

  const handleOrbClick = useCallback(() => {
    unlockAudio()
    const current = stateRef.current
    if (current === 'nucleus') { summon(); return }
    if (current === 'opening' || current === 'thinking') return
    if (current === 'speaking') {
      audioRef.current?.pause()
      window.speechSynthesis?.cancel()
      setState('active')
      return
    }
    if (current === 'active' || current === 'waiting') startListening()
    else if (current === 'listening') { stopRecognition(); setState('active') }
  }, [startListening, stopRecognition, summon, unlockAudio])
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

      <section aria-label="Conversa com James" style={{ position: 'absolute', top: 60, right: 20, zIndex: 12, width: 'min(420px, calc(100vw - 40px))', padding: 16, borderRadius: 12, background: 'rgba(3,3,8,0.88)', color: '#e5e7eb' }}>
        <p style={{ marginBottom: 8 }}>James · Núcleo</p>
        <p style={{ fontSize: 12, marginBottom: 12 }}>Conversa de apoio. Nenhuma ação externa é executada. {memoryMode === 'persistent' ? 'Memória privada desta empresa, usuário e contato.' : memoryMode === 'loading' ? 'Consultando memória…' : 'Histórico temporário desta tela.'}</p>
        {replyText && <p role="status" style={{ whiteSpace: 'pre-wrap', maxHeight: '30vh', overflow: 'auto', userSelect: 'text', marginBottom: 12 }}>{replyText}</p>}
        {conversationError && <p role="alert" style={{ color: '#fca5a5', marginBottom: 8 }}>{conversationError}</p>}
        <form onSubmit={event => { event.preventDefault(); void submitCommand(draft) }}>
          <label htmlFor="james-command">Mensagem para James</label>
          <textarea id="james-command" value={draft} maxLength={4000} disabled={state === 'thinking' || state === 'speaking'} onChange={event => setDraft([...event.target.value].slice(0, 2000).join(''))} rows={3} style={{ width: '100%', color: '#e5e7eb', background: '#111827', marginTop: 6, padding: 8 }} />
          <button type="submit" disabled={!draft.trim() || memoryMode === 'loading' || state === 'thinking' || state === 'speaking'} style={{ padding: 8 }}> {state === 'thinking' ? 'Consultando…' : 'Enviar'} </button>
          <button type="button" disabled={memoryMode === 'loading' || state === 'thinking' || state === 'speaking'} onClick={() => { void (async () => {
            if (memoryMode === 'loading' || requestRef.current) return
            const operation = operationGate.begin()
            if (operation === null) return
            advanceJamesVoiceContext(voiceContext, () => requestVoiceRender(value => value + 1)); stopRecognition()
            const closingSession = sessionRef.current
            try {
            if (memoryMode === 'persistent') {
              try { await accessJamesMemory(backendFetch, 'close', closingSession, contactId, AbortSignal.timeout(15000)) }
              catch { if (operationGate.current(operation)) setConversationError('Não foi possível encerrar. Retome a conversa para conferir o estado.'); return }
            }
            if (!operationGate.current(operation)) return
            conversation.current = []; pendingTurn.current = null; sessionRef.current = crypto.randomUUID()
            try { rememberSession(localStorage, memoryKey, sessionRef.current, memoryMode) } catch { /* storage inaccessible */ }
            setReplyText(''); setConversationError(''); setDraft('')
            } finally { operationGate.finish(operation) }
          })() }} style={{ padding: 8 }}>Nova conversa</button>
          <button type="button" disabled={memoryMode === 'loading' || state === 'thinking' || state === 'speaking'} onClick={() => {
            if (memoryMode === 'loading' || requestRef.current || operationGate.begin() === null) return
            advanceJamesVoiceContext(voiceContext, () => requestVoiceRender(value => value + 1)); stopRecognition()
            setMemoryMode('loading'); setMemoryRefresh(value => value + 1)
          }} style={{ padding: 8 }}>Retomar conversa</button>
        </form>
      </section>

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
