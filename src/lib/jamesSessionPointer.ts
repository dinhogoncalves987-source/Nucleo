export type MemoryMode = 'loading' | 'disabled' | 'persistent'
export function assertMemoryMode(saved: string | null, mode: 'disabled' | 'persistent') {
  // Keep the guard for genuine persistent sessions when the server is disabled.
  if (saved && mode === 'disabled') throw new Error('persistent memory disabled')
}
export function rememberSession(storage: Pick<Storage, 'setItem'>, key: string, id: string, mode: MemoryMode) {
  // Temporary sessions must never survive reload as persistent session pointers.
  if (mode !== 'persistent') return
  try { storage.setItem(key, id) } catch { /* recovery after reload unavailable */ }
}
