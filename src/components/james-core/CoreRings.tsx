// ════════════════════════════════════════════════════════════════════════════
// CoreRings.tsx — Anéis orbitais do Nucleus — Armillary Sphere / Gyroscope
// Visual estruturado e cinematográfico: anéis concêntricos com inclinações
// coordenadas, sem cruzamento caótico. Cada camada tem identidade visual.
// ════════════════════════════════════════════════════════════════════════════
import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CORE_RINGS, NUCLEUS_COLORS, type JamesCoreState } from './jamesSceneConfig'

interface CoreRingsProps {
  state: JamesCoreState
  intensity: number
}

// ── Build a solid ring (torus) ────────────────────────────────────────────
function DetailedRing({
  radius, tubeRadius, tiltX, tiltY, speed, direction, color, opacity, state, intensity, segments, arcStart, arcEnd,
}: {
  radius: number; tubeRadius: number; tiltX: number; tiltY: number;
  speed: number; direction: number; color: string; opacity: number;
  state: JamesCoreState; intensity: number; segments?: number;
  arcStart?: number; arcEnd?: number;
}) {
  const groupRef = useRef<THREE.Group>(null)
  const speedMul = CORE_RINGS.speedMultiplier[state]
  const arc = (arcEnd ?? Math.PI * 2) - (arcStart ?? 0)

  useFrame((_, delta) => {
    if (!groupRef.current) return
    groupRef.current.rotation.z += speed * speedMul * direction * delta
  })

  const ringColor = useMemo(() => {
    const c = new THREE.Color(color)
    if (state === 'listening') c.lerp(new THREE.Color(NUCLEUS_COLORS.listeningTint), 0.3)
    else if (state === 'processing') c.lerp(new THREE.Color(NUCLEUS_COLORS.processingTint), 0.3)
    else if (state === 'alert') c.lerp(new THREE.Color(NUCLEUS_COLORS.alertTint), 0.5)
    return c
  }, [color, state])

  return (
    <group rotation={[tiltX * Math.PI / 180, tiltY * Math.PI / 180, 0]}>
      <group ref={groupRef}>
        <mesh rotation={[Math.PI / 2, 0, arcStart ?? 0]}>
          <torusGeometry args={[radius, tubeRadius, 8, segments ?? 64, arc]} />
          <meshBasicMaterial
            color={ringColor}
            transparent
            opacity={opacity * intensity}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
    </group>
  )
}

