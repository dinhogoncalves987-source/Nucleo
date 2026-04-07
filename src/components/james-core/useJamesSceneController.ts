// ════════════════════════════════════════════════════════════════════════════
// useJamesSceneController.ts — Hook controlador público do James Nucleus
// Orquestra GSAP timeline + state machine + nucleus intensity
// Fase 2: sem vault — controla intensidade do núcleo
// ════════════════════════════════════════════════════════════════════════════
import { useState, useCallback, useRef, useEffect } from 'react'
import gsap from 'gsap'
import { jamesStateMachine } from './JamesStateMachine'
import { nucleoToCore, type NucleoState } from './JamesVoiceBridge'
import {
  BOOT_TIMING, NUCLEUS_INTENSITY,
  prefersReducedMotion,
  type JamesCoreState,
} from './jamesSceneConfig'

export interface JamesSceneController {
  state: JamesCoreState
  nucleusIntensity: number
  openJamesCore: () => void
  closeJamesCore: () => void
  setJamesState: (s: JamesCoreState) => void
  minimizeJames: () => void
  expandJames: () => void
  syncVoiceState: (nucleoState: NucleoState) => void
  playBootSequence: () => void
  stopBootSequence: () => void
}

export function useJamesSceneController(): JamesSceneController {
  const [state, setState] = useState<JamesCoreState>('idle_dark')
  const [nucleusIntensity, setNucleusIntensity] = useState(0.5)
  const timelineRef = useRef<gsap.core.Timeline | null>(null)
  const intensityRef = useRef({ value: 0.5 })
  const reduced = prefersReducedMotion()
  const speedMultiplier = reduced ? 0.4 : 1

  // Subscribe to state machine
  useEffect(() => {
    const unsub = jamesStateMachine.subscribe((newState) => {
      setState(newState)
      // Auto-update intensity target based on state
      const targetI = NUCLEUS_INTENSITY[newState]
      gsap.to(intensityRef.current, {
        value: targetI,
        duration: 0.8,
        ease: 'power2.inOut',
        onUpdate: () => setNucleusIntensity(intensityRef.current.value),
      })
    })
    return unsub
  }, [])

  // Kill timeline on unmount
  useEffect(() => {
    return () => { timelineRef.current?.kill() }
  }, [])

  const playBootSequence = useCallback(() => {
    timelineRef.current?.kill()
    intensityRef.current.value = 0.05
    setNucleusIntensity(0.05)

    const tl = gsap.timeline({
      onComplete: () => {
        jamesStateMachine.forceState('emergence_ready')
      },
    })

    // Phase 1: Fade in from dark
    tl.call(() => jamesStateMachine.forceState('idle_dark'), [], 0)
    tl.to(intensityRef.current, {
      value: 0.3,
      duration: BOOT_TIMING.fadeIn.duration * speedMultiplier,
      ease: BOOT_TIMING.fadeIn.ease,
      onUpdate: () => setNucleusIntensity(intensityRef.current.value),
    }, 0)

    // Phase 2: Eyes half awake — rings start
    const p2 = BOOT_TIMING.fadeIn.duration * speedMultiplier
    tl.call(() => jamesStateMachine.forceState('eyes_half_awake'), [], p2)
    tl.to(intensityRef.current, {
      value: 0.55,
      duration: BOOT_TIMING.ringsUp.duration * speedMultiplier,
      ease: BOOT_TIMING.ringsUp.ease,
      onUpdate: () => setNucleusIntensity(intensityRef.current.value),
    }, p2)

    // Phase 3: Core glow surge
    const p3 = p2 + BOOT_TIMING.ringsUp.duration * speedMultiplier
    tl.call(() => jamesStateMachine.forceState('eyes_full_power'), [], p3)
    tl.to(intensityRef.current, {
      value: 0.85,
      duration: BOOT_TIMING.coreGlow.duration * speedMultiplier,
      ease: BOOT_TIMING.coreGlow.ease,
      onUpdate: () => setNucleusIntensity(intensityRef.current.value),
    }, p3)

    // Phase 4: HUD fades in, settle to ready
    const p4 = p3 + BOOT_TIMING.coreGlow.duration * speedMultiplier
    tl.to(intensityRef.current, {
      value: NUCLEUS_INTENSITY.emergence_ready,
      duration: BOOT_TIMING.hudFade.duration * speedMultiplier,
      ease: BOOT_TIMING.hudFade.ease,
      onUpdate: () => setNucleusIntensity(intensityRef.current.value),
    }, p4)

    timelineRef.current = tl
  }, [speedMultiplier])

  const stopBootSequence = useCallback(() => {
    timelineRef.current?.kill()
  }, [])

  const openJamesCore = useCallback(() => {
    playBootSequence()
  }, [playBootSequence])

  const closeJamesCore = useCallback(() => {
    timelineRef.current?.kill()

    const tl = gsap.timeline({
      onComplete: () => {
        jamesStateMachine.forceState('idle_dark')
      },
    })

    tl.call(() => jamesStateMachine.forceState('sleeping'), [], 0)
    tl.to(intensityRef.current, {
      value: NUCLEUS_INTENSITY.idle_dark,
      duration: 1.0 * speedMultiplier,
      ease: 'power2.inOut',
      onUpdate: () => setNucleusIntensity(intensityRef.current.value),
    }, 0.1)

    timelineRef.current = tl
  }, [speedMultiplier])

  const setJamesState = useCallback((s: JamesCoreState) => {
    jamesStateMachine.forceState(s)
  }, [])

  const minimizeJames = useCallback(() => {
    closeJamesCore()
  }, [closeJamesCore])

  const expandJames = useCallback(() => {
    if (state === 'sleeping' || state === 'idle_dark') {
      openJamesCore()
    }
  }, [state, openJamesCore])

  const syncVoiceState = useCallback((nucleoState: NucleoState) => {
    const coreState = nucleoToCore(nucleoState)

    // If boot is needed, play boot sequence
    if (nucleoState === 'opening') {
      playBootSequence()
      return
    }
    if (nucleoState === 'closing') {
      closeJamesCore()
      return
    }

    // For active states, ensure nucleus is powered up
    if (['active', 'listening', 'speaking', 'thinking', 'waiting'].includes(nucleoState)) {
      if (intensityRef.current.value < 0.4) {
        playBootSequence()
        setTimeout(() => jamesStateMachine.forceState(coreState), 3200)
        return
      }
    }

    jamesStateMachine.forceState(coreState)
  }, [playBootSequence, closeJamesCore])

  return {
    state,
    nucleusIntensity,
    openJamesCore,
    closeJamesCore,
    setJamesState,
    minimizeJames,
    expandJames,
    syncVoiceState,
    playBootSequence,
    stopBootSequence,
  }
}
