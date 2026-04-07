// ════════════════════════════════════════════════════════════════════════════
// jamesSceneConfig.ts — Constantes visuais do James Nucleus 3D (Fase 2)
// Motor de inteligência vivo — não um componente de UI
// ════════════════════════════════════════════════════════════════════════════

// ── Core States ───────────────────────────────────────────────────────────
export type JamesCoreState =
  | 'idle_dark'
  | 'eyes_half_awake'
  | 'vault_opening'
  | 'eyes_full_power'
  | 'emergence_ready'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'sleeping'
  | 'alert'

// ── Nucleus Color Palette ─────────────────────────────────────────────────
export const NUCLEUS_COLORS = {
  // Core energy
  coreInner:    '#ffffff',
  coreGlow:     '#00b4ff',
  corePulse:    '#0088ff',

  // Rings
  ringPrimary:  '#00b4ff',
  ringSecondary:'#0066cc',
  ringTertiary: '#003366',
  ringAccent:   '#d4a017',

  // Particles
  particleMain: '#00b4ff',
  particleWarm: '#d4a017',
  particleDim:  '#004488',

  // HUD
  hudText:      '#00b4ff',
  hudLine:      '#006099',
  hudBright:    '#00ccff',

  // State overrides
  listeningTint:  '#22dd88',
  processingTint: '#8855ff',
  speakingTint:   '#00ccff',
  alertTint:      '#ff4444',

  // Background
  background:   '#030308',
} as const

// ── Nucleus Intensity per State ───────────────────────────────────────────
export const NUCLEUS_INTENSITY: Record<JamesCoreState, number> = {
  idle_dark:       0.5,
  eyes_half_awake: 0.65,
  vault_opening:   0.8,
  eyes_full_power: 0.95,
  emergence_ready: 0.9,
  listening:       1.0,
  processing:      1.0,
  speaking:        0.9,
  sleeping:        0.15,
  alert:           1.0,
}

// ── Core Center Config ────────────────────────────────────────────────────
export const CORE_CENTER = {
  radius: 0.35,
  pulseSpeed: {
    idle_dark:       0.5,
    eyes_half_awake: 0.8,
    vault_opening:   1.2,
    eyes_full_power: 1.5,
    emergence_ready: 1.0,
    listening:       2.5,
    processing:      3.0,
    speaking:        1.8,
    sleeping:        0.2,
    alert:           4.0,
  } as Record<JamesCoreState, number>,
  glowIntensity: {
    idle_dark:       0.5,
    eyes_half_awake: 0.7,
    vault_opening:   1.0,
    eyes_full_power: 1.5,
    emergence_ready: 1.2,
    listening:       1.8,
    processing:      2.0,
    speaking:        1.5,
    sleeping:        0.1,
    alert:           2.5,
  } as Record<JamesCoreState, number>,
} as const

// ── Rings Config ──────────────────────────────────────────────────────────
export const CORE_RINGS = {
  count: 7,
  baseRadius: 0.5,
  radiusStep: 0.22,
  thickness: 0.008,
  speedMultiplier: {
    idle_dark:       0.15,
    eyes_half_awake: 0.3,
    vault_opening:   0.6,
    eyes_full_power: 0.8,
    emergence_ready: 0.5,
    listening:       0.7,
    processing:      1.5,
    speaking:        0.6,
    sleeping:        0.05,
    alert:           2.0,
  } as Record<JamesCoreState, number>,
} as const

// ── Particles Config ──────────────────────────────────────────────────────
export const CORE_PARTICLES = {
  count: {
    high:   200,
    medium: 100,
    low:    0,   // fallback 2D
  },
  streams: 3,
  baseSpeed: 0.3,
  spreadRadius: 2.2,
  speedMultiplier: {
    idle_dark:       0.2,
    eyes_half_awake: 0.4,
    vault_opening:   0.7,
    eyes_full_power: 0.9,
    emergence_ready: 0.6,
    listening:       0.8,
    processing:      1.8,
    speaking:        0.7,
    sleeping:        0.0,
    alert:           2.5,
  } as Record<JamesCoreState, number>,
} as const

// ── HUD Config ────────────────────────────────────────────────────────────
export const CORE_HUD = {
  arcCount: 4,
  arcRadius: 1.8,
  labelRadius: 2.1,
  opacity: {
    idle_dark:       0.08,
    eyes_half_awake: 0.2,
    vault_opening:   0.4,
    eyes_full_power: 0.7,
    emergence_ready: 0.6,
    listening:       0.7,
    processing:      0.9,
    speaking:        0.5,
    sleeping:        0.0,
    alert:           1.0,
  } as Record<JamesCoreState, number>,
} as const

// ── Lighting Config ───────────────────────────────────────────────────────
export const CORE_LIGHTING = {
  pointIntensity: {
    idle_dark:       1.0,
    eyes_half_awake: 1.5,
    vault_opening:   2.0,
    eyes_full_power: 3.0,
    emergence_ready: 2.5,
    listening:       3.0,
    processing:      3.5,
    speaking:        2.5,
    sleeping:        0.2,
    alert:           4.0,
  } as Record<JamesCoreState, number>,
} as const

// ── Camera ────────────────────────────────────────────────────────────────
export const CAMERA_CONFIG = {
  fov: 75,
  position: [0, 0, 3.2] as [number, number, number],
  near: 0.1,
  far: 30,
} as const

// ── Boot Sequence Timing ──────────────────────────────────────────────────
export const BOOT_TIMING = {
  fadeIn:    { duration: 0.6, ease: 'power2.in' },
  ringsUp:  { duration: 1.2, ease: 'power2.inOut' },
  coreGlow: { duration: 0.8, ease: 'power2.out' },
  hudFade:  { duration: 0.6, ease: 'power1.out' },
  total: 3.2,
} as const

// ── Performance Tiers ─────────────────────────────────────────────────────
export type PerformanceTier = 'high' | 'medium' | 'low'

// CACHED — detect once, reuse forever (prevents WebGL context leak)
let _cachedTier: PerformanceTier | null = null
let _cachedWebGL: boolean | null = null

export function detectPerformanceTier(): PerformanceTier {
  if (_cachedTier !== null) return _cachedTier

  if (typeof navigator === 'undefined') {
    _cachedTier = 'low'
    return _cachedTier
  }

  const cores = navigator.hardwareConcurrency ?? 2
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')

  if (!gl) {
    _cachedTier = 'low'
  } else {
    // Explicitly lose the context to free it immediately
    const ext = gl.getExtension('WEBGL_lose_context')
    ext?.loseContext()

    if (cores >= 8) _cachedTier = 'high'
    else if (cores >= 4) _cachedTier = 'medium'
    else _cachedTier = 'low'
  }

  return _cachedTier
}

export function isWebGLAvailable(): boolean {
  if (_cachedWebGL !== null) return _cachedWebGL

  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (gl) {
      // Explicitly lose the context to free it immediately
      const ext = gl.getExtension('WEBGL_lose_context')
      ext?.loseContext()
      _cachedWebGL = true
    } else {
      _cachedWebGL = false
    }
  } catch {
    _cachedWebGL = false
  }

  return _cachedWebGL
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
