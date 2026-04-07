// ════════════════════════════════════════════════════════════════════════════
// JamesVoiceBridge.ts — Ponte entre NucleoState (James.tsx) e JamesCoreState
// NÃO duplica lógica de voz. Apenas consome estado externo.
// ════════════════════════════════════════════════════════════════════════════
import type { JamesCoreState } from './jamesSceneConfig'

// NucleoState from James.tsx
type NucleoState =
  | 'nucleus'
  | 'opening'
  | 'active'
  | 'listening'
  | 'waiting'
  | 'speaking'
  | 'thinking'
  | 'closing'

const STATE_MAP: Record<NucleoState, JamesCoreState> = {
  nucleus:   'idle_dark',
  opening:   'vault_opening',
  active:    'emergence_ready',
  listening: 'listening',
  waiting:   'emergence_ready',
  speaking:  'speaking',
  thinking:  'processing',
  closing:   'sleeping',
}

export function nucleoToCore(nucleoState: NucleoState): JamesCoreState {
  return STATE_MAP[nucleoState] ?? 'idle_dark'
}

export type { NucleoState }
