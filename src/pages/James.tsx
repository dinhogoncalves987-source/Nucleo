import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import { JamesFace } from '../components/JamesFace'
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

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) || 'http://localhost:3001'
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


// ─── HibernationOverlay — Visual de nível investidor para estado dormindo ──
function HibernationOverlay({ state, size }: { state: NucleoState; size: number }) {
  const visible = state === 'nucleus' || state === 'closing'
  const o = size

  return (
    <div style={{
      position: 'absolute', inset: 0, borderRadius: '50%',
      overflow: 'hidden',
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.6s ease',
      pointerEvents: 'none',
      zIndex: 10,
    }}>
      <style>{`
        @keyframes hib-scan {
          0%   { transform: translateY(-100%); opacity: 0 }
          10%  { opacity: 0.6 }
          90%  { opacity: 0.4 }
          100% { transform: translateY(${o}px); opacity: 0 }
        }
        @keyframes hib-pulse {
          0%,100% { opacity: 0.4; transform: scale(0.98) }
          50%      { opacity: 0.9; transform: scale(1.02) }
        }
        @keyframes hib-text-glow {
          0%,100% { text-shadow: 0 0 8px rgba(0,180,255,0.6), 0 0 20px rgba(0,180,255,0.3) }
          50%      { text-shadow: 0 0 16px rgba(0,180,255,1), 0 0 40px rgba(0,180,255,0.6), 0 0 60px rgba(0,180,255,0.2) }
        }
        @keyframes hib-sub-blink {
          0%,95%,100% { opacity: 0.5 }
          97%          { opacity: 0 }
        }
        @keyframes hib-ring-rot {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
        @keyframes hib-ring-rot-rev {
          from { transform: rotate(0deg) }
          to   { transform: rotate(-360deg) }
        }
        @keyframes hib-corner-blink {
          0%,100% { opacity: 0.6 }
          50%      { opacity: 0.2 }
        }
        @keyframes hib-data-scroll {
          0%   { transform: translateY(0) }
          100% { transform: translateY(-50%) }
        }
        @keyframes hib-badge-pulse {
          0%,100% { box-shadow: 0 0 6px rgba(0,180,255,0.4) }
          50%      { box-shadow: 0 0 14px rgba(0,180,255,0.9), 0 0 28px rgba(0,180,255,0.3) }
        }
      `}</style>

      {/* Dark fog overlay — esconde o rosto */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 50% 50%, rgba(1,8,20,0.88) 0%, rgba(2,5,12,0.96) 100%)',
        borderRadius: '50%',
      }}/>

      {/* Circuit grid overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,180,255,0.05) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,180,255,0.05) 1px, transparent 1px)
        `,
        backgroundSize: `${o * 0.08}px ${o * 0.08}px`,
        borderRadius: '50%',
      }}/>

      {/* Rotating HUD ring outer */}
      <div style={{
        position: 'absolute',
        width: o * 0.92, height: o * 0.92,
        left: '50%', top: '50%',
        marginLeft: `-${o * 0.46}px`, marginTop: `-${o * 0.46}px`,
        borderRadius: '50%',
        border: '1px solid rgba(0,180,255,0.12)',
        borderTop: '2px solid rgba(0,180,255,0.55)',
        borderRight: '1px solid rgba(212,160,23,0.3)',
        animation: 'hib-ring-rot 12s linear infinite',
      }}>
        {/* Tick marks */}
        {[0,45,90,135,180,225,270,315].map(deg => (
          <div key={deg} style={{
            position: 'absolute',
            width: deg % 90 === 0 ? 8 : 4,
            height: deg % 90 === 0 ? 2 : 1,
            background: deg % 90 === 0 ? 'rgba(0,180,255,0.8)' : 'rgba(0,180,255,0.3)',
            top: '50%', left: '50%',
            transformOrigin: `${-(o * 0.46)}px 0`,
            transform: `rotate(${deg}deg) translateX(${-(o * 0.46)}px)`,
          }}/>
        ))}
      </div>

      {/* Rotating HUD ring inner */}
      <div style={{
        position: 'absolute',
        width: o * 0.72, height: o * 0.72,
        left: '50%', top: '50%',
        marginLeft: `-${o * 0.36}px`, marginTop: `-${o * 0.36}px`,
        borderRadius: '50%',
        border: '1px solid rgba(0,180,255,0.08)',
        borderBottom: '1.5px solid rgba(212,160,23,0.45)',
        animation: 'hib-ring-rot-rev 18s linear infinite',
      }}/>

      {/* Scanline sweep */}
      <div style={{
        position: 'absolute',
        left: 0, right: 0, height: 2,
        background: 'linear-gradient(90deg, transparent, rgba(0,180,255,0.5) 30%, rgba(0,220,255,0.7) 50%, rgba(0,180,255,0.5) 70%, transparent)',
        boxShadow: '0 0 12px rgba(0,180,255,0.4)',
        animation: 'hib-scan 4s ease-in-out infinite',
        animationDelay: '0.5s',
      }}/>

      {/* Corner brackets */}
      {[
        { top: '18%', left: '18%', bt: '2px solid', bl: '2px solid', br: 'none',   bb: 'none'   },
        { top: '18%', right: '18%', bt: '2px solid', br: '2px solid', bl: 'none',  bb: 'none'   },
        { bottom: '18%', left: '18%', bb: '2px solid', bl: '2px solid', bt: 'none',br: 'none'   },
        { bottom: '18%', right: '18%', bb: '2px solid', br: '2px solid', bt: 'none',bl: 'none'  },
      ].map((c, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: o * 0.1, height: o * 0.1,
          ...c,
          borderColor: 'rgba(0,180,255,0.5)',
          animation: 'hib-corner-blink 2s ease-in-out infinite',
          animationDelay: `${i * 0.3}s`,
        }}/>
      ))}

      {/* Center content */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: o * 0.028,
      }}>
        {/* Status badge */}
        <div style={{
          fontSize: o * 0.052,
          fontFamily: "'Inter', monospace",
          fontWeight: 400,
          letterSpacing: '0.3em',
          color: 'rgba(0,180,255,0.5)',
          textTransform: 'uppercase',
        }}>
          SISTEMA
        </div>

        {/* Main title */}
        <div style={{
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 900,
          fontSize: o * 0.155,
          letterSpacing: '0.12em',
          color: '#00B4FF',
          animation: 'hib-text-glow 3s ease-in-out infinite',
          lineHeight: 1,
          textTransform: 'uppercase',
        }}>
          O NÚCLEO
        </div>

        {/* Divider line */}
        <div style={{
          width: o * 0.45, height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(0,180,255,0.7), rgba(212,160,23,0.4), transparent)',
          boxShadow: '0 0 6px rgba(0,180,255,0.4)',
        }}/>

        {/* Subtitle with blinking cursor */}
        <div style={{
          fontSize: o * 0.048,
          fontFamily: 'monospace',
          letterSpacing: '0.22em',
          color: 'rgba(0,180,255,0.55)',
          animation: 'hib-sub-blink 3s ease-in-out infinite',
        }}>
          HIBERNANDO
        </div>

        {/* Data readout */}
        <div style={{
          fontSize: o * 0.038,
          fontFamily: 'monospace',
          color: 'rgba(0,180,255,0.25)',
          letterSpacing: '0.1em',
          marginTop: o * 0.02,
        }}>
          J-AI · v3.0 · ONLINE
        </div>
      </div>

      {/* Bottom badge */}
      <div style={{
        position: 'absolute',
        bottom: '14%',
        left: '50%', transform: 'translateX(-50%)',
        padding: `${o * 0.018}px ${o * 0.06}px`,
        border: '1px solid rgba(0,180,255,0.3)',
        borderRadius: 2,
        fontSize: o * 0.042,
        fontFamily: 'monospace',
        letterSpacing: '0.15em',
        color: 'rgba(0,180,255,0.5)',
        animation: 'hib-badge-pulse 2.5s ease-in-out infinite',
        whiteSpace: 'nowrap',
      }}>
        ◆ STANDBY ◆
      </div>
    </div>
  )
}

