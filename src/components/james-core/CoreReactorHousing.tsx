// ════════════════════════════════════════════════════════════════════════════
// CoreReactorHousing.tsx — Estrutura de reator ao redor do Nucleus
// Preenche a área exterior (que está preta) com estruturas industriais/tech
// Inspirado na referência: painéis, grid, linhas, circuitos, depth
// ════════════════════════════════════════════════════════════════════════════
import { useMemo } from 'react'
import * as THREE from 'three'
import { NUCLEUS_COLORS, type JamesCoreState } from './jamesSceneConfig'

interface CoreReactorHousingProps {
  state: JamesCoreState
  intensity: number
}

// ── Build concentric grid rings (static structural rings) ─────────────────
function buildGridRing(radius: number, segments: number): THREE.BufferGeometry {
  const pts: number[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    pts.push(Math.cos(a) * radius, Math.sin(a) * radius, 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

// ── Build radial spokes from center outward ───────────────────────────────
function buildSpokes(innerR: number, outerR: number, count: number): THREE.BufferGeometry {
  const pts: number[] = []
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    pts.push(c * innerR, s * innerR, 0)
    pts.push(c * outerR, s * outerR, 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

// ── Build panel outlines (rectangular 3D panels in the housing) ───────────
function buildPanels(): THREE.BufferGeometry {
  const pts: number[] = []
  const panelCount = 16
  for (let i = 0; i < panelCount; i++) {
    const angle = (i / panelCount) * Math.PI * 2
    const r = 1.8 + Math.random() * 0.5
    const cx = Math.cos(angle) * r
    const cy = Math.sin(angle) * r
    const size = 0.08 + Math.random() * 0.12
    const aspect = 0.5 + Math.random() * 1.0
    const rot = angle + Math.PI / 2 // tangential

    const dx = Math.cos(rot) * size * aspect
    const dy = Math.sin(rot) * size * aspect
    const px = Math.cos(rot + Math.PI / 2) * size
    const py = Math.sin(rot + Math.PI / 2) * size

    // Rectangle outline
    pts.push(cx - dx - px, cy - dy - py, 0, cx + dx - px, cy + dy - py, 0) // bottom
    pts.push(cx + dx - px, cy + dy - py, 0, cx + dx + px, cy + dy + py, 0) // right
    pts.push(cx + dx + px, cy + dy + py, 0, cx - dx + px, cy - dy + py, 0) // top
    pts.push(cx - dx + px, cy - dy + py, 0, cx - dx - px, cy - dy - py, 0) // left
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

// ── Build circuit traces (random connector lines between rings) ───────────
function buildCircuitTraces(): THREE.BufferGeometry {
  const pts: number[] = []
  const traceCount = 24
  for (let i = 0; i < traceCount; i++) {
    const angle1 = Math.random() * Math.PI * 2
    const angle2 = angle1 + (Math.random() - 0.5) * 0.3
    const r1 = 1.4 + Math.random() * 0.3
    const r2 = r1 + 0.2 + Math.random() * 0.4

    pts.push(Math.cos(angle1) * r1, Math.sin(angle1) * r1, 0)
    pts.push(Math.cos(angle2) * r2, Math.sin(angle2) * r2, 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

// ── Build structural hash marks at outer radii ────────────────────────────
function buildOuterHashMarks(): THREE.BufferGeometry {
  const pts: number[] = []
  const count = 120
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    const isMajor = i % 10 === 0
    const isMinor = i % 5 === 0
    const innerR = 2.1
    const len = isMajor ? 0.15 : isMinor ? 0.08 : 0.04
    pts.push(c * innerR, s * innerR, 0)
    pts.push(c * (innerR + len), s * (innerR + len), 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

// ── Small glow dots at junction points ────────────────────────────────────
function JunctionDots({ intensity }: { intensity: number }) {
  const positions = useMemo(() => {
    const pts: [number, number, number][] = []
    const count = 30
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = 1.3 + Math.random() * 1.0
      pts.push([Math.cos(angle) * r, Math.sin(angle) * r, 0])
    }
    return pts
  }, [])

  return (
    <>
      {positions.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.008, 4, 4]} />
          <meshBasicMaterial
            color={i % 3 === 0 ? NUCLEUS_COLORS.ringAccent : NUCLEUS_COLORS.ringPrimary}
            transparent
            opacity={intensity * 0.4}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </>
  )
}

export default function CoreReactorHousing({ state, intensity }: CoreReactorHousingProps) {
  // ── Structural rings — concentric circles at different radii ────────────
  const structuralRings = useMemo(() => [
    buildGridRing(1.4, 96),
    buildGridRing(1.6, 96),
    buildGridRing(1.85, 120),
    buildGridRing(2.1, 120),
    buildGridRing(2.35, 80),
    buildGridRing(2.6, 80),
  ], [])

  // ── Radial spokes — from mid radius to outer edge ──────────────────────
  const innerSpokes = useMemo(() => buildSpokes(1.4, 1.85, 24), [])
  const outerSpokes = useMemo(() => buildSpokes(1.85, 2.35, 16), [])
  const deepSpokes = useMemo(() => buildSpokes(2.35, 2.8, 12), [])

  // ── Panel outlines ─────────────────────────────────────────────────────
  const panels = useMemo(() => buildPanels(), [])

  // ── Circuit traces ─────────────────────────────────────────────────────
  const circuits = useMemo(() => buildCircuitTraces(), [])

  // ── Outer hash marks ───────────────────────────────────────────────────
  const hashMarks = useMemo(() => buildOuterHashMarks(), [])

  const structColor = state === 'alert' ? NUCLEUS_COLORS.alertTint : '#0a3060'
  const detailColor = state === 'alert' ? NUCLEUS_COLORS.alertTint : '#0d4a80'
  const accentColor = state === 'alert' ? '#ff4444' : '#1a6090'
  const baseOpacity = intensity * 0.3

  return (
    <group>
      {/* Structural rings — faint concentric circles */}
      {structuralRings.map((geo, i) => (
        <lineLoop key={`sr-${i}`} geometry={geo}>
          <lineBasicMaterial
            color={i < 3 ? structColor : '#081828'}
            transparent
            opacity={baseOpacity * (1 - i * 0.12)}
            depthWrite={false}
          />
        </lineLoop>
      ))}

      {/* Radial spokes */}
      <lineSegments geometry={innerSpokes}>
        <lineBasicMaterial color={structColor} transparent opacity={baseOpacity * 0.5} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={outerSpokes}>
        <lineBasicMaterial color={detailColor} transparent opacity={baseOpacity * 0.3} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={deepSpokes}>
        <lineBasicMaterial color={'#061020'} transparent opacity={baseOpacity * 0.2} depthWrite={false} />
      </lineSegments>

      {/* Panel outlines */}
      <lineSegments geometry={panels}>
        <lineBasicMaterial color={accentColor} transparent opacity={baseOpacity * 0.35} depthWrite={false} />
      </lineSegments>

      {/* Circuit traces */}
      <lineSegments geometry={circuits}>
        <lineBasicMaterial
          color={detailColor}
          transparent
          opacity={baseOpacity * 0.25}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      {/* Outer hash marks */}
      <lineSegments geometry={hashMarks}>
        <lineBasicMaterial color={structColor} transparent opacity={baseOpacity * 0.45} depthWrite={false} />
      </lineSegments>

      {/* Junction dots — small glowing points at intersections */}
      <JunctionDots intensity={intensity} />
    </group>
  )
}
