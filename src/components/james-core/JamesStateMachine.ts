// ════════════════════════════════════════════════════════════════════════════
// JamesStateMachine.ts — Estado global da experiência James 3D
// ════════════════════════════════════════════════════════════════════════════
import type { JamesCoreState } from './jamesSceneConfig'

type TransitionMap = Partial<Record<JamesCoreState, JamesCoreState[]>>

// ── Valid transitions ─────────────────────────────────────────────────────
const TRANSITIONS: TransitionMap = {
  idle_dark:        ['eyes_half_awake', 'sleeping'],
  eyes_half_awake:  ['vault_opening', 'idle_dark', 'sleeping'],
  vault_opening:    ['eyes_full_power', 'idle_dark'],
  eyes_full_power:  ['emergence_ready', 'idle_dark'],
  emergence_ready:  ['listening', 'processing', 'speaking', 'sleeping', 'idle_dark', 'alert'],
  listening:        ['processing', 'emergence_ready', 'sleeping', 'alert'],
  processing:       ['speaking', 'emergence_ready', 'listening', 'sleeping', 'alert'],
  speaking:         ['emergence_ready', 'listening', 'processing', 'sleeping', 'alert'],
  sleeping:         ['idle_dark', 'eyes_half_awake'],
  alert:            ['emergence_ready', 'listening', 'processing', 'idle_dark', 'sleeping'],
}

export type StateListener = (state: JamesCoreState, prev: JamesCoreState) => void

export class JamesStateMachine {
  private _state: JamesCoreState = 'idle_dark'
  private _listeners: Set<StateListener> = new Set()

  get state(): JamesCoreState { return this._state }

  canTransitionTo(next: JamesCoreState): boolean {
    const allowed = TRANSITIONS[this._state]
    return !!allowed && allowed.includes(next)
  }

  transition(next: JamesCoreState, force = false): boolean {
    if (next === this._state) return true
    if (!force && !this.canTransitionTo(next)) {
      if (import.meta.env.DEV) {
        console.warn(`[JAMES-SM] Blocked: ${this._state} → ${next}`)
      }
      return false
    }
    const prev = this._state
    this._state = next
    this._listeners.forEach(fn => fn(next, prev))
    if (import.meta.env.DEV) {
      console.log(`[JAMES-SM] ${prev} → ${next}`)
    }
    return true
  }

  forceState(state: JamesCoreState): void {
    this.transition(state, true)
  }

  subscribe(listener: StateListener): () => void {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  }

  reset(): void {
    this.forceState('idle_dark')
  }
}

// Singleton
export const jamesStateMachine = new JamesStateMachine()