// ── Tick marks ring (small radial bars around a ring) ─────────────────────
function TickRing({
  radius, count, length, tiltX, tiltY, speed, direction, color, opacity, state, intensity,
}: {
  radius: number; count: number; length: number;
  tiltX: number; tiltY: number; speed: number; direction: number;
  color: string; opacity: number; state: JamesCoreState; intensity: number;
}) {
  const groupRef = useRef<THREE.Group>(null)
  const speedMul = CORE_RINGS.speedMultiplier[state]

  const tickGeo = useMemo(() => {
    const verts: number[] = []
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const isMajor = i % Math.floor(count / 4) === 0
      const len = isMajor ? length * 2.0 : length

      verts.push(cos * radius, sin * radius, 0)
      verts.push(cos * (radius + len), sin * (radius + len), 0)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    return g
  }, [radius, count, length])

  useFrame((_, delta) => {
    if (!groupRef.current) return
    groupRef.current.rotation.z += speed * speedMul * direction * delta
  })

  return (
    <group rotation={[tiltX * Math.PI / 180, tiltY * Math.PI / 180, 0]}>
      <group ref={groupRef}>
        <lineSegments geometry={tickGeo}>
          <lineBasicMaterial
            color={color}
            transparent
            opacity={opacity * intensity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      </group>
    </group>
  )
}

// ── Dot markers on ring ───────────────────────────────────────────────────
function DotMarkers({
  radius, count, dotSize, tiltX, tiltY, speed, direction, color, opacity, state, intensity,
}: {
  radius: number; count: number; dotSize: number;
  tiltX: number; tiltY: number; speed: number; direction: number;
  color: string; opacity: number; state: JamesCoreState; intensity: number;
}) {
  const groupRef = useRef<THREE.Group>(null)
  const speedMul = CORE_RINGS.speedMultiplier[state]

  const positions = useMemo(() => {
    const arr: [number, number, number][] = []
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      arr.push([Math.cos(a) * radius, Math.sin(a) * radius, 0])
    }
    return arr
  }, [radius, count])

  useFrame((_, delta) => {
    if (!groupRef.current) return
    groupRef.current.rotation.z += speed * speedMul * direction * delta
  })

  return (
    <group rotation={[tiltX * Math.PI / 180, tiltY * Math.PI / 180, 0]}>
      <group ref={groupRef}>
        {positions.map((pos, i) => (
          <mesh key={i} position={pos}>
            <sphereGeometry args={[dotSize, 6, 6]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={opacity * intensity}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>
    </group>
  )
}

// ── Main Export ────────────────────────────────────────────────────────────
// DESIGN: Armillary sphere / gyroscope — anéis organizados em camadas
// Camada 1 (interna) = plano XY quase reto (horizon ring)
// Camada 2 (primária) = inclinação sutil tipo equatorial
// Camada 3 (mid) = inclinação média — visual de profundidade
// Camada 4 (externa) = complementar — fecha a esfera
// Todas as inclinações se complementam, nunca se emaranham
export default function CoreRings({ state, intensity }: CoreRingsProps) {
  return (
    <group>
      {/* ═══ Layer 1: Inner horizon ring — quase plano, base visual ═══ */}
      <DetailedRing radius={0.30} tubeRadius={0.006} tiltX={85} tiltY={0} speed={0.4} direction={1} color={NUCLEUS_COLORS.ringPrimary} opacity={0.65} state={state} intensity={intensity} />
      <TickRing radius={0.27} count={24} length={0.025} tiltX={85} tiltY={0} speed={0.4} direction={1} color={NUCLEUS_COLORS.ringPrimary} opacity={0.4} state={state} intensity={intensity} />

      {/* ═══ Layer 2: Primary equatorial ring — dominante, anel principal ═══ */}
      {/* Anel completo grosso */}
      <DetailedRing radius={0.50} tubeRadius={0.012} tiltX={75} tiltY={0} speed={0.3} direction={-1} color={NUCLEUS_COLORS.ringPrimary} opacity={0.8} state={state} intensity={intensity} />
      {/* Anel secundário com tilt complementar suave (meridiano) */}
      <DetailedRing radius={0.53} tubeRadius={0.007} tiltX={0} tiltY={75} speed={0.22} direction={1} color={NUCLEUS_COLORS.ringSecondary} opacity={0.5} state={state} intensity={intensity} />
      {/* Tick marks alinhados ao anel principal */}
      <TickRing radius={0.47} count={36} length={0.035} tiltX={75} tiltY={0} speed={0.3} direction={-1} color={NUCLEUS_COLORS.ringPrimary} opacity={0.5} state={state} intensity={intensity} />
      {/* Dot markers — accent gold */}
      <DotMarkers radius={0.50} count={8} dotSize={0.012} tiltX={75} tiltY={0} speed={0.3} direction={-1} color={NUCLEUS_COLORS.ringAccent} opacity={0.85} state={state} intensity={intensity} />

      {/* ═══ Layer 3: Mid rings — profundidade e detail ═══ */}
      {/* Arc parcial (segmento de anel — adiciona tech visual) */}
      <DetailedRing radius={0.72} tubeRadius={0.009} tiltX={65} tiltY={12} speed={0.18} direction={1} color={NUCLEUS_COLORS.ringPrimary} opacity={0.45} state={state} intensity={intensity} arcStart={0} arcEnd={Math.PI * 1.4} />
      <DetailedRing radius={0.72} tubeRadius={0.009} tiltX={65} tiltY={12} speed={0.18} direction={1} color={NUCLEUS_COLORS.ringPrimary} opacity={0.45} state={state} intensity={intensity} arcStart={Math.PI * 1.65} arcEnd={Math.PI * 1.95} />
      {/* Anel accent (gold) — meridiano complementar */}
      <DetailedRing radius={0.76} tubeRadius={0.005} tiltX={10} tiltY={70} speed={0.25} direction={-1} color={NUCLEUS_COLORS.ringAccent} opacity={0.4} state={state} intensity={intensity} />
      {/* Tick marks mid layer */}
      <TickRing radius={0.69} count={48} length={0.03} tiltX={65} tiltY={12} speed={0.18} direction={1} color={NUCLEUS_COLORS.ringSecondary} opacity={0.35} state={state} intensity={intensity} />

      {/* ═══ Layer 4: Outer structural rings — enquadram a esfera ═══ */}
      {/* Anel externo equatorial */}
      <DetailedRing radius={0.95} tubeRadius={0.007} tiltX={80} tiltY={-5} speed={0.1} direction={1} color={NUCLEUS_COLORS.ringSecondary} opacity={0.3} state={state} intensity={intensity} />
      {/* Arco parcial — oposto, fecha a armillary sphere */}
      <DetailedRing radius={0.98} tubeRadius={0.005} tiltX={5} tiltY={80} speed={0.12} direction={-1} color={NUCLEUS_COLORS.ringPrimary} opacity={0.22} state={state} intensity={intensity} arcStart={0.2} arcEnd={Math.PI * 1.6} />
      {/* Tick marks externo */}
      <TickRing radius={0.92} count={60} length={0.025} tiltX={80} tiltY={-5} speed={0.1} direction={1} color={NUCLEUS_COLORS.ringPrimary} opacity={0.25} state={state} intensity={intensity} />
      {/* Dot markers externo */}
      <DotMarkers radius={0.95} count={12} dotSize={0.007} tiltX={80} tiltY={-5} speed={0.1} direction={1} color={NUCLEUS_COLORS.ringPrimary} opacity={0.5} state={state} intensity={intensity} />

      {/* ═══ Layer 5: Outermost boundary — sutil, fecha o visual ═══ */}
      <DetailedRing radius={1.20} tubeRadius={0.004} tiltX={78} tiltY={5} speed={0.06} direction={-1} color={NUCLEUS_COLORS.ringTertiary} opacity={0.18} state={state} intensity={intensity} />
      <DetailedRing radius={1.25} tubeRadius={0.003} tiltX={8} tiltY={78} speed={0.05} direction={1} color={NUCLEUS_COLORS.ringTertiary} opacity={0.12} state={state} intensity={intensity} arcStart={0.3} arcEnd={Math.PI * 1.8} />
    </group>
  )
}
