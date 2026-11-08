interface WakeEvent { results: ArrayLike<ArrayLike<{ transcript?: string }>> }
export interface WakeRecognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: WakeEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; abort(): void; stop(): void;
}
interface Clock { schedule(callback: () => void, delay: number): unknown; cancel(handle: unknown): void }
const browserClock: Clock = {
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

// One owner, one recognizer, one restart timer. Retired callbacks never own a restart.
export function startJamesWakeListener(options: {
  createRecognition(): WakeRecognition;
  isCurrent(): boolean;
  shouldListen(): boolean;
  onWake(): void;
  clock?: Clock;
}) {
  const clock = options.clock ?? browserClock
  let disposed = false
  let suspended = false
  let active: WakeRecognition | null = null
  let timer: unknown = null
  let generation = 0
  function cancel(recognition: WakeRecognition) {
    recognition.onresult = null; recognition.onerror = null; recognition.onend = null
    try { recognition.abort() } catch { try { recognition.stop() } catch { /* already stopped */ } }
  }
  function suspend() {
    suspended = true; generation++
    if (timer !== null) clock.cancel(timer)
    timer = null
    const previous = active; active = null
    if (previous) cancel(previous)
  }
  function dispose() {
    if (disposed) return
    disposed = true
    suspend()
  }
  function resume() {
    if (disposed || !options.isCurrent() || !options.shouldListen()) return
    suspended = false
    if (!active) schedule(600)
  }
  function isActive(recognition: WakeRecognition) {
    if (!options.isCurrent()) { dispose(); return false }
    return !disposed && active === recognition
  }
  function schedule(delay: number) {
    if (disposed || suspended || timer !== null) return
    if (!options.isCurrent()) { dispose(); return }
    if (!options.shouldListen()) { suspend(); return }
    const scheduledGeneration = ++generation
    timer = clock.schedule(() => {
      if (disposed || generation !== scheduledGeneration) return
      timer = null
      listen()
    }, delay)
  }
  function retire(recognition: WakeRecognition, delay: number) {
    if (!isActive(recognition)) return
    active = null
    cancel(recognition)
    schedule(delay)
  }
  function listen() {
    if (disposed || suspended || active) return
    if (!options.isCurrent()) { dispose(); return }
    if (!options.shouldListen()) { suspend(); return }
    let recognition: WakeRecognition
    try { recognition = options.createRecognition() }
    catch { schedule(1500); return }
    active = recognition
    recognition.lang = 'pt-BR'; recognition.continuous = false; recognition.interimResults = false
    recognition.onresult = event => {
      if (!isActive(recognition)) return
      if (!options.shouldListen()) { suspend(); return }
      const heard = Array.from(event.results).map(result => result[0]?.transcript ?? '').join(' ').toLowerCase()
      if (heard.includes('james')) {
        retire(recognition, 500)
        if (!disposed && options.isCurrent()) options.onWake()
      }
    }
    recognition.onerror = () => retire(recognition, 1200)
    recognition.onend = () => retire(recognition, 500)
    try { recognition.start() }
    catch { retire(recognition, 1500) }
  }
  schedule(600)
  return Object.assign(dispose, { suspend, resume })
}
