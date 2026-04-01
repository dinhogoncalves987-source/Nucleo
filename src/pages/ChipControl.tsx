// ═══════════════════════════════════════════════════════════
// ChipControl.tsx — /chip-control
// Integrado no layout do Núcleo via AppLayout
// ═══════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useRef } from 'react'
import AppLayout from '../components/AppLayout'
import { supabase } from '../lib/supabase'

// ── Types ─────────────────────────────────────────────────────
type ChipStatus = 'active' | 'alert' | 'paused' | 'critical'

interface Chip {
  id: string
  name: string
  status: ChipStatus
  messages_used: number
  messages_limit: number
  temperature_level: number
  last_activity: string
}

// ── Status config ─────────────────────────────────────────────
const STATUS_META: Record<ChipStatus, { label: string; dot: string; badge: string }> = {
  active:   { label: 'Ativo',   dot: 'bg-emerald-400 shadow-[0_0_6px_#34d399]',  badge: 'bg-emerald-900/40 text-emerald-300 border-emerald-600/30' },
  alert:    { label: 'Alerta',  dot: 'bg-amber-400 shadow-[0_0_6px_#fbbf24]',    badge: 'bg-amber-900/40 text-amber-300 border-amber-600/30' },
  paused:   { label: 'Pausado', dot: 'bg-slate-500',                              badge: 'bg-slate-800/60 text-slate-400 border-slate-600/30' },
  critical: { label: 'Crítico', dot: 'bg-red-500 shadow-[0_0_6px_#f87171] animate-pulse', badge: 'bg-red-900/40 text-red-300 border-red-600/30' },
}

// ── Helpers ───────────────────────────────────────────────────
function pct(used: number, limit: number) { return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0 }

function UsageBar({ value }: { value: number }) {
  const color = value >= 90 ? 'from-red-600 to-red-500' : value >= 70 ? 'from-amber-500 to-yellow-400' : 'from-cyan-600 to-blue-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-hover)' }}>
        <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-500`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold min-w-[2.5rem] text-right
        ${value >= 90 ? 'text-red-400' : value >= 70 ? 'text-amber-400' : 'text-cyan-400'}`}>{value}%</span>
    </div>
  )
}

