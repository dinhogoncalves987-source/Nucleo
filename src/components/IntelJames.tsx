// ════════════════════════════════════════════════════════════════════════════
// IntelJames.tsx — James: Assistente executivo operacional com voz
// Camada ÚNICA de inteligência — v2: classificação, confirmação, sessão
// ════════════════════════════════════════════════════════════════════════════
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

// ── Types ─────────────────────────────────────────────────────────────────
interface JamesMessage {
  id: string
  role: 'user' | 'james' | 'system'
  text: string
  ts: string
  intent?: IntentType
  voiceText?: string // shortened version for TTS
}

export interface JamesContext {
  page: 'overview' | 'chips' | 'chipDetail' | 'analytics' | 'memory' | 'inbox'
  data: Record<string, unknown>
}

type InteractionMode = 'both' | 'voice' | 'text'
type IntentType = 'info' | 'nav' | 'action'
type JamesState = 'idle' | 'listening' | 'processing' | 'speaking' | 'confirming' | 'error'

interface SessionContext {
  route: string
  entity: string | null
  recentCommands: string[]
  lastReply: string | null
}

interface PendingAction {
  description: string
  command: string
  onConfirm: () => void
}

interface OpLog {
  ts: number
  command: string
  intent: IntentType
  success: boolean
  responseMs: number
}

// ── Constants ─────────────────────────────────────────────────────────────
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3001'
const API_SECRET  = import.meta.env.VITE_API_SECRET  ?? ''

const PAGE_LABELS: Record<JamesContext['page'], string> = {
  overview: 'Visão Geral Intel', chips: 'Lista de Chips',
  chipDetail: 'Detalhe do Chip', analytics: 'Analytics',
  memory: 'Memórias', inbox: 'Inbox',
}

const NAV_ROUTES: Record<string, string> = {
  'overview': '/intel', 'visão geral': '/intel', 'intel': '/intel',
  'chips': '/intel/chips', 'lista de chips': '/intel/chips',
  'analytics': '/intel/analytics', 'análise': '/intel/analytics',
  'memórias': '/intel/memory', 'memoria': '/intel/memory', 'memória': '/intel/memory',
  'inbox': '/intel/inbox', 'caixa de entrada': '/intel/inbox', 'mensagens': '/intel/inbox',
}

const METRIC_NAMES: Record<string, string> = {
  'aprendizado': 'learn', 'learn': 'learn', 'aprendizagem': 'learn',
  'conversão': 'conv', 'conversao': 'conv', 'conv': 'conv',
  'promoção': 'promo', 'promocao': 'promo', 'promo': 'promo', 'promocoes': 'promo',
  'recuperação': 'recov', 'recuperacao': 'recov', 'recov': 'recov', 'reativação': 'recov',
  'saúde': 'health', 'saude': 'health', 'health': 'health',
  'temperatura': 'heat', 'heat': 'heat', 'calor': 'heat',
}

// ── Intent classifier ─────────────────────────────────────────────────────
const ACTION_KEYWORDS = [
  'enviar', 'salvar', 'excluir', 'deletar', 'remover', 'aprovar', 'rejeitar',
  'ativar', 'desativar', 'pausar', 'cancelar', 'criar', 'editar', 'alterar',
  'disparar', 'executar', 'confirmar', 'lançar', 'resetar',
]
const NAV_KEYWORDS = [
  'abrir', 'ir para', 'navegar', 'mostrar', 'acessar', 'ver', 'entrar',
  'voltar', 'sair', 'explorar', 'detalhe',
]

