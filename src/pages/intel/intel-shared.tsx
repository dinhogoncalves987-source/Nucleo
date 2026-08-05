// ════════════════════════════════════════════════════════════════════════════
// intel-shared.tsx — Types, mocks, component primitives for Intel System
// ════════════════════════════════════════════════════════════════════════════
import { useNavigate } from 'react-router-dom'
import { secHeadStyle } from './intel-styles'

// ── Shared Components ─────────────────────────────────────────────────────
export function KpiCard({ label, value, sub, color = '#00B4FF', pulse }: {
  label: string; value: string | number; sub?: string; color?: string; pulse?: boolean
}) {
  return (
    <div style={{
      background: 'rgba(0,20,40,0.6)', border: '1px solid rgba(0,180,255,0.12)',
      borderRadius: 8, padding: '10px 14px', minWidth: 100, position: 'relative',
      backdropFilter: 'blur(4px)', flex: '1 1 120px',
    }}>
      {pulse && <span style={{
        position: 'absolute', top: 6, right: 8, width: 6, height: 6, borderRadius: '50%',
        background: color, boxShadow: `0 0 6px ${color}`,
        animation: 'cc-pulse 1.5s ease-in-out infinite',
      }}/>}
      <div style={{ fontSize: 10, color: 'rgba(120,160,200,0.7)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'rgba(100,140,180,0.5)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function Badge({ text, color = '#00B4FF' }: { text: string; color?: string }) {
  return (
    <span style={{
      fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.1em',
      color, border: `1px solid ${color}40`, borderRadius: 3,
      padding: '1px 5px', textTransform: 'uppercase',
    }}>{text}</span>
  )
}

export function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 4, transition: 'width 0.5s' }}/>
    </div>
  )
}

export function BackButton({ to, label = 'Voltar' }: { to: string; label?: string }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(to)}
      className="cc-btn"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, padding: '6px 14px', borderRadius: 8,
        border: '1px solid rgba(0,180,255,0.2)', background: 'rgba(0,180,255,0.06)',
        color: '#00B4FF', cursor: 'pointer', marginBottom: 16,
      }}
    >
      ← {label}
    </button>
  )
}

export function SectionHeader({ title, color = '#00B4FF', children }: {
  title: string; color?: string; children?: React.ReactNode
}) {
  return (
    <div style={secHeadStyle}>
      <span style={{ fontSize: 10, color, letterSpacing: '0.15em' }}>{title}</span>
      {children && <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>{children}</div>}
    </div>
  )
}