// ─── Main Nucleus Component ────────────────────────────────────────────────
function Nucleus({ state, orbSize }: { state: NucleoState; orbSize: number }) {
  const isNucleus    = state === 'nucleus'
  const isOpening    = state === 'opening'
  const isClosing    = state === 'closing'
  const isListening  = state === 'listening'
  const isSpeaking   = state === 'speaking'
  const isThinking   = state === 'thinking'
  const isWaiting    = state === 'waiting'
  const isActive     = ['active','listening','waiting','speaking','thinking'].includes(state)

  const s1 = isOpening ? '0.6s' : isSpeaking ? '1.2s' : isListening ? '2s' : isActive ? '4s' : '8s'
  const s2 = isOpening ? '0.9s' : isSpeaking ? '1.8s' : isListening ? '3s' : isActive ? '6s' : '12s'
  const s3 = isOpening ? '1.2s' : isSpeaking ? '2.4s' : isListening ? '4s' : isActive ? '8s' : '16s'

  const ringBlue  = isListening ? 'rgba(74,222,128,0.75)'
                  : isWaiting   ? 'rgba(245,158,11,0.75)'
                  : isActive    ? 'rgba(0,180,255,0.7)'
                  : 'rgba(0,180,255,0.45)'
  const ringGold  = isListening ? 'rgba(74,222,128,0.3)' : 'rgba(212,160,23,0.5)'
  const glowColor = isListening ? 'rgba(74,222,128,0.45)'
                  : isWaiting   ? 'rgba(245,158,11,0.35)'
                  : isSpeaking  ? 'rgba(0,180,255,0.7)'
                  : isThinking  ? 'rgba(160,100,255,0.5)'
                  : isActive    ? 'rgba(0,180,255,0.3)'
                  : 'rgba(0,120,200,0.2)'
  const o = orbSize

  return (
    <div style={{
      position: 'relative',
      width: o + o * 0.5, height: o + o * 0.5,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <style>{`
        @keyframes r1{from{transform:rotateX(75deg) rotateZ(0)}to{transform:rotateX(75deg) rotateZ(360deg)}}
        @keyframes r2{from{transform:rotateY(65deg) rotateZ(0)}to{transform:rotateY(65deg) rotateZ(-360deg)}}
        @keyframes r3{from{transform:rotateX(25deg) rotateY(40deg) rotateZ(0)}to{transform:rotateX(25deg) rotateY(40deg) rotateZ(360deg)}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(-1 * ${o * 0.035}px))}}
        @keyframes glow-pulse{0%,100%{opacity:0.7;transform:scale(1)}50%{opacity:1;transform:scale(1.1)}}
        @keyframes eye-glow{0%,100%{filter:brightness(1)}50%{filter:brightness(2) saturate(1.5)}}
        @keyframes burst{0%{transform:scale(0.8);opacity:0}30%{transform:scale(1.3);opacity:1}60%{transform:scale(1.1);opacity:1}100%{transform:scale(1);opacity:1}}
        @keyframes iris-open{0%{clip-path:circle(0% at 50% 50%)}100%{clip-path:circle(55% at 50% 50%)}}
        @keyframes iris-close{0%{clip-path:circle(55% at 50% 50%)}100%{clip-path:circle(0% at 50% 50%)}}
        @keyframes think-pulse{0%,100%{opacity:0.3;transform:scale(0.97)}50%{opacity:0.85;transform:scale(1.03)}}
        @keyframes wait-pulse{0%,100%{opacity:0.2;transform:scale(0.98)}50%{opacity:0.6;transform:scale(1.02)}}
      `}</style>

      {/* Ambient glow */}
      <div style={{
        position: 'absolute', width: o + o * 0.38, height: o + o * 0.38,
        borderRadius: '50%',
        background: `radial-gradient(circle,${glowColor} 0%,transparent 70%)`,
        filter: `blur(${o * 0.1}px)`,
        transition: 'all 1.2s ease',
        animation: 'glow-pulse 2.5s ease-in-out infinite',
      }}/>

      {/* Ring 1 */}
      <div style={{
        position:'absolute', width: o+o*0.46, height: o+o*0.46, borderRadius:'50%',
        border:`${Math.max(2, o*0.007)}px solid ${ringBlue}`,
        borderTop:`${Math.max(2, o*0.007)}px solid ${ringGold}`,
        boxShadow:`0 0 ${o*0.05}px ${ringBlue},inset 0 0 ${o*0.05}px ${ringBlue}`,
        animation:`r1 ${s1} linear infinite`,
        transition:'border-color 0.7s,box-shadow 0.7s',
      }}/>
      {/* Ring 2 */}
      <div style={{
        position:'absolute', width: o+o*0.34, height: o+o*0.34, borderRadius:'50%',
        border:`${Math.max(1.5, o*0.006)}px solid ${ringGold}`,
        borderRight:`${Math.max(1.5, o*0.006)}px solid ${ringBlue}`,
        boxShadow:`0 0 ${o*0.03}px ${ringGold}`,
        animation:`r2 ${s2} linear infinite`,
        transition:'border-color 0.7s',
      }}/>
      {/* Ring 3 */}
      <div style={{
        position:'absolute', width: o+o*0.23, height: o+o*0.23, borderRadius:'50%',
        border:`${Math.max(1, o*0.005)}px solid rgba(255,255,255,0.08)`,
        borderBottom:`${Math.max(1, o*0.005)}px solid ${ringBlue}`,
        animation:`r3 ${s3} linear infinite`,
        transition:'border-color 0.7s',
      }}/>

      {/* Core sphere */}
      <div style={{
        width: o, height: o, borderRadius:'50%',
        position:'relative', flexShrink:0,
        animation: isActive ? `float ${4}s ease-in-out infinite` : 'none',
      }}>
        <div style={{
          width:'100%', height:'100%', borderRadius:'50%',
          background: isActive
            ? 'radial-gradient(circle at 40% 35%, #0A1E35, #030C18)'
            : 'radial-gradient(circle at 40% 35%, #050D18, #020508)',
          border:`${Math.max(2, o*0.008)}px solid ${ringBlue}`,
          boxShadow: isSpeaking
            ? `0 0 ${o*0.18}px ${glowColor},0 0 ${o*0.35}px rgba(0,180,255,0.18)`
            : `0 0 ${o*0.07}px ${glowColor}`,
          transition:'all 1s ease',
          position:'relative', overflow:'hidden',
        }}>
          <div style={{
            position:'absolute', inset:0, borderRadius:'50%',
            background:'radial-gradient(circle at 30% 25%, rgba(0,180,255,0.08) 0%, rgba(0,0,0,0.6) 100%)',
          }}/>

          {/* James face — sempre visível, escurece no estado nucleus */}
          <div style={{
            position:'absolute', inset:0,
            display:'flex', alignItems:'center', justifyContent:'center',
            animation: isOpening ? 'iris-open 0.9s ease-out forwards'
                      : isClosing ? 'iris-close 0.6s ease-in forwards'
                      : undefined,
            clipPath: !isNucleus && !isOpening && !isClosing ? 'circle(55% at 50% 50%)' : undefined,
            opacity: 1,
            transform:
              state === 'speaking'
                ? `translateY(-${o * 0.032}px) scale(1.08)`
                : isOpening || state === 'active' || state === 'listening' || state === 'thinking' || state === 'waiting'
                  ? 'translateY(0) scale(1.02)'
                  : `translateY(${o * 0.012}px) scale(0.92)`,
            transformOrigin: '50% 72%',
            transition: 'opacity 0.3s ease, transform 0.45s ease',
          }}>
            <JamesFace state={state} size={Math.round(o * 0.88)} />
          </div>

          {/* Hibernation overlay — cobre o rosto com HUD O NÚCLEO */}
          <HibernationOverlay state={state} size={o} />

          {isOpening && (
            <div style={{
              position:'absolute', inset:0, borderRadius:'50%',
              background:'radial-gradient(circle,rgba(0,180,255,0.25) 0%,transparent 70%)',
              animation:'burst 1s ease-out forwards',
            }}/>
          )}

          {isThinking && (
            <div style={{
              position:'absolute', inset:0, borderRadius:'50%',
              background:'radial-gradient(circle at 50% 40%, rgba(160,100,255,0.25) 0%, transparent 70%)',
              animation:'think-pulse 1.2s ease-in-out infinite',
            }}/>
          )}
          {isWaiting && (
            <div style={{
              position:'absolute', inset:0, borderRadius:'50%',
              background:'radial-gradient(circle at 50% 40%, rgba(245,158,11,0.2) 0%, transparent 70%)',
              animation:'wait-pulse 1.8s ease-in-out infinite',
            }}/>
          )}
        </div>
      </div>
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
  const [orbSize, setOrbSize] = useState(320)

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

  // ── Orb size ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const calc = () => setOrbSize(Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.52))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  // ── TTS via backend — sem chave no frontend ──────────────────────────────────
  // Chama /api/james/tts. Funciona sem OPENAI_API_KEY no browser.
  const speak = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) return
    setState('speaking')
    vadRef.current?.pause()

    try {
      const res = await fetch(`${BACKEND_URL}/api/james/tts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': API_SECRET },
        body:    JSON.stringify({ text: text.slice(0, 4096), voice: 'onyx' }),
        signal:  AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`TTS ${res.status}`)

      audioRef.current?.pause()
      const url     = URL.createObjectURL(await res.blob())
      const audioEl = new Audio(url)
      audioRef.current = audioEl

      await new Promise<void>(resolve => {
        const cleanup = () => { URL.revokeObjectURL(url); resolve() }
        audioEl.onended  = cleanup
        audioEl.onerror  = cleanup
        audioEl.onpause  = () => { if (!audioEl.ended) setTimeout(cleanup, 50) }
        audioEl.play().catch(cleanup)
      })
    } catch { /* TTS falhou — continua sem som */ } finally {
      if (stateRef.current === 'speaking') {
        setState('active')
        vadRef.current?.start()
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
      if (audioBlob.size < 1000) return  // too short

      const rawText = await transcribeBackend(audioBlob)
      if (!rawText || rawText.length < 2) return

      const t = rawText.toLowerCase().replace(/[.,!?;:]/g, '').trim()

      // Dismiss
      const isDismiss =
        t.includes('obrigado james') || t.includes('tchau james') ||
        t.includes('sair james')     || t.includes('dispensar')   ||
        t.includes('pode ir')        || (t.startsWith('obrigado') && t.length < 30)
      if (isDismiss) {
        pendingCtxRef.current = ''
        audioRef.current?.pause()
        // Limpa histórico da sessão no backend
        resetSession(sessionIdRef.current).catch(() => {})
        setState('closing')
        setTimeout(() => setState('nucleus'), 700)
        return
      }

      // "ok" = accumulate context
      const isOk = t === 'ok' || t.endsWith(' ok') || (t.startsWith('ok ') && t.length < 10)
      if (isOk) {
        const beforeOk = rawText.replace(/\bok\b/gi, '').trim()
        if (beforeOk.length > 1) pendingCtxRef.current += (pendingCtxRef.current ? '\n' : '') + beforeOk
        setState('waiting')
        vadRef.current?.start()
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
  }, [resetWatchdog, clearWatchdog, tenantId])


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

        if (rms > SPEECH_THRESHOLD) {
          if (!speaking && !busyRef.current) {
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
        pause:   () => { speaking = false; if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null } },
        start:   () => { /* RAF already running */ },
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
  const summon = useCallback(() => {
    if (stateRef.current !== 'nucleus') return
    setState('opening')
    setTimeout(() => setState('active'), 750)
  }, [])

  const dismiss = useCallback(() => {
    audioRef.current?.pause()
    destroyVAD()
    pendingCtxRef.current = ''
    busyRef.current = false
    setState('closing')
    setTimeout(() => setState('nucleus'), 700)
  }, [destroyVAD])

  // ── Wake word listener (Web Speech API — nucleus only) ──────────────────
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
          if (heard.includes('james') || heard.includes('núcleo') || heard.includes('nucleo')) summon()
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

  // ── Orb click: nucleus ignora clique — só voz acorda James ───────────────
  const handleOrbClick = useCallback(() => {
    const s = stateRef.current
    if (s === 'nucleus')  return                                            // voz apenas
    if (s === 'speaking') { audioRef.current?.pause(); setState('active');  return }
    if (s === 'active' || s === 'waiting') { dismiss();                     return }
  }, [dismiss])

  // ── UI helpers ──────────────────────────────────────────────────────────
  const bg =
    state === 'listening' ? 'radial-gradient(ellipse at 50% 40%, #001508 0%, #020508 100%)' :
    state === 'waiting'   ? 'radial-gradient(ellipse at 50% 40%, #1a0e00 0%, #020508 100%)' :
    state === 'speaking'  ? 'radial-gradient(ellipse at 50% 40%, #001828 0%, #020508 100%)' :
    state === 'thinking'  ? 'radial-gradient(ellipse at 50% 40%, #0a0018 0%, #020508 100%)' :
    '#020508'

  const isPresent = ['opening','active','listening','waiting','speaking','thinking'].includes(state)

  const hint =
    state === 'nucleus'   ? 'Diga "James" para ativar' :
    state === 'active'    ? 'Ouço você — pode falar' :
    state === 'listening' ? 'Ouvindo…' :
    state === 'waiting'   ? 'Aguardo você concluir…' :
    state === 'thinking'  ? 'Processando…' :
    state === 'speaking'  ? 'Pode falar — paro imediatamente' : ''

  return (
    <div style={{
      width: '100vw', height: '100vh', background: bg,
      transition: 'background 1.2s ease', overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      userSelect: 'none',
    }}>
      <EnergyGrid active={isPresent} />

      <div
        onClick={handleOrbClick}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, cursor: 'pointer', width: '100%' }}
      >
        <Nucleus state={state} orbSize={orbSize} />
      </div>

      <div style={{ position: 'absolute', bottom: 'clamp(80px,10vh,120px)', left: '50%', transform: 'translateX(-50%)' }}>
        <SoundBars state={state} />
      </div>

      {hint && (
        <div style={{
          position: 'absolute', bottom: 'clamp(40px,5vh,60px)', left: '50%', transform: 'translateX(-50%)',
          color: state === 'waiting' ? 'rgba(245,158,11,0.65)' : 'rgba(100,160,220,0.55)',
          fontSize: 12,
          letterSpacing: '0.08em', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
          transition: 'color 0.5s ease',
        }}>
          {hint}
        </div>
      )}

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