function classifyIntent(text: string): { type: IntentType; navTarget?: string } {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Check for navigation
  for (const keyword of NAV_KEYWORDS) {
    if (lower.includes(keyword)) {
      // Metric-specific navigation within a chip (e.g. "ver aprendizado do chip 1")
      const chipMatch = lower.match(/chip\s*(\d+|chi-?\d+)/i)
      if (chipMatch) {
        const num = chipMatch[1].replace(/\D/g, '').padStart(3, '0')
        const chipId = `CHI-${num}`
        for (const [metricName, metricKey] of Object.entries(METRIC_NAMES)) {
          if (lower.includes(metricName)) {
            return { type: 'nav', navTarget: `/intel/chips/${chipId}/${metricKey}` }
          }
        }
        return { type: 'nav', navTarget: `/intel/chips/${chipId}` }
      }

      // Metric navigation from current chip context (e.g. "ver aprendizado")
      for (const [metricName, metricKey] of Object.entries(METRIC_NAMES)) {
        if (lower.includes(metricName)) {
          // Check if we're on a chip page already via URL
          const path = window.location.pathname
          const currentChipMatch = path.match(/\/intel\/chips\/(CHI-\d+)/)
          if (currentChipMatch) {
            return { type: 'nav', navTarget: `/intel/chips/${currentChipMatch[1]}/${metricKey}` }
          }
        }
      }

      // Standard page navigation
      for (const [target, route] of Object.entries(NAV_ROUTES)) {
        if (lower.includes(target)) return { type: 'nav', navTarget: route }
      }
    }
  }

  // Check for operational actions
  for (const keyword of ACTION_KEYWORDS) {
    if (lower.includes(keyword)) return { type: 'action' }
  }

  return { type: 'info' }
}

// ── System prompt builder ─────────────────────────────────────────────────
function buildSystemPrompt(ctx: JamesContext, session: SessionContext): string {
  const pageLabel = PAGE_LABELS[ctx.page]
  return `Você é James — o executivo digital central da plataforma O Núcleo.

CONTEXTO DE SESSÃO:
- Página atual: "${pageLabel}" (${session.route})
- Entidade ativa: ${session.entity || 'nenhuma'}
- Últimos comandos: ${session.recentCommands.slice(-3).join(' → ') || 'nenhum'}
- Última resposta: ${session.lastReply?.slice(0, 80) || 'nenhuma'}

DADOS DA PÁGINA:
${JSON.stringify(ctx.data, null, 2)}

FORMATO DE RESPOSTA:
Responda SEMPRE neste formato de 3 partes:

**Situação:** [1 frase sobre o estado atual dos dados]
**Insight:** [1 frase sobre o principal problema ou oportunidade]
**Ação:** [1 frase com a recomendação concreta]

REGRAS:
- Tom executivo: direto, claro, sem floreio
- Máximo 60 palavras no TOTAL
- NÃO faça alterações automáticas
- NÃO se refira como Copilot, assistente ou bot
- Responda em português
- Se o comando for de navegação, indique a rota exata
- Se o comando for ação operacional, descreva o que será feito e peça confirmação`
}

// ── Quick Actions ─────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: '📋 Resumo', prompt: 'Resumo executivo da tela atual.' },
  { label: '⚠️ Problemas', prompt: 'Principais problemas e riscos.' },
  { label: '🎯 Ação', prompt: 'Próxima ação operacional prioritária.' },
]

// ── SpeechRecognition ─────────────────────────────────────────────────────
type SpeechRecognitionType = InstanceType<typeof window.webkitSpeechRecognition>

function getSpeechRecognition(): SpeechRecognitionType | null {
  const SR = (window as unknown as { SpeechRecognition?: typeof window.webkitSpeechRecognition; webkitSpeechRecognition?: typeof window.webkitSpeechRecognition }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: typeof window.webkitSpeechRecognition }).webkitSpeechRecognition
  if (!SR) return null
  const recognition = new SR()
  recognition.lang = 'pt-BR'
  recognition.continuous = false
  recognition.interimResults = false
  return recognition
}

// ── Shorten text for TTS ──────────────────────────────────────────────────
function shortenForVoice(text: string): string {
  // Remove markdown bold markers
  let clean = text.replace(/\*\*/g, '')
  // Remove section labels like "Situação:", "Insight:", "Ação:"
  clean = clean.replace(/(Situação|Insight|Ação):\s*/gi, '')
  // Limit length
  if (clean.length > 180) clean = clean.slice(0, 177) + '...'
  return clean.trim()
}

