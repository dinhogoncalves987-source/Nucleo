// ════════════════════════════════════════════════════════════════════════════
// JamesCoreScene.tsx — Cena 3D principal — TELA INTEIRA
// Canvas R3F com todos os módulos do Nucleus
// ════════════════════════════════════════════════════════════════════════════
import { Suspense, useMemo, Component, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import CoreCenter from './CoreCenter'
import CoreRings from './CoreRings'
import CoreParticles from './CoreParticles'
import CoreHUD from './CoreHUD'
import CoreLighting from './CoreLighting'
import CoreReactorHousing from './CoreReactorHousing'
import {
  CAMERA_CONFIG, NUCLEUS_COLORS,
  detectPerformanceTier,
  type JamesCoreState,
} from './jamesSceneConfig'

interface JamesCoreSceneProps {
  state: JamesCoreState
  nucleusIntensity: number
}

// ── R3F Error Boundary — catches WebGL crashes without killing the page ───
class R3FErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(err: Error) {
    console.warn('[JamesCoreScene] 3D crash caught, showing fallback:', err.message)
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

// ── Scene contents ────────────────────────────────────────────────────────
function SceneContent({ state, nucleusIntensity }: JamesCoreSceneProps) {
  const tier = useMemo(() => detectPerformanceTier(), [])
  const showParticles = tier !== 'low'

  return (
    <>
      <color attach="background" args={[NUCLEUS_COLORS.background]} />
      <CoreLighting state={state} intensity={nucleusIntensity} />
      <CoreReactorHousing state={state} intensity={nucleusIntensity} />
      <CoreCenter state={state} intensity={nucleusIntensity} />
      <CoreRings state={state} intensity={nucleusIntensity} />
      {showParticles && <CoreParticles state={state} intensity={nucleusIntensity} />}
      <CoreHUD state={state} intensity={nucleusIntensity} />
    </>
  )
}

// ── Loading fallback ──────────────────────────────────────────────────────
function LoadingFallback() {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: NUCLEUS_COLORS.background,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        border: '2px solid rgba(0,180,255,0.1)',
        borderTopColor: '#00B4FF',
        animation: 'spin 1s linear infinite',
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ── Crash fallback (static visual when WebGL dies) ────────────────────────
function CrashFallback() {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: NUCLEUS_COLORS.background,
      position: 'absolute', inset: 0,
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,180,255,0.3) 0%, transparent 70%)',
        boxShadow: '0 0 40px rgba(0,180,255,0.2)',
        animation: 'spin 8s linear infinite',
        border: '1px solid rgba(0,180,255,0.15)',
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ── Main scene — fills entire container ───────────────────────────────────
export default function JamesCoreScene({ state, nucleusIntensity }: JamesCoreSceneProps) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: NUCLEUS_COLORS.background,
      position: 'absolute', inset: 0,
    }}>
      <R3FErrorBoundary fallback={<CrashFallback />}>
        <Suspense fallback={<LoadingFallback />}>
          <Canvas
            gl={{
              antialias: true, alpha: false,
              powerPreference: 'high-performance',
              toneMapping: THREE.NoToneMapping,
              outputColorSpace: THREE.SRGBColorSpace,
            }}
            camera={{
              fov: CAMERA_CONFIG.fov,
              position: CAMERA_CONFIG.position,
              near: CAMERA_CONFIG.near,
              far: CAMERA_CONFIG.far,
            }}
            style={{ width: '100%', height: '100%' }}
            dpr={[1, 1.5]}
            frameloop="always"
            onCreated={({ gl }) => {
              // Handle WebGL context loss gracefully
              const canvas = gl.domElement
              canvas.addEventListener('webglcontextlost', (e) => {
                e.preventDefault()
                console.warn('[JamesCoreScene] WebGL context lost')
              })
              canvas.addEventListener('webglcontextrestored', () => {
                console.log('[JamesCoreScene] WebGL context restored')
              })
            }}
          >
            <SceneContent state={state} nucleusIntensity={nucleusIntensity} />
          </Canvas>
        </Suspense>
      </R3FErrorBoundary>
    </div>
  )
}
