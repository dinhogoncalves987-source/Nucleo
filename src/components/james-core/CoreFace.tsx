// ════════════════════════════════════════════════════════════════════════════
// CoreFace.tsx — Rosto holográfico do James que aparece dentro do Nucleus
// Fade-in suave quando o James está ativo, scan lines, pulsação
// ════════════════════════════════════════════════════════════════════════════
import { useRef, useMemo, useState, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { JamesCoreState } from './jamesSceneConfig'

interface CoreFaceProps {
  state: JamesCoreState
  intensity: number
}

// States where the face should be visible
const FACE_VISIBLE_STATES: JamesCoreState[] = [
  'emergence_ready', 'listening', 'processing', 'speaking', 'alert'
]

// Target opacity per state — increased for better visibility
const FACE_OPACITY: Record<JamesCoreState, number> = {
  idle_dark:       0,
  eyes_half_awake: 0,
  vault_opening:   0.1,
  eyes_full_power: 0.35,
  emergence_ready: 0.85,
  listening:       0.95,
  processing:      0.75,
  speaking:        1.0,
  sleeping:        0,
  alert:           1.0,
}

// Face scale per state
const FACE_SCALE: Record<JamesCoreState, number> = {
  idle_dark:       0.3,
  eyes_half_awake: 0.5,
  vault_opening:   0.6,
  eyes_full_power: 0.85,
  emergence_ready: 1.0,
  listening:       1.0,
  processing:      0.95,
  speaking:        1.05,
  sleeping:        0.3,
  alert:           1.1,
}

const vertexShader = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */`
uniform sampler2D uFaceTexture;
uniform float uOpacity;
uniform float uTime;
uniform float uScanSpeed;
uniform vec3 uTintColor;
uniform float uLoaded;

varying vec2 vUv;

void main() {
  // If texture not loaded, discard
  if (uLoaded < 0.5) discard;

  vec4 tex = texture2D(uFaceTexture, vUv);

  // Luminance — weighted for holographic blue
  float lum = dot(tex.rgb, vec3(0.2, 0.25, 0.55));

  // Holographic tint — boosted brightness
  vec3 holoColor = uTintColor * lum * 2.5;

  // Add bright highlights on bright areas
  float highlight = smoothstep(0.45, 0.8, lum);
  holoColor += vec3(0.3, 0.6, 1.0) * highlight * 0.8;

  // Scan lines — horizontal
  float scanLine = sin(vUv.y * 120.0 + uTime * uScanSpeed) * 0.5 + 0.5;
  scanLine = smoothstep(0.35, 0.65, scanLine);
  float scanEffect = mix(0.8, 1.0, scanLine);

  // Slow horizontal glitch sweep
  float glitchY = fract(uTime * 0.12);
  float glitch = 1.0 - smoothstep(0.0, 0.008, abs(vUv.y - glitchY)) * 0.15;

  // Circular vignette — face emerges from center
  float dist = length(vUv - 0.5);
  float vignette = 1.0 - smoothstep(0.2, 0.48, dist);

  // Compose alpha
  float alpha = lum * uOpacity * vignette * scanEffect;
  // Ensure minimum visibility when opacity is high
  alpha = max(alpha, lum * uOpacity * 0.3 * vignette);

  // Final color
  vec3 finalColor = holoColor * scanEffect * glitch;

  // Pulse glow
  float pulse = sin(uTime * 1.2) * 0.06 + 0.94;
  finalColor *= pulse;
  alpha *= pulse;

  gl_FragColor = vec4(finalColor, alpha);
}
`

export default function CoreFace({ state, intensity }: CoreFaceProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef  = useRef<THREE.ShaderMaterial>(null)
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  // Load face texture manually (more robust than useLoader)
  useEffect(() => {
    const loader = new THREE.TextureLoader()
    console.log('[CoreFace] Loading james-face.png...')
    loader.load(
      '/james-face.png',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        setTexture(tex)
        console.log('[CoreFace] ✅ Face texture loaded successfully')
      },
      undefined,
      (err) => {
        console.error('[CoreFace] ❌ Failed to load face texture:', err)
      }
    )
  }, [])

  const dummyTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    return new THREE.CanvasTexture(canvas)
  }, [])

  const uniforms = useMemo(() => ({
    uFaceTexture: { value: dummyTexture },
    uOpacity:     { value: 0 },
    uTime:        { value: 0 },
    uScanSpeed:   { value: 3.0 },
    uTintColor:   { value: new THREE.Color(0x00b4ff) },
    uLoaded:      { value: 0 },
  }), [dummyTexture])

  // Update texture when loaded
  useEffect(() => {
    if (texture && matRef.current) {
      matRef.current.uniforms.uFaceTexture.value = texture
      matRef.current.uniforms.uLoaded.value = 1.0
      matRef.current.needsUpdate = true
      console.log('[CoreFace] Texture applied to material')
    }
  }, [texture])

  // Track targets for smooth lerp
  const targetOpacity = useRef(0)
  const targetScale   = useRef(0.3)
  const currentScale  = useRef(0.3)

  // Determine targets based on state
  targetOpacity.current = FACE_OPACITY[state] * intensity
  targetScale.current   = FACE_SCALE[state]

  const isVisible = FACE_VISIBLE_STATES.includes(state) || state === 'eyes_full_power' || state === 'vault_opening'

  // Tint color based on state
  const tintColor = useRef(new THREE.Color(0x00b4ff))
  if (state === 'listening')       tintColor.current.set(0x22dd88)
  else if (state === 'processing') tintColor.current.set(0x8855ff)
  else if (state === 'speaking')   tintColor.current.set(0x00ccff)
  else if (state === 'alert')      tintColor.current.set(0xff4444)
  else tintColor.current.set(0x00b4ff)

  useFrame((_, delta) => {
    if (!matRef.current || !meshRef.current) return

    const u = matRef.current.uniforms
    u.uTime.value += delta

    // Smooth opacity transition (faster fade-in)
    const opTarget = isVisible ? targetOpacity.current : 0
    u.uOpacity.value += (opTarget - u.uOpacity.value) * delta * 3.5

    // Smooth scale transition
    const scTarget = isVisible ? targetScale.current : 0.3
    currentScale.current += (scTarget - currentScale.current) * delta * 4
    meshRef.current.scale.setScalar(currentScale.current)

    // Smooth color transition
    ;(u.uTintColor.value as THREE.Color).lerp(tintColor.current, delta * 4)

    // Scan speed — faster when processing/speaking
    const scanTarget = state === 'processing' ? 8.0
      : state === 'speaking' ? 5.0
      : state === 'listening' ? 4.0
      : 3.0
    u.uScanSpeed.value += (scanTarget - u.uScanSpeed.value) * delta * 2

    // Subtle breathing motion
    const breathe = Math.sin(u.uTime.value * 0.8) * 0.015
    meshRef.current.position.y = breathe
  })

  return (
    <mesh ref={meshRef} position={[0, 0, 0.2]} renderOrder={10}>
      <planeGeometry args={[2.0, 2.0, 1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}
