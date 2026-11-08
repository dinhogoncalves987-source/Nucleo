export function createJamesVoiceContext() {
  let key = ''
  let epoch = 0
  return {
    bind(next: string) { if (next !== key) { key = next; epoch++ } },
    invalidate() { epoch++ },
    snapshot() { return epoch },
    current(origin: number) { return origin === epoch },
  }
}
export function advanceJamesVoiceContext(context: ReturnType<typeof createJamesVoiceContext>, requestRender: () => void) {
  context.invalidate()
  // Ref mutation alone does not refresh callbacks when all other state is unchanged.
  requestRender()
}
export interface CancellableRecognition {
  onresult: unknown; onerror: unknown; onend: unknown;
  abort(): void; stop(): void;
}
export function cancelJamesRecognition(recognition: CancellableRecognition | null) {
  if (!recognition) return
  // Clear handlers first: abort/stop can synchronously dispatch an event.
  recognition.onresult = null; recognition.onerror = null; recognition.onend = null
  try { recognition.abort() } catch { try { recognition.stop() } catch { /* already stopped */ } }
}
export function voiceCallbackIsCurrent(
  context: ReturnType<typeof createJamesVoiceContext>, origin: number,
  recognition: object, activeRecognition: object | null,
) {
  return context.current(origin) && recognition === activeRecognition
}
