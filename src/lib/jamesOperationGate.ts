// Synchronous admission, independent of React batching. Tokens bind late responses
// to the exact context/session operation that initiated them.
export function createJamesOperationGate() {
  let scope = ''
  let generation = 0
  let active: number | null = null
  return {
    bind(key: string) { if (scope !== key) { scope = key; generation++; active = null } },
    invalidate() { generation++; active = null },
    begin() { if (active !== null) return null; active = ++generation; return active },
    current(token: number) { return active === token },
    finish(token: number) { if (active === token) active = null },
  }
}