// ── Component ─────────────────────────────────────────────────────────────
export default function IntelJames({ context }: { context: JamesContext }) {
  const navigate = useNavigate()

  // Core state
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<JamesMessage[]>([])
  const [input, setInput] = useState('')
  const [jState, setJState] = useState<JamesState>('idle')
  const [mode, setMode] = useState<InteractionMode>('both')
  const [voiceEnabled, setVoiceEnabled] = useState(true)

  // Session context
  const [session, setSession] = useState<SessionContext>({
    route: `/intel`, entity: null, recentCommands: [], lastReply: null,
  })

  // Pending confirmation
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  // Operational logs
  const logsRef = useRef<OpLog[]>([])

  // Refs
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<SpeechRecognitionType | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (open && mode !== 'voice') inputRef.current?.focus() }, [open, mode])

  // Update session when page changes
  const prevPage = useRef(context.page)
  useEffect(() => {
    if (prevPage.current !== context.page) {
      setMessages([])
      setPendingAction(null)
      prevPage.current = context.page
    }
    setSession(s => ({
      ...s,
      route: window.location.pathname,
      entity: context.page === 'chipDetail' ? String((context.data as Record<string, unknown>)?.chip && ((context.data as Record<string, unknown>).chip as Record<string, string>)?.id || null) : null,
    }))
  }, [context.page, context.data])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      audioRef.current?.pause()
      window.speechSynthesis?.cancel()
    }
  }, [])

  // ── Log operation ───────────────────────────────────────────────────────
  const logOp = useCallback((command: string, intent: IntentType, success: boolean, responseMs: number) => {
    const entry: OpLog = { ts: Date.now(), command: command.slice(0, 60), intent, success, responseMs }
    logsRef.current = [...logsRef.current.slice(-49), entry]
    if (import.meta.env.DEV) {
      console.log(`[JAMES] ${intent.toUpperCase()} | ${success ? '✓' : '✗'} | ${responseMs}ms | "${command.slice(0, 40)}"`)
    }
  }, [])

  // ── TTS ─────────────────────────────────────────────────────────────────
  const speakText = useCallback(async (text: string) => {
    if (!voiceEnabled || mode === 'text') return
    const voiceText = shortenForVoice(text)
    setJState('speaking')
    try {
      const res = await fetch(`${BACKEND_URL}/api/james/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': API_SECRET },
        body: JSON.stringify({ text: voiceText, voice: 'onyx' }),
      })
      if (!res.ok) throw new Error('TTS failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => { setJState('idle'); URL.revokeObjectURL(url) }
      audio.onerror = () => { setJState('idle'); URL.revokeObjectURL(url) }
      await audio.play()
    } catch {
      setJState('idle')
      if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(voiceText)
        utter.lang = 'pt-BR'; utter.rate = 1.1
        utter.onend = () => setJState('idle')
        setJState('speaking')
        window.speechSynthesis.speak(utter)
      }
    }
  }, [voiceEnabled, mode])

  // ── STT ─────────────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (jState !== 'idle' && jState !== 'error') return
    const recognition = getSpeechRecognition()
    if (!recognition) {
      setJState('error')
      addSystemMsg('Microfone não disponível. Use Chrome para reconhecimento de voz.')
      setTimeout(() => setJState('idle'), 3000)
      return
    }
    recognitionRef.current = recognition
    setJState('listening')

    recognition.onresult = (event: { results: { item: (i: number) => { item: (j: number) => { transcript: string } }; length: number } }) => {
      const transcript = event.results.item(0).item(0).transcript
      setJState('idle')
      if (transcript.trim()) void processCommand(transcript.trim())
    }
    recognition.onerror = (e: { error: string }) => {
      setJState('error')
      if (e.error === 'not-allowed') {
        addSystemMsg('Permissão de microfone negada. Habilite nas configurações do navegador.')
      } else if (e.error === 'no-speech') {
        addSystemMsg('Nenhuma fala detectada. Tente novamente.')
      }
      setTimeout(() => setJState('idle'), 2000)
    }
    recognition.onend = () => { if (jState === 'listening') setJState('idle') }
    recognition.start()
  }, [jState])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setJState('idle')
  }, [])

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause()
    window.speechSynthesis?.cancel()
    setJState('idle')
  }, [])

  // ── Add system message ──────────────────────────────────────────────────
  const addSystemMsg = useCallback((text: string) => {
    setMessages(m => [...m, {
      id: Date.now().toString(), role: 'system', text,
      ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    }])
  }, [])

  // ── Confirm / Cancel pending action ─────────────────────────────────────
  const confirmAction = useCallback(() => {
    if (!pendingAction) return
    pendingAction.onConfirm()
    addSystemMsg(`✅ Ação executada: ${pendingAction.description}`)
    logOp(pendingAction.command, 'action', true, 0)
    setPendingAction(null)
    setJState('idle')
  }, [pendingAction, addSystemMsg, logOp])

  const cancelAction = useCallback(() => {
    addSystemMsg('❌ Ação cancelada.')
    setPendingAction(null)
    setJState('idle')
  }, [addSystemMsg])

  // ── Process command ─────────────────────────────────────────────────────
  const processCommand = useCallback(async (userText: string) => {
    if (!userText.trim() || jState === 'processing') return

    const startMs = Date.now()
    const { type: intent, navTarget } = classifyIntent(userText)

    // Add user message
    const userMsg: JamesMessage = {
      id: Date.now().toString(), role: 'user', text: userText.trim(),
      ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      intent,
    }
    setMessages(m => [...m, userMsg])
    setInput('')

    // Update session
    setSession(s => ({
      ...s,
      recentCommands: [...s.recentCommands.slice(-4), userText.trim()],
    }))

    // ── NAVIGATION: execute directly ──────────────────────────────────────
    if (intent === 'nav' && navTarget) {
      const jMsg: JamesMessage = {
        id: (Date.now() + 1).toString(), role: 'james',
        text: `Navegando para ${navTarget}`,
        voiceText: `Abrindo ${navTarget.split('/').pop()}`,
        ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        intent,
      }
      setMessages(m => [...m, jMsg])
      logOp(userText, 'nav', true, Date.now() - startMs)
      void speakText(jMsg.voiceText || jMsg.text)
      setTimeout(() => navigate(navTarget), 600)
      return
    }

    // ── ACTION: require confirmation ──────────────────────────────────────
    if (intent === 'action') {
      setJState('confirming')
      const jMsg: JamesMessage = {
        id: (Date.now() + 1).toString(), role: 'james',
        text: `⚠️ Ação detectada: "${userText}"\n\nEssa operação pode alterar dados. Deseja confirmar?`,
        voiceText: `Ação detectada. Deseja confirmar: ${userText}?`,
        ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        intent,
      }
      setMessages(m => [...m, jMsg])
      setPendingAction({
        description: userText,
        command: userText,
        onConfirm: () => addSystemMsg(`Ação "${userText}" registrada. (Integração futura com backend)`),
      })
      logOp(userText, 'action', true, Date.now() - startMs)
      void speakText(jMsg.voiceText || jMsg.text)
      return
    }

    // ── INFORMATIVE: send to AI ───────────────────────────────────────────
    setJState('processing')
    try {
      const res = await fetch(`${BACKEND_URL}/api/james/intel-think`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': API_SECRET },
        body: JSON.stringify({
          message: userText.trim(),
          systemPrompt: buildSystemPrompt(context, session),
        }),
      })
      const data = await res.json()
      const reply = data.reply || 'Sem resposta do servidor.'
      const responseMs = Date.now() - startMs

      const jMsg: JamesMessage = {
        id: (Date.now() + 1).toString(), role: 'james', text: reply,
        voiceText: shortenForVoice(reply),
        ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        intent,
      }
      setMessages(m => [...m, jMsg])
      setSession(s => ({ ...s, lastReply: reply }))
      logOp(userText, 'info', true, responseMs)
      void speakText(reply)
    } catch {
      setJState('error')
      addSystemMsg('Erro ao conectar com o backend.')
      logOp(userText, 'info', false, Date.now() - startMs)
      setTimeout(() => setJState('idle'), 2000)
    } finally {
      if (jState === 'processing') setJState('idle')
    }
  }, [jState, context, session, navigate, speakText, addSystemMsg, logOp])

  // ── Mode labels ─────────────────────────────────────────────────────────
  const modeLabels: Record<InteractionMode, string> = { both: 'Voz + Texto', voice: 'Só Voz', text: 'Só Texto' }
  const nextMode: Record<InteractionMode, InteractionMode> = { both: 'voice', voice: 'text', text: 'both' }

  // ── State colors ────────────────────────────────────────────────────────
  const stateConfig: Record<JamesState, { color: string; label: string; icon: string }> = {
    idle:       { color: '#34d399', label: 'Online',            icon: '●' },
    listening:  { color: '#ef4444', label: 'Ouvindo',           icon: '🎤' },
    processing: { color: '#fbbf24', label: 'Processando',       icon: '⏳' },
    speaking:   { color: '#00B4FF', label: 'Falando',           icon: '🔊' },
    confirming: { color: '#fb923c', label: 'Aguardando confirm.',icon: '⚠️' },
    error:      { color: '#ef4444', label: 'Erro',              icon: '❌' },
  }

  const currentState = stateConfig[jState]

  return (
    <>
      {/* ─── FAB ─── */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        {/* Mic button (outside panel) */}
        {!open && (
          <button
            onClick={jState === 'listening' ? stopListening : startListening}
            style={{
              width: 44, height: 44, borderRadius: 12,
              background: jState === 'listening'
                ? 'linear-gradient(135deg, rgba(239,68,68,0.8), rgba(220,38,38,0.9))'
                : 'rgba(0,20,50,0.7)',
              border: `1px solid ${jState === 'listening' ? 'rgba(239,68,68,0.5)' : 'rgba(0,180,255,0.2)'}`,
              boxShadow: jState === 'listening' ? '0 0 20px rgba(239,68,68,0.4)' : 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, transition: 'all 0.3s',
              animation: jState === 'listening' ? 'cc-pulse 1s infinite' : 'none',
            }}
            title="Falar com James"
          >
            🎤
          </button>
        )}

        <button
          onClick={() => setOpen(!open)}
          style={{
            width: 52, height: 52, borderRadius: 16,
            background: open ? 'rgba(0,60,120,0.3)' : 'linear-gradient(135deg, rgba(0,120,220,0.8), rgba(0,180,255,0.9))',
            border: `1px solid ${open ? 'rgba(0,180,255,0.5)' : 'rgba(0,180,255,0.6)'}`,
            boxShadow: open ? 'none' : '0 4px 24px rgba(0,180,255,0.3), 0 0 40px rgba(0,180,255,0.1)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.3s', fontSize: 20,
          }}
        >
          {open ? '✕' : '🧠'}
        </button>

        {/* Floating state indicator */}
        {!open && jState !== 'idle' && (
          <div style={{
            padding: '4px 10px', borderRadius: 8,
            background: `${currentState.color}15`, border: `1px solid ${currentState.color}40`,
            fontSize: 10, color: currentState.color, fontWeight: 600,
            animation: jState === 'listening' ? 'cc-pulse 1s infinite' : 'none',
          }}>
            {currentState.icon} {currentState.label}
          </div>
        )}
      </div>

      {/* ─── Panel ─── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 86, right: 24, zIndex: 999,
          width: 400, maxHeight: 580,
          background: 'rgba(4,10,20,0.97)',
          border: '1px solid rgba(0,180,255,0.2)',
          borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 60px rgba(0,180,255,0.08)',
          display: 'flex', flexDirection: 'column',
          backdropFilter: 'blur(12px)',
          animation: 'cc-slide 0.25s ease-out',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid rgba(0,180,255,0.12)',
            background: 'rgba(0,40,80,0.3)', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'linear-gradient(135deg, rgba(0,100,200,0.3), rgba(0,180,255,0.2))',
              border: '1px solid rgba(0,180,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 900, color: '#00B4FF',
            }}>J</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#00B4FF' }}>James</div>
              <div style={{ fontSize: 9, color: 'rgba(0,180,255,0.4)', letterSpacing: '0.06em' }}>
                {PAGE_LABELS[context.page]}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setMode(nextMode[mode])} style={{
                fontSize: 9, padding: '3px 7px', borderRadius: 5,
                border: '1px solid rgba(0,180,255,0.2)', background: 'rgba(0,180,255,0.06)',
                color: 'rgba(0,180,255,0.6)', cursor: 'pointer',
              }} title="Alternar modo">
                {mode === 'both' ? '🔊📝' : mode === 'voice' ? '🔊' : '📝'} {modeLabels[mode]}
              </button>
              <button onClick={() => { setVoiceEnabled(!voiceEnabled); if (jState === 'speaking') stopSpeaking() }} style={{
                fontSize: 14, width: 26, height: 26, borderRadius: 6,
                border: '1px solid rgba(0,180,255,0.15)',
                background: voiceEnabled ? 'rgba(0,180,255,0.1)' : 'transparent',
                color: voiceEnabled ? '#00B4FF' : 'rgba(100,130,160,0.3)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }} title={voiceEnabled ? 'Desativar voz' : 'Ativar voz'}>
                {voiceEnabled ? '🔊' : '🔇'}
              </button>
              {/* State indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: currentState.color,
                  boxShadow: `0 0 6px ${currentState.color}`,
                  animation: jState !== 'idle' ? 'cc-pulse 1.5s infinite' : 'none',
                }} />
                <span style={{ fontSize: 8, color: `${currentState.color}99` }}>{currentState.label}</span>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ padding: '6px 12px', display: 'flex', gap: 6, borderBottom: '1px solid rgba(0,180,255,0.08)' }}>
            {QUICK_ACTIONS.map(action => (
              <button key={action.label}
                onClick={() => void processCommand(action.prompt)}
                disabled={jState === 'processing'}
                style={{
                  flex: 1, padding: '5px 6px', borderRadius: 6, fontSize: 10,
                  border: '1px solid rgba(0,180,255,0.15)', background: 'rgba(0,180,255,0.04)',
                  color: '#00B4FF', cursor: jState === 'processing' ? 'wait' : 'pointer',
                  fontWeight: 600, opacity: jState === 'processing' ? 0.5 : 1,
                  transition: 'all 0.15s',
                }}>
                {action.label}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: 12,
            display: 'flex', flexDirection: 'column', gap: 8,
            minHeight: 180, maxHeight: 340,
          }}>
            {messages.length === 0 && jState === 'idle' && (
              <div style={{ textAlign: 'center', padding: '30px 16px', color: 'rgba(0,180,255,0.25)' }}>
                <div style={{ fontSize: 26, marginBottom: 6 }}>🧠</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,180,255,0.4)', marginBottom: 4 }}>James Intel</div>
                <div style={{ fontSize: 10, color: 'rgba(100,140,180,0.4)' }}>
                  {mode === 'text' ? 'Digite um comando' : 'Fale ou digite um comando'}
                </div>
                <div style={{ fontSize: 8, color: 'rgba(100,130,160,0.25)', marginTop: 8 }}>
                  📋 Info · 🧭 Navegação · ⚡ Ações (com confirmação)
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex', flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                animation: 'cc-slide 0.2s ease-out',
              }}>
                {/* Intent badge for user messages */}
                {msg.role === 'user' && msg.intent && (
                  <span style={{
                    fontSize: 8, padding: '1px 6px', borderRadius: 3, marginBottom: 2,
                    background: msg.intent === 'nav' ? 'rgba(52,211,153,0.1)' : msg.intent === 'action' ? 'rgba(251,191,36,0.1)' : 'rgba(0,180,255,0.08)',
                    border: `1px solid ${msg.intent === 'nav' ? '#34d39930' : msg.intent === 'action' ? '#fbbf2430' : '#00B4FF20'}`,
                    color: msg.intent === 'nav' ? '#34d399' : msg.intent === 'action' ? '#fbbf24' : '#00B4FF',
                  }}>
                    {msg.intent === 'nav' ? '🧭 navegação' : msg.intent === 'action' ? '⚡ ação' : '📋 info'}
                  </span>
                )}

                <div style={{
                  maxWidth: '88%', padding: '8px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.55,
                  background: msg.role === 'user' ? 'rgba(0,100,200,0.15)'
                    : msg.role === 'system' ? 'rgba(100,130,160,0.08)'
                    : 'rgba(0,30,60,0.7)',
                  border: msg.role === 'user' ? '1px solid rgba(0,150,255,0.2)'
                    : msg.role === 'system' ? '1px solid rgba(100,130,160,0.15)'
                    : '1px solid rgba(0,180,255,0.1)',
                  color: msg.role === 'user' ? 'rgba(140,200,255,0.9)'
                    : msg.role === 'system' ? 'rgba(160,180,200,0.6)'
                    : 'rgba(200,225,245,0.9)',
                  fontStyle: msg.role === 'system' ? 'italic' : 'normal',
                  whiteSpace: 'pre-line',
                }}>
                  {msg.text}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <span style={{ fontSize: 8, color: 'rgba(100,130,160,0.3)' }}>{msg.ts}</span>
                  {msg.role === 'james' && voiceEnabled && mode !== 'text' && (
                    <button
                      onClick={() => jState === 'speaking' ? stopSpeaking() : void speakText(msg.voiceText || msg.text)}
                      style={{
                        fontSize: 10, padding: '1px 4px', borderRadius: 3,
                        border: '1px solid rgba(0,180,255,0.15)',
                        background: jState === 'speaking' ? 'rgba(239,68,68,0.1)' : 'transparent',
                        color: jState === 'speaking' ? '#ef4444' : 'rgba(0,180,255,0.4)',
                        cursor: 'pointer',
                      }}>
                      {jState === 'speaking' ? '⏹' : '🔊'}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Processing indicator */}
            {jState === 'processing' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                <span style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: '2px solid rgba(0,180,255,0.3)', borderTopColor: '#00B4FF',
                  animation: 'spin 0.8s linear infinite', display: 'inline-block',
                }} />
                <span style={{ fontSize: 10, color: 'rgba(0,180,255,0.5)' }}>James analisando...</span>
              </div>
            )}

            {/* Confirmation UI */}
            {pendingAction && jState === 'confirming' && (
              <div style={{
                padding: 10, borderRadius: 8,
                background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
                animation: 'cc-slide 0.2s ease-out',
              }}>
                <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 600, marginBottom: 8 }}>
                  ⚠️ Confirmação necessária
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={confirmAction} style={{
                    flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)',
                    color: '#34d399', cursor: 'pointer',
                  }}>✓ Confirmar</button>
                  <button onClick={cancelAction} style={{
                    flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                    color: '#ef4444', cursor: 'pointer',
                  }}>✕ Cancelar</button>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>

          {/* Input area */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(0,180,255,0.08)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {mode !== 'text' && (
                <button
                  onClick={jState === 'listening' ? stopListening : startListening}
                  disabled={jState === 'processing'}
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    border: `1px solid ${jState === 'listening' ? 'rgba(239,68,68,0.4)' : 'rgba(0,180,255,0.2)'}`,
                    background: jState === 'listening' ? 'rgba(239,68,68,0.15)' : 'rgba(0,180,255,0.06)',
                    color: jState === 'listening' ? '#ef4444' : '#00B4FF',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, transition: 'all 0.2s',
                    animation: jState === 'listening' ? 'cc-pulse 1s infinite' : 'none',
                  }}
                  title={jState === 'listening' ? 'Parar' : 'Falar com James'}
                >
                  🎤
                </button>
              )}

              {mode !== 'voice' && (
                <input ref={inputRef} value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && void processCommand(input)}
                  placeholder={jState === 'listening' ? 'Ouvindo...' : jState === 'confirming' ? 'Diga "confirmar" ou "cancelar"' : 'Pergunte ao James...'}
                  disabled={jState === 'processing' || jState === 'listening'}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 12,
                    background: 'rgba(0,20,50,0.6)', border: '1px solid rgba(0,180,255,0.12)',
                    color: 'rgba(200,220,240,0.9)', outline: 'none',
                    opacity: jState === 'listening' ? 0.5 : 1,
                  }}
                />
              )}

              {mode === 'voice' && (
                <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'rgba(0,180,255,0.4)' }}>
                  {jState === 'listening' ? '🎤 Ouvindo...' : jState === 'speaking' ? '🔊 James falando...' : jState === 'confirming' ? '⚠️ Confirme por voz' : 'Pressione o mic'}
                </div>
              )}

              {mode !== 'voice' && (
                <button onClick={() => void processCommand(input)}
                  disabled={jState === 'processing' || !input.trim()}
                  style={{
                    padding: '8px 12px', borderRadius: 8, fontSize: 13,
                    border: '1px solid rgba(0,180,255,0.2)',
                    background: input.trim() ? 'rgba(0,180,255,0.15)' : 'transparent',
                    color: '#00B4FF', cursor: jState === 'processing' ? 'wait' : 'pointer',
                    opacity: !input.trim() ? 0.3 : 1, transition: 'all 0.15s',
                  }}>
                  ➤
                </button>
              )}
            </div>

            {/* Speaking bar */}
            {jState === 'speaking' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginTop: 6,
                padding: '4px 8px', borderRadius: 6,
                background: 'rgba(0,180,255,0.06)', border: '1px solid rgba(0,180,255,0.1)',
              }}>
                <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                  {[0,1,2,3,4].map(i => (
                    <div key={i} style={{
                      width: 3, borderRadius: 2, background: '#00B4FF',
                      animation: 'voice-bar 0.6s ease-in-out infinite',
                      animationDelay: `${i * 0.1}s`, height: 8,
                    }} />
                  ))}
                </div>
                <span style={{ fontSize: 10, color: 'rgba(0,180,255,0.5)' }}>James falando</span>
                <button onClick={stopSpeaking} style={{
                  marginLeft: 'auto', fontSize: 9, padding: '2px 6px', borderRadius: 4,
                  border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444',
                  background: 'rgba(239,68,68,0.1)', cursor: 'pointer',
                }}>Parar</button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        @keyframes voice-bar { 0%,100%{height:4px} 50%{height:16px} }
      `}</style>
    </>
  )
}
