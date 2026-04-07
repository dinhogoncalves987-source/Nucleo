// ════════════════════════════════════════════════════════════════════════════
// JamesCoreWrapper.tsx — Bridge entre voz e 3D — TELA INTEIRA
// Sem clip circular, o 3D ocupa todo o viewport
// ════════════════════════════════════════════════════════════════════════════
import { lazy, Suspense, useEffect, useCallback } from 'react'
import { useJamesSceneController } from './useJamesSceneController'
import { isWebGLAvailable, NUCLEUS_COLORS } from './jamesSceneConfig'
import type { NucleoState } from './JamesVoiceBridge'

const JamesCoreScene = lazy(() => import('./JamesCoreScene'))

interface JamesCoreWrapperProps {
  nucleoState: NucleoState
  onClick?: () => void
}

// ── 2D Fallback ───────────────────────────────────────────────────────────
function Fallback2D({ nucleoState }: { nucleoState: NucleoState }) {
  const isActive = ['active', 'listening', 'speaking', 'thinking', 'waiting'].includes(nucleoState)
  const coreGlow = isActive ? 20 : 6
  const coreOpacity = nucleoState === 'nucleus' ? 0.2 : isActive ? 0.9 : 0.4
  const ringSpeed = nucleoState === 'nucleus' ? '20s' : isActive ? '4s' : '12s'

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: `radial-gradient(ellipse at center, #080818 0%, ${NUCLEUS_COLORS.background} 70%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes fb-r1{from{transform:rotateX(75deg) rotateZ(0)}to{transform:rotateX(75deg) rotateZ(360deg)}}
        @keyframes fb-r2{from{transform:rotateY(65deg) rotateZ(0)}to{transform:rotateY(65deg) rotateZ(-360deg)}}
        @keyframes fb-r3{from{transform:rotateX(25deg) rotateY(40deg) rotateZ(0)}to{transform:rotateX(25deg) rotateY(40deg) rotateZ(360deg)}}
        @keyframes fb-pulse{0%,100%{opacity:0.6;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}
      `}</style>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{
          position: 'absolute',
          width: 80 + i * 60, height: 80 + i * 60,
          borderRadius: '50%',
          border: `${3 - i * 0.3}px solid rgba(0,180,255,${0.25 - i * 0.03})`,
          borderTopColor: i <= 2 ? 'rgba(212,160,23,0.4)' : 'transparent',
          animation: `fb-r${((i - 1) % 3) + 1} ${ringSpeed} linear infinite`,
          transition: 'all 1s ease',
        }} />
      ))}
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        background: `radial-gradient(circle, rgba(255,255,255,${coreOpacity * 0.8}) 0%, rgba(0,180,255,${coreOpacity * 0.5}) 40%, transparent 70%)`,
        boxShadow: `0 0 ${coreGlow}px rgba(0,180,255,${coreOpacity * 0.5})`,
        animation: 'fb-pulse 2.5s ease-in-out infinite',
        transition: 'all 0.8s ease',
      }} />
      <div style={{
        position: 'absolute', bottom: 40,
        fontSize: 10, color: 'rgba(0,180,255,0.3)',
        letterSpacing: '0.15em', textTransform: 'uppercase',
        fontFamily: "'Inter', monospace",
      }}>
        {nucleoState === 'nucleus' ? '[ STANDBY ]' : `[ ${nucleoState.toUpperCase()} ]`}
      </div>
    </div>
  )
}

// ── Main Wrapper — FULL SCREEN ────────────────────────────────────────────
export default function JamesCoreWrapper({ nucleoState, onClick }: JamesCoreWrapperProps) {
  const controller = useJamesSceneController()
  const webglOk = isWebGLAvailable()

  useEffect(() => {
    controller.syncVoiceState(nucleoState)
  }, [nucleoState]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = useCallback(() => {
    if (onClick) { onClick(); return }
    if (controller.state === 'idle_dark' || controller.state === 'sleeping') {
      controller.openJamesCore()
    } else if (controller.state === 'emergence_ready') {
      controller.closeJamesCore()
    }
  }, [controller, onClick])

  return (
    <div
      onClick={handleClick}
      style={{
        position: 'absolute', inset: 0,
        cursor: 'pointer',
      }}
      role="button" tabIndex={0}
      aria-label="James Nucleus"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
    >
      {webglOk ? (
        <Suspense fallback={<Fallback2D nucleoState={nucleoState} />}>
          <JamesCoreScene
            state={controller.state}
            nucleusIntensity={controller.nucleusIntensity}
          />
        </Suspense>
      ) : (
        <Fallback2D nucleoState={nucleoState} />
      )}
    </div>
  )
}
