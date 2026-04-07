// ════════════════════════════════════════════════════════════════════════════
// CoreLighting.tsx — Iluminação do Nucleus
// Foco no contraste: centro brilhante, resto escuro
// Sem bloom exagerado — a definição visual vem das linhas e estrutura
// ════════════════════════════════════════════════════════════════════════════
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CORE_LIGHTING, NUCLEUS_COLORS, type JamesCoreState } from './jamesSceneConfig'

interface CoreLightingProps {
  state: JamesCoreState
  intensity: number
}

export default function CoreLighting({ state, intensity }: CoreLightingProps) {
  const pointRef = useRef<THREE.PointLight>(null)
  const fillRef = useRef<THREE.PointLight>(null)

  const targetIntensity = CORE_LIGHTING.pointIntensity[state] * intensity
  const targetColor = new THREE.Color(
    state === 'listening'  ? NUCLEUS_COLORS.listeningTint
    : state === 'processing' ? NUCLEUS_COLORS.processingTint
    : state === 'speaking'   ? NUCLEUS_COLORS.speakingTint
    : state === 'alert'      ? NUCLEUS_COLORS.alertTint
    : NUCLEUS_COLORS.coreGlow
  )

  useFrame((_, delta) => {
    if (pointRef.current) {
      pointRef.current.intensity += (targetIntensity - pointRef.current.intensity) * delta * 3
      pointRef.current.color.lerp(targetColor, delta * 3)
    }
    if (fillRef.current) {
      fillRef.current.intensity += (intensity * 0.15 - fillRef.current.intensity) * delta * 3
    }
  })

  return (
    <>
      {/* Primary — at the nucleus center, subtle */}
      <pointLight
        ref={pointRef}
        color={NUCLEUS_COLORS.coreGlow}
        intensity={targetIntensity}
        position={[0, 0, 0.2]}
        distance={5}
        decay={2}
      />

      {/* Fill — very subtle upper fill for ring visibility */}
      <pointLight
        ref={fillRef}
        color="#0a1a3a"
        intensity={0.15}
        position={[0, 1.5, 1]}
        distance={5}
        decay={2}
      />

      {/* Ambient — near zero, keeps deep blacks */}
      <ambientLight color="#020408" intensity={0.03} />
    </>
  )
}
