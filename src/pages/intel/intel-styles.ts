// ── Shared Styles ─────────────────────────────────────────────────────────
export const INTEL_CSS = `
  @keyframes cc-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }
  @keyframes cc-blink { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes cc-slide { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  .cc-row:hover { background:rgba(0,180,255,0.04)!important; }
  .cc-btn { transition:all 0.15s; }
  .cc-btn:hover { filter:brightness(1.3); }
`

export const colStyle = {
  background: 'rgba(0,10,24,0.7)', border: '1px solid rgba(0,180,255,0.1)',
  borderRadius: 10, display: 'flex' as const, flexDirection: 'column' as const,
  overflow: 'hidden' as const,
}
export const secHeadStyle = {
  padding: '8px 14px', borderBottom: '1px solid rgba(0,180,255,0.1)',
  background: 'rgba(0,20,50,0.5)', display: 'flex' as const, alignItems: 'center' as const, gap: 8,
}
export function tabBtnStyle(active: boolean) {
  return {
    padding: '4px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer' as const,
    border: `1px solid ${active ? 'rgba(0,180,255,0.5)' : 'rgba(255,255,255,0.06)'}`,
    background: active ? 'rgba(0,180,255,0.12)' : 'transparent',
    color: active ? '#00B4FF' : 'rgba(120,160,200,0.5)', transition: 'all 0.2s',
  }
}
