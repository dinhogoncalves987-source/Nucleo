// ════════════════════════════════════════════════════════════════════════════
// CoreHUD.tsx — Interface orbital técnica do Nucleus
// Arcos segmentados, ticks, brackets, dados técnicos
// Referência: reator industrial com HUD cinematográfico
// ════════════════════════════════════════════════════════════════════════════
import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Line } from '@react-three/drei'
import * as THREE from 'three'
import { CORE_HUD, NUCLEUS_COLORS, type JamesCoreState } from './jamesSceneConfig'

// ── Arc points builder (returns Vector3 array for drei Line) ──────────────
function arcPoints(radius: number, startAngle: number, endAngle: number, segments = 64): [number, number, number][] {
  const pts: [number, number, number][] = []
  const step = (endAngle - startAngle) / segments
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + i * step
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius, 0])
  }
  return pts
}

interface CoreHUDProps {
  state: JamesCoreState
  intensity: number
}

// Arc builder (kept for tick/bracket geometries)

// ── Tick marks builder ────────────────────────────────────────────────────
function buildTicks(radius: number, count: number, len: number, majorEvery: number): THREE.BufferGeometry {
  const pts: number[] = []
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const isMajor = i % majorEvery === 0
    const l = isMajor ? len * 2.5 : len
    pts.push(cos * radius, sin * radius, 0)
    pts.push(cos * (radius + l), sin * (radius + l), 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

// ── Corner brackets ───────────────────────────────────────────────────────
function buildBrackets(radius: number, size: number): THREE.BufferGeometry {
  const pts: number[] = []
  const corners = [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]
  for (const base of corners) {
    const c = Math.cos(base), s = Math.sin(base)
    const x = c * radius, y = s * radius
    const dx = Math.cos(base + Math.PI / 2)
    const dy = Math.sin(base + Math.PI / 2)
    pts.push(x + dx * size, y + dy * size, 0, x, y, 0)
    pts.push(x, y, 0, x - dx * size, y - dy * size, 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

// ── Radial lines ──────────────────────────────────────────────────────────
function buildRadials(innerR: number, outerR: number, count: number): THREE.BufferGeometry {
  const pts: number[] = []
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / 8
    const c = Math.cos(a), s = Math.sin(a)
    pts.push(c * innerR, s * innerR, 0)
    pts.push(c * outerR, s * outerR, 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

const STATE_LABEL: Record<JamesCoreState, string> = {
  idle_dark: 'STANDBY', eyes_half_awake: 'WAKING', vault_opening: 'BOOTING',
  eyes_full_power: 'POWERING', emergence_ready: 'READY', listening: 'LISTENING',
  processing: 'PROCESSING', speaking: 'SPEAKING', sleeping: 'HIBERNATING', alert: 'ALERT',
}

const FONT_URL = 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf'

export default function CoreHUD({ state, intensity }: CoreHUDProps) {
  const outerGroupRef = useRef<THREE.Group>(null)
  const innerGroupRef = useRef<THREE.Group>(null)
  const labelsRef = useRef<THREE.Group>(null)

  const targetOpacity = CORE_HUD.opacity[state] * intensity

  // ── Arc point arrays (for drei Line) ─────────────────────────────────────
  const outerArcPts = useMemo(() => [
    arcPoints(1.55, 0.08, 1.35), arcPoints(1.55, 1.7, 2.75),
    arcPoints(1.55, 3.15, 4.55), arcPoints(1.55, 4.9, 6.1),
  ], [])
  const midArcPts = useMemo(() => [
    arcPoints(1.3, 0.3, 1.6), arcPoints(1.3, 2.0, 3.5),
    arcPoints(1.3, 3.8, 5.1), arcPoints(1.3, 5.5, 6.15),
  ], [])
  const innerArcPts = useMemo(() => [
    arcPoints(1.05, 0.5, 2.0), arcPoints(1.05, 3.5, 5.0),
  ], [])

  // Tick marks at multiple radii
  const outerTicks = useMemo(() => buildTicks(1.5, 72, 0.03, 9), [])
  const midTicks = useMemo(() => buildTicks(1.25, 48, 0.025, 12), [])
  const innerTicks = useMemo(() => buildTicks(1.0, 36, 0.02, 9), [])

  // Brackets
  const outerBrackets = useMemo(() => buildBrackets(1.7, 0.12), [])
  const innerBrackets = useMemo(() => buildBrackets(0.85, 0.06), [])

  // Radial lines
  const radials = useMemo(() => buildRadials(0.2, 1.0, 8), [])
  const outerRadials = useMemo(() => buildRadials(1.1, 1.5, 12), [])

  useFrame((_, delta) => {
    if (outerGroupRef.current) outerGroupRef.current.rotation.z += delta * 0.015
    if (innerGroupRef.current) innerGroupRef.current.rotation.z -= delta * 0.025
    if (labelsRef.current) {
      // Counter-rotate labels for readability
      labelsRef.current.rotation.z -= delta * 0.015
    }
  })

  const hudColor = state === 'alert' ? NUCLEUS_COLORS.alertTint
    : state === 'listening' ? NUCLEUS_COLORS.listeningTint
    : NUCLEUS_COLORS.hudText

  return (
    <group>
      {/* ═══ Outer HUD layer (slow rotate) ═══ */}
      <group ref={outerGroupRef}>
        {/* Outer arcs */}
        {outerArcPts.map((pts, i) => (
          <Line key={`oa-${i}`} points={pts} color={hudColor} transparent opacity={targetOpacity * 0.7} lineWidth={1} depthWrite={false} />
        ))}
        {/* Outer ticks */}
        <lineSegments geometry={outerTicks}>
          <lineBasicMaterial color={hudColor} transparent opacity={targetOpacity * 0.5} depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineSegments>
        {/* Outer brackets */}
        <lineSegments geometry={outerBrackets}>
          <lineBasicMaterial color={hudColor} transparent opacity={targetOpacity * 0.8} depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineSegments>
        {/* Outer radial lines */}
        <lineSegments geometry={outerRadials}>
          <lineBasicMaterial color={NUCLEUS_COLORS.hudLine} transparent opacity={targetOpacity * 0.2} depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineSegments>

        {/* Labels — counter-rotating */}
        <group ref={labelsRef}>
          {[
            { angle: 0.05, text: 'J-AI v3.0', r: 1.62 },
            { angle: Math.PI / 2, text: 'SYS.ACTIVE', r: 1.62 },
            { angle: Math.PI, text: 'O NÚCLEO', r: 1.62 },
            { angle: Math.PI * 1.5, text: 'CORE.ONLINE', r: 1.62 },
            { angle: Math.PI * 0.3, text: '///READY', r: 1.38 },
            { angle: Math.PI * 1.2, text: 'DEPTH.3', r: 1.38 },
            { angle: Math.PI * 0.75, text: '◆ STATUS', r: 1.38 },
            { angle: Math.PI * 1.75, text: 'PROT.OK', r: 1.38 },
          ].map((l, i) => (
            <Text key={i}
              position={[Math.cos(l.angle) * l.r, Math.sin(l.angle) * l.r, 0]}
              fontSize={0.045} color={hudColor} anchorX="center" anchorY="middle"
              font={FONT_URL} fillOpacity={targetOpacity * 0.65}
              letterSpacing={0.15} renderOrder={10}
            >
              {l.text}
            </Text>
          ))}
        </group>
      </group>

      {/* ═══ Mid HUD layer (counter-rotate) ═══ */}
      <group ref={innerGroupRef}>
        {midArcPts.map((pts, i) => (
          <Line key={`ma-${i}`} points={pts} color={NUCLEUS_COLORS.ringAccent} transparent opacity={targetOpacity * 0.45} lineWidth={1} depthWrite={false} />
        ))}
        <lineSegments geometry={midTicks}>
          <lineBasicMaterial color={NUCLEUS_COLORS.ringAccent} transparent opacity={targetOpacity * 0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineSegments>
      </group>

      {/* ═══ Inner HUD layer (static) ═══ */}
      {innerArcPts.map((pts, i) => (
        <Line key={`ia-${i}`} points={pts} color={hudColor} transparent opacity={targetOpacity * 0.5} lineWidth={1} depthWrite={false} />
      ))}
      <lineSegments geometry={innerTicks}>
        <lineBasicMaterial color={hudColor} transparent opacity={targetOpacity * 0.4} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
      <lineSegments geometry={innerBrackets}>
        <lineBasicMaterial color={hudColor} transparent opacity={targetOpacity * 0.65} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>

      {/* Radial lines — from center outwards */}
      <lineSegments geometry={radials}>
        <lineBasicMaterial color={NUCLEUS_COLORS.hudLine} transparent opacity={targetOpacity * 0.12} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>

      {/* ═══ State indicator ═══ */}
      <Text
        position={[0, -0.42, 0.01]} fontSize={0.05}
        color={hudColor} anchorX="center" anchorY="middle"
        font={FONT_URL} fillOpacity={targetOpacity * 0.85}
        letterSpacing={0.25} renderOrder={10}
      >
        {`[ ${STATE_LABEL[state]} ]`}
      </Text>
    </group>
  )
}