function SummaryCard({ label, value, icon, sub }: { label: string; value: string | number; icon: string; sub?: string }) {
  return (
    <div className="rounded-xl p-5 flex flex-col gap-1" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="text-base">{icon}</span>
      </div>
      <span className="text-2xl font-black" style={{ color: 'var(--text-main)' }}>{value}</span>
      {sub && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
    </div>
  )
}

function Toast({ msg, type }: { msg: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border text-sm font-medium
      ${type === 'success' ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-300' : 'bg-red-900/90 border-red-500/40 text-red-300'}`}>
      {type === 'success' ? '✅' : '❌'} {msg}
    </div>
  )
}

// ── Mock seed ─────────────────────────────────────────────────
// MOCK: fallback temporario para exibir a tela sem depender de chips reais cadastrados no banco
const MOCK_CHIPS: Omit<Chip, 'id'>[] = [
  { name: 'Chip Alpha-01',   status: 'active',   messages_used: 3200, messages_limit: 5000, temperature_level: 38, last_activity: new Date().toISOString() },
  { name: 'Chip Beta-04',    status: 'alert',    messages_used: 4600, messages_limit: 5000, temperature_level: 72, last_activity: new Date(Date.now() - 60000).toISOString() },
  { name: 'Chip Gamma-07',   status: 'active',   messages_used: 1800, messages_limit: 5000, temperature_level: 41, last_activity: new Date(Date.now() - 180000).toISOString() },
  { name: 'Chip Delta-12',   status: 'paused',   messages_used: 5000, messages_limit: 5000, temperature_level: 55, last_activity: new Date(Date.now() - 3600000).toISOString() },
  { name: 'Chip Epsilon-03', status: 'critical', messages_used: 4980, messages_limit: 5000, temperature_level: 89, last_activity: new Date(Date.now() - 120000).toISOString() },
  { name: 'Chip Zeta-08',    status: 'active',   messages_used: 2100, messages_limit: 5000, temperature_level: 44, last_activity: new Date(Date.now() - 900000).toISOString() },
]

function fmt(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)   return `${diff}s atrás`
  if (diff < 3600) return `${Math.floor(diff / 60)}m atrás`
  return `${Math.floor(diff / 3600)}h atrás`
}

// ── Main ─────────────────────────────────────────────────────
export default function ChipControl() {
  const [chips,    setChips]    = useState<Chip[]>([])
  const [loading,  setLoading]  = useState(true)
  const [toast,    setToast]    = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [filter,   setFilter]   = useState<ChipStatus | 'all'>('all')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000)
  }

  const fetchChips = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data, error } = await supabase.from('chips').select('*').order('last_activity', { ascending: false })
    setChips((!error && data && data.length > 0) ? data as Chip[] : MOCK_CHIPS.map((c, i) => ({ ...c, id: `mock-${i}` })))
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchChips()
    intervalRef.current = setInterval(() => fetchChips(true), 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchChips])

  const updateStatus = async (chip: Chip, newStatus: ChipStatus) => {
    setActingId(chip.id)
    if (chip.id.startsWith('mock-')) {
      setChips(cs => cs.map(c => c.id === chip.id ? { ...c, status: newStatus } : c))
    } else {
      const { error } = await supabase.from('chips').update({ status: newStatus }).eq('id', chip.id)
      if (error) { showToast(error.message, 'error'); setActingId(null); return }
      fetchChips(true)
    }
    showToast(`${chip.name} → ${newStatus}`); setActingId(null)
  }

  const resetUsage = async (chip: Chip) => {
    setActingId(chip.id)
    if (chip.id.startsWith('mock-')) {
      setChips(cs => cs.map(c => c.id === chip.id ? { ...c, messages_used: 0 } : c))
    } else {
      const { error } = await supabase.from('chips').update({ messages_used: 0 }).eq('id', chip.id)
      if (error) { showToast(error.message, 'error'); setActingId(null); return }
      fetchChips(true)
    }
    showToast(`Uso de ${chip.name} resetado`); setActingId(null)
  }

  // ── Derived ───────────────────────────────────────────────
  const active   = chips.filter(c => c.status === 'active').length
  const alert    = chips.filter(c => c.status === 'alert').length
  const paused   = chips.filter(c => c.status === 'paused').length
  const critical = chips.filter(c => c.status === 'critical').length
  const totalUsed  = chips.reduce((a, c) => a + c.messages_used, 0)
  const totalLimit = chips.reduce((a, c) => a + c.messages_limit, 0)
  const globalPct  = pct(totalUsed, totalLimit)
  const filtered   = filter === 'all' ? chips : chips.filter(c => c.status === filter)

  return (
    <AppLayout title="Chip Control Center" subtitle="Monitoramento em tempo real dos chips operacionais">
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Chips ativos" value={active}         icon="🟢" />
        <SummaryCard label="Em alerta"    value={alert}          icon="🟡" />
        <SummaryCard label="Pausados"     value={paused}         icon="⚫" />
        <SummaryCard label="Uso total"    value={`${globalPct}%`} icon="📊"
          sub={`${totalUsed.toLocaleString()} / ${totalLimit.toLocaleString()} msgs`} />
      </div>

      {/* ── Global bar ── */}
      <div className="rounded-xl px-5 py-4 mb-6 flex items-center gap-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
        <span className="text-xs uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Capacidade total</span>
        <div className="flex-1"><UsageBar value={globalPct} /></div>
        <button onClick={() => fetchChips()} className="text-xs transition-colors ml-2" style={{ color: 'var(--accent)' }}>
          {loading ? '⏳' : '↻ Sync'}
        </button>
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', 'active', 'alert', 'critical', 'paused'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-all capitalize"
            style={{
              background: filter === f ? 'var(--accent-muted)' : 'transparent',
              color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
            }}>
            {f === 'all' ? `Todos (${chips.length})` :
             f === 'active'   ? `Ativos (${active})` :
             f === 'alert'    ? `Alerta (${alert})` :
             f === 'critical' ? `Crítico (${critical})` : `Pausados (${paused})`}
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {loading ? (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)', background: 'var(--surface-card)' }}>Carregando chips...</div>
        ) : (
          <table className="w-full text-sm" style={{ background: 'var(--surface-card)' }}>
            <thead>
              <tr className="text-xs uppercase tracking-wider" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <th className="text-left px-5 py-3">Nome</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Uso</th>
                <th className="text-left px-5 py-3 hidden lg:table-cell">Temp.</th>
                <th className="text-left px-5 py-3 hidden lg:table-cell">Atividade</th>
                <th className="text-right px-5 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(chip => {
                const p   = pct(chip.messages_used, chip.messages_limit)
                const s   = STATUS_META[chip.status]
                const busy = actingId === chip.id
                return (
                  <tr key={chip.id} className="group transition-colors" style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                        <span className="text-xs font-medium" style={{ color: 'var(--text-main)' }}>{chip.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${s.badge}`}>{s.label}</span>
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell min-w-[140px]">
                      <div className="space-y-1">
                        <UsageBar value={p} />
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {chip.messages_used.toLocaleString()} / {chip.messages_limit.toLocaleString()}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 hidden lg:table-cell">
                      <span className={`text-xs font-mono font-bold
                        ${chip.temperature_level >= 80 ? 'text-red-400' : chip.temperature_level >= 60 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {chip.temperature_level}°C
                      </span>
                    </td>
                    <td className="px-5 py-4 hidden lg:table-cell">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(chip.last_activity)}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {chip.status !== 'paused' ? (
                          <button disabled={busy} onClick={() => updateStatus(chip, 'paused')}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 transition-colors disabled:opacity-30">
                            ⏸ Pausar
                          </button>
                        ) : (
                          <button disabled={busy} onClick={() => updateStatus(chip, 'active')}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-900/40 text-emerald-300 hover:bg-emerald-800/50 transition-colors disabled:opacity-30">
                            ▶ Reativar
                          </button>
                        )}
                        <button disabled={busy} onClick={() => resetUsage(chip)}
                          className="text-[11px] px-2.5 py-1 rounded-lg bg-blue-900/40 text-blue-300 hover:bg-blue-800/50 transition-colors disabled:opacity-30">
                          {busy ? '⏳' : '↺ Reset'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>Nenhum chip nesta categoria.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-xs text-right" style={{ color: 'var(--text-muted)' }}>Atualiza automaticamente a cada 30s</p>
    </AppLayout>
  )
}
