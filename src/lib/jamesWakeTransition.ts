// Execute suspension synchronously, before React renders or command recognition starts.
export function transitionJamesWakeState(
  next: string,
  wake: { suspend(): void; resume(): void } | null,
  commit: () => void,
) {
  if (next !== 'nucleus') wake?.suspend()
  commit()
  if (next === 'nucleus') wake?.resume()
}
