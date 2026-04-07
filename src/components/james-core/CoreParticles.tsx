// ════════════════════════════════════════════════════════════════════════════
// CoreParticles.tsx — Faíscas e pontos de dados do Nucleus
// TINY sparkle points — NOT blobs. Like the reference image sparks.
// ════════════════════════════════════════════════════════════════════════════
import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  CORE_PARTICLES, NUCLEUS_COLORS,
  detectPerformanceTier,
  type JamesCoreState,
} from './jamesSceneConfig'

interface CoreParticlesProps {
  state: JamesCoreState
  intensity: number
}

function buildParticleData(count: number, streams: number) {
  const positions = new Float32Array(count * 3)
  const angles = new Float32Array(count)
  const radii = new Float32Array(count)
  const speeds = new Float32Array(count)
  const streamIds = new Float32Array(count)
  const offsets = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const stream = i % streams
    const baseRadius = 0.4 + stream * 0.6  // spread across wider area
    const radiusVariation = (Math.random() - 0.5) * 0.4

    radii[i] = baseRadius + radiusVariation
    angles[i] = Math.random() * Math.PI * 2
    speeds[i] = 0.15 + Math.random() * 0.35
    streamIds[i] = stream
    offsets[i] = Math.random() * 100

    const angle = angles[i]
    const r = radii[i]
    const tiltX = stream === 0 ? 0.2 : stream === 1 ? -0.3 : 0.1
    const tiltY = stream === 0 ? 0.1 : stream === 1 ? 0.2 : -0.2

    positions[i * 3]     = Math.cos(angle) * r
    positions[i * 3 + 1] = Math.sin(angle) * r * Math.cos(tiltX)
    positions[i * 3 + 2] = Math.sin(angle) * r * Math.sin(tiltY)
  }

  return { positions, angles, radii, speeds, streamIds, offsets }
}

export default function CoreParticles({ state, intensity }: CoreParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null)

  const tier = useMemo(() => detectPerformanceTier(), [])
  const count = CORE_PARTICLES.count[tier]

  const data = useMemo(() => {
    if (count === 0) return null
    return buildParticleData(count, CORE_PARTICLES.streams)
  }, [count])

  const geometry = useMemo(() => {
    if (!data) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    return geo
  }, [data])

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      color: new THREE.Color(NUCLEUS_COLORS.particleMain),
      size: 0.012,  // TINY — like pixel sparks
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  }, [])

  const speedMul = CORE_PARTICLES.speedMultiplier[state]

  useFrame((_, delta) => {
    if (!data || !geometry || !pointsRef.current) return
    const posArr = geometry.attributes.position.array as Float32Array

    for (let i = 0; i < count; i++) {
      data.angles[i] += data.speeds[i] * speedMul * delta
      const angle = data.angles[i]
      const r = data.radii[i]
      const stream = data.streamIds[i]

      const tiltX = stream === 0 ? 0.3 : stream === 1 ? -0.4 : 0.15
      const tiltZ = stream === 0 ? 0.1 : stream === 1 ? -0.15 : 0.25
      const wobble = Math.sin(angle * 2 + data.offsets[i]) * 0.03

      posArr[i * 3]     = Math.cos(angle) * r + wobble
      posArr[i * 3 + 1] = Math.sin(angle) * r * Math.cos(tiltX)
      posArr[i * 3 + 2] = Math.sin(angle) * r * Math.sin(tiltZ) + wobble * 0.5
    }
    geometry.attributes.position.needsUpdate = true

    // Update opacity based on intensity
    material.opacity = Math.min(intensity * 0.6, 0.8)

    // Update color based on state
    if (state === 'listening') material.color.set(NUCLEUS_COLORS.listeningTint)
    else if (state === 'processing') material.color.set(NUCLEUS_COLORS.processingTint)
    else if (state === 'alert') material.color.set(NUCLEUS_COLORS.alertTint)
    else material.color.lerp(new THREE.Color(NUCLEUS_COLORS.particleMain), delta * 3)
  })

  if (!geometry || count === 0) return null

  return (
    <points ref={pointsRef} geometry={geometry} material={material} />
  )
}
