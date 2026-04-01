import { useEffect, useRef, useState } from 'react'

type NucleoState =
  | 'nucleus'
  | 'opening'
  | 'active'
  | 'listening'
  | 'waiting'
  | 'speaking'
  | 'thinking'
  | 'closing'

const MOUTH: Record<string, string> = {
  rest: 'M 18 14 Q 50 17 82 14',
  slight: 'M 20 12 Q 50 20 80 12',
  half: 'M 22 10 Q 35 22 50 24 Q 65 22 78 10',
  open: 'M 20 8 Q 35 24 50 26 Q 65 24 80 8',
  wide: 'M 16 6 Q 35 26 50 28 Q 65 26 84 6',
  round: 'M 28 9 Q 42 24 50 26 Q 58 24 72 9 Q 68 5 50 4 Q 32 5 28 9',
  e_shape: 'M 18 12 Q 36 19 50 20 Q 64 19 82 12',
}

const SPEAKING_SEQ = [
  'slight',
  'half',
  'open',
  'half',
  'round',
  'e_shape',
  'half',
  'wide',
  'half',
  'slight',
  'rest',
  'slight',
  'open',
  'round',
  'half',
  'e_shape',
  'rest',
] as const

const MOUTH_COLOR: Record<string, string> = {
  nucleus: '#003060',
  opening: '#00B4FF',
  active: '#00B4FF',
  listening: '#4ade80',
  waiting: '#f59e0b',
  thinking: '#a066ff',
  speaking: '#00d4ff',
  closing: '#002040',
}

function useMouthShape(state: NucleoState) {
  const [shape, setShape] = useState(MOUTH.rest)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idx = useRef(0)
  const alive = useRef(false)

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    alive.current = false

    if (state !== 'speaking') {
      setShape(MOUTH.rest)
      return
    }

    alive.current = true
    idx.current = 0

    const advance = () => {
      if (!alive.current) return
      idx.current = (idx.current + 1) % SPEAKING_SEQ.length
      const key = SPEAKING_SEQ[idx.current]
      setShape(MOUTH[key])
      const dwell = key === 'rest' ? 190 : key === 'open' || key === 'wide' ? 95 : 125
      timer.current = setTimeout(advance, dwell + Math.random() * 55)
    }

    advance()

    return () => {
      alive.current = false
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      setShape(MOUTH.rest)
    }
  }, [state])

  return shape
}

function useBlink(state: NucleoState) {
  const [blink, setBlink] = useState(0)

  useEffect(() => {
    if (state === 'nucleus' || state === 'closing') {
      setBlink(0)
      return
    }

    let cancelled = false
    let waitTimer: ReturnType<typeof setTimeout> | null = null
    let releaseTimer: ReturnType<typeof setTimeout> | null = null
    let doubleTimer: ReturnType<typeof setTimeout> | null = null

    const schedule = () => {
      if (cancelled) return
      const delay =
        state === 'speaking'
          ? 1700 + Math.random() * 1800
          : state === 'thinking'
            ? 2200 + Math.random() * 2400
            : 2600 + Math.random() * 2800

      waitTimer = setTimeout(() => {
        if (cancelled) return
        setBlink(1)
        releaseTimer = setTimeout(() => {
          if (cancelled) return
          setBlink(0)

          if (Math.random() < 0.28) {
            doubleTimer = setTimeout(() => {
              if (cancelled) return
              setBlink(1)
              releaseTimer = setTimeout(() => {
                if (cancelled) return
                setBlink(0)
                schedule()
              }, 85)
            }, 130)
            return
          }

          schedule()
        }, 110)
      }, delay)
    }

    schedule()

    return () => {
      cancelled = true
      if (waitTimer) clearTimeout(waitTimer)
      if (releaseTimer) clearTimeout(releaseTimer)
      if (doubleTimer) clearTimeout(doubleTimer)
    }
  }, [state])

  return blink
}

function useEyeDrift(state: NucleoState) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (state === 'nucleus' || state === 'closing') {
      setOffset({ x: 0, y: 0 })
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const step = () => {
      if (cancelled) return
      const intensity =
        state === 'speaking'
          ? 0.9
          : state === 'thinking'
            ? 1.1
            : state === 'listening'
              ? 0.75
              : 0.55

      setOffset({
        x: (Math.random() * 2 - 1) * intensity,
        y: (Math.random() * 2 - 1) * intensity * 0.7,
      })
      timer = setTimeout(step, 900 + Math.random() * 1600)
    }

    step()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [state])

  return offset
}

export function JamesFace({ state, size }: { state: NucleoState; size: number }) {
  const mouthShape = useMouthShape(state)
  const blink = useBlink(state)
  const eyeDrift = useEyeDrift(state)

  const isSpeaking = state === 'speaking'
  const isListening = state === 'listening'
  const isThinking = state === 'thinking'
  const isActive = ['active', 'listening', 'waiting', 'speaking', 'thinking'].includes(state)

  const mouthColor = MOUTH_COLOR[state] ?? MOUTH_COLOR.active

  const s = size
  const mouthX = s * 0.18
  const mouthY = s * 0.608
  const mouthW = s * 0.64
  const leftEye = { x: s * 0.315, y: s * 0.395 }
  const rightEye = { x: s * 0.685, y: s * 0.395 }
  const pupilTravel = s * 0.008
  const eyelidTravel = `${-100 + blink * 100}%`

  const floatAnim = isActive ? 'jf-float 4.2s ease-in-out infinite' : 'none'
  const nodAnim = isSpeaking ? 'jf-nod 0.44s ease-in-out infinite alternate' : 'none'

  return (
    <>
      <style>{`
        @keyframes jf-float {
          0%,100% { transform: translateY(0) rotate(0deg); }
          35% { transform: translateY(-${s * 0.011}px) rotate(0.25deg); }
          75% { transform: translateY(-${s * 0.007}px) rotate(-0.18deg); }
        }
        @keyframes jf-nod {
          from { transform: translateY(0) rotate(0deg); }
          to { transform: translateY(${s * 0.008}px) rotate(0.45deg); }
        }
        @keyframes jf-think-scan {
          0% { transform: scaleX(0.7); opacity: 0; }
          30% { opacity: 0.6; }
          70% { opacity: 0.6; }
          100% { transform: scaleX(1.1); opacity: 0; }
        }
        @keyframes jf-eye-wake {
          0% { opacity: 0; transform: scale(0.6); }
          40% { opacity: 1; transform: scale(1.3); }
          70% { opacity: 0.9; transform: scale(1.0); }
          100% { opacity: 0; transform: scale(1.0); }
        }
      `}</style>

      <div
        style={{
          width: s,
          height: s,
          position: 'relative',
          animation: isSpeaking ? nodAnim : floatAnim,
          transformOrigin: '50% 90%',
          willChange: 'transform',
        }}
      >
        <img
          src="/james-face.png"
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 8%',
            display: 'block',
            filter:
              state === 'nucleus'
                ? 'brightness(0.22) saturate(0.4) hue-rotate(10deg)'
                : state === 'closing'
                  ? 'brightness(0.4) saturate(0.6)'
                  : state === 'opening'
                    ? 'brightness(1.1) saturate(1.2)'
                    : isListening
                      ? 'brightness(1.05) hue-rotate(60deg) saturate(1.3)'
                      : state === 'waiting'
                        ? 'brightness(1.05) hue-rotate(25deg) saturate(1.2)'
                        : isThinking
                          ? 'brightness(0.95) hue-rotate(200deg) saturate(1.2)'
                          : 'brightness(1)',
            transition: 'filter 1.4s ease',
          }}
        />

        <div
          style={{
            position: 'absolute',
            width: s * 0.18,
            height: s * 0.13,
            left: s * 0.235,
            top: s * 0.33,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(0,200,255,1) 0%, rgba(0,140,255,0.5) 45%, transparent 80%)',
            filter: `blur(${s * 0.016}px)`,
            opacity: state === 'opening' ? 1 : state === 'nucleus' ? 0.07 : state === 'closing' ? 0.03 : 0,
            transition: state === 'opening' ? 'opacity 0.1s ease' : 'opacity 1.5s ease',
            animation: state === 'opening' ? 'jf-eye-wake 0.9s ease-out forwards' : 'none',
            boxShadow:
              state === 'opening'
                ? `0 0 ${s * 0.06}px rgba(0,200,255,0.9), 0 0 ${s * 0.12}px rgba(0,180,255,0.5)`
                : 'none',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: s * 0.18,
            height: s * 0.13,
            right: s * 0.24,
            top: s * 0.33,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(0,200,255,1) 0%, rgba(0,140,255,0.5) 45%, transparent 80%)',
            filter: `blur(${s * 0.016}px)`,
            opacity: state === 'opening' ? 1 : state === 'nucleus' ? 0.07 : state === 'closing' ? 0.03 : 0,
            transition: state === 'opening' ? 'opacity 0.1s ease 0.06s' : 'opacity 1.5s ease',
            animation: state === 'opening' ? 'jf-eye-wake 0.9s ease-out forwards 0.06s' : 'none',
            boxShadow:
              state === 'opening'
                ? `0 0 ${s * 0.06}px rgba(0,200,255,0.9), 0 0 ${s * 0.12}px rgba(0,180,255,0.5)`
                : 'none',
            pointerEvents: 'none',
          }}
        />

        {state !== 'nucleus' && state !== 'closing' && (
          <>
            {[
              { key: 'left', x: leftEye.x, y: leftEye.y },
              { key: 'right', x: rightEye.x, y: rightEye.y },
            ].map((eye) => (
              <div
                key={eye.key}
                style={{
                  position: 'absolute',
                  left: eye.x - s * 0.055,
                  top: eye.y - s * 0.026,
                  width: s * 0.11,
                  height: s * 0.05,
                  borderRadius: '999px',
                  overflow: 'hidden',
                  pointerEvents: 'none',
                  opacity: state === 'opening' ? 0.55 : isThinking ? 0.9 : 0.82,
                  transition: 'opacity 0.3s ease',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: s * 0.032,
                    height: s * 0.032,
                    borderRadius: '50%',
                    transform: `translate(calc(-50% + ${eyeDrift.x * pupilTravel}px), calc(-50% + ${eyeDrift.y * pupilTravel}px))`,
                    background: 'radial-gradient(circle, rgba(178,245,255,0.98) 0%, rgba(27,170,255,0.95) 55%, rgba(0,55,120,0.4) 100%)',
                    boxShadow: `0 0 ${s * 0.018}px rgba(140,230,255,0.95), 0 0 ${s * 0.05}px rgba(0,180,255,0.42)`,
                    transition: 'transform 0.75s ease',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: 0,
                    width: '120%',
                    height: '120%',
                    transform: `translate(-50%, ${eyelidTravel})`,
                    transformOrigin: '50% 0%',
                    borderRadius: '0 0 999px 999px',
                    background:
                      state === 'thinking'
                        ? 'linear-gradient(180deg, rgba(12,18,42,0.96) 0%, rgba(20,34,70,0.88) 100%)'
                        : 'linear-gradient(180deg, rgba(7,13,24,0.97) 0%, rgba(12,28,45,0.85) 100%)',
                    transition: blink > 0 ? 'transform 0.08s ease-in' : 'transform 0.14s ease-out',
                  }}
                />
              </div>
            ))}
          </>
        )}

        <svg
          viewBox={`0 0 ${s} ${s}`}
          width={s}
          height={s}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          <defs>
            <filter id="jf-mouth-glow" x="-20%" y="-150%" width="140%" height="400%">
              <feGaussianBlur stdDeviation={isSpeaking ? '2.5' : '1.2'} result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g
            filter="url(#jf-mouth-glow)"
            transform={`translate(${mouthX}, ${mouthY}) scale(1, ${isSpeaking ? 1.1 : 1}) translate(0, ${isSpeaking ? s * 0.005 : 0})`}
            style={{ transformOrigin: `${mouthX + mouthW / 2}px ${mouthY}px`, transition: 'transform 0.12s ease' }}
          >
            <svg viewBox="0 0 100 30" width={mouthW} height={s * 0.1} overflow="visible">
              {(isSpeaking || isListening) && (
                <path d={`${mouthShape} L 80 30 L 20 30 Z`} fill={`${mouthColor}18`} style={{ transition: 'd 0.1s ease' }} />
              )}
              <path
                d={mouthShape}
                fill="none"
                stroke={mouthColor}
                strokeWidth={isSpeaking ? 2.4 : isListening ? 2.0 : 1.5}
                strokeLinecap="round"
                style={{ transition: 'd 0.1s ease, stroke 0.4s, stroke-width 0.3s' }}
              />
              {isSpeaking && (
                <path
                  d="M 22 9 Q 50 5 78 9"
                  fill="none"
                  stroke={`${mouthColor}55`}
                  strokeWidth={1.2}
                  strokeLinecap="round"
                />
              )}
            </svg>
          </g>

          {isThinking && (
            <line
              x1={s * 0.15}
              y1={s * 0.5}
              x2={s * 0.85}
              y2={s * 0.5}
              stroke="rgba(160,100,255,0.35)"
              strokeWidth={1.2}
              strokeDasharray="4 5"
              style={{ animation: 'jf-think-scan 2s ease-in-out infinite' }}
            />
          )}
        </svg>
      </div>
    </>
  )
}
