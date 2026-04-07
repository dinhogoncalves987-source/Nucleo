import { useState, useEffect } from 'react'
import {
  Wifi, WifiOff, AlertTriangle, Flame, Thermometer,
  RefreshCw, Plus, QrCode, Zap, ShieldCheck,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'

// URL do backend VPS (configurada em .env.local como VITE_BACKEND_URL)
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''
const API_SECRET  = import.meta.env.VITE_API_SECRET  ?? ''

interface Chip {
  id: string
  name: string
  status: 'active' | 'connecting' | 'banned' | 'warming' | 'paused'
  warmup_day: number
  phone: string
  messages_sent_today: number
}

function StatusBadge({ status }: { status: Chip['status'] }) {
  const map = {
    active:     { label: 'Ativo',       color: '#10b981', bg: 'rgba(16,185,129,0.1)',  icon: <Wifi size={11} /> },
    connecting: { label: 'Conectando',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  icon: <RefreshCw size={11} className="animate-spin" /> },
    banned:     { label: 'Banido',      color: '#dc2626', bg: 'rgba(220,38,38,0.1)',   icon: <WifiOff size={11} /> },
    warming:    { label: 'Aquecendo',   color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', icon: <Thermometer size={11} /> },
    paused:     { label: 'Pausado',     color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: <WifiOff size={11} /> },
  }
  const s = map[status]
  return (
    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
      style={{ background: s.bg, color: s.color }}>
      {s.icon} {s.label}
    </span>
  )
}

export default function ChipsMonitor() {
  const [chips, setChips] = useState<Chip[]>([])
  const [loading, setLoading] = useState(true)
  const [schedulerStatus, setSchedulerStatus] = useState<Record<string, unknown>>({})
  const [backendOnline, setBackendOnline] = useState(false)

  const headers = { 'x-api-secret': API_SECRET, 'Content-Type': 'application/json' }

  const fetchData = async () => {
    setLoading(true)
    try {
      const [chipsRes, schedRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/chips`, { headers }),
        fetch(`${BACKEND_URL}/api/scheduler/status`, { headers }),
      ])
      if (chipsRes.ok) {
        const data = await chipsRes.json()
        setChips(data.chips ?? [])
        setBackendOnline(true)
      }
      if (schedRes.ok) setSchedulerStatus(await schedRes.json())
    } catch {
      setBackendOnline(false)
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])
  useEffect(() => {
    const id = setInterval(fetchData, 30_000) // atualiza a cada 30s
    return () => clearInterval(id)
  }, [])

  const stats = {
    total:   chips.length,
    active:  chips.filter(c => c.status === 'active').length,
    warming: chips.filter(c => c.status === 'warming').length,
    banned:  chips.filter(c => c.status === 'banned').length,
  }

  return (
    <AppLayout title="Monitor de Chips 📡" subtitle="100 instâncias WhatsApp — status em tempo real">
      {/* Backend offline banner */}
      {!backendOnline && !loading && (
        <div className="card mb-4 flex items-center gap-3" style={{ borderColor: '#dc2626', background: 'rgba(220,38,38,0.07)' }}>
          <AlertTriangle size={18} style={{ color: '#dc2626' }} />
          <div>
            <p className="font-semibold text-sm" style={{ color: '#dc2626' }}>Backend VPS offline</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Configure VITE_BACKEND_URL no .env.local e suba o docker-compose na VPS.
            </p>
          </div>
        </div>
      )}

      {/* Scheduler status */}
      <div className="card mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            {schedulerStatus.is_active
              ? <Flame size={16} style={{ color: '#f97316' }} />
              : <ShieldCheck size={16} style={{ color: '#6b7280' }} />}
            <span className="text-sm font-semibold">
              Outbound: {schedulerStatus.is_active ? '🟢 Ativo' : '🔴 Pausado'}
            </span>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {String(schedulerStatus.operating_hours ?? '08:00 – 18:00')}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
            James 24h ativo
          </span>
          <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
            {String(schedulerStatus.next_action ?? '')}
          </span>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total Chips', value: stats.total,   color: 'var(--accent)',  icon: <Zap size={16} /> },
          { label: 'Ativos',      value: stats.active,  color: '#10b981',        icon: <Wifi size={16} /> },
          { label: 'Aquecendo',   value: stats.warming, color: '#a78bfa',        icon: <Thermometer size={16} /> },
          { label: 'Banidos',     value: stats.banned,  color: '#dc2626',        icon: <WifiOff size={16} /> },
        ].map(s => (
          <div key={s.label} className="card text-center">
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Chips grid */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <p className="section-title">Instâncias</p>
          <button onClick={fetchData} disabled={loading} className="btn-secondary gap-2 py-2 text-xs">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : chips.length === 0 ? (
          <div className="text-center py-12">
            <QrCode size={40} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="font-semibold mb-1">Nenhum chip conectado</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Suba o docker-compose na VPS e escaneie os QR codes.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {chips.map(chip => (
              <div key={chip.id} className="p-3 rounded-xl text-center"
                style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                <p className="text-xs font-mono font-bold mb-1" style={{ color: 'var(--text-main)' }}>
                  {chip.id}
                </p>
                <StatusBadge status={chip.status} />
                {chip.phone && (
                  <p className="text-xs mt-1 font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                    +55 {chip.phone}
                  </p>
                )}
                {chip.warmup_day > 0 && (
                  <p className="text-xs mt-0.5" style={{ color: '#a78bfa' }}>
                    Warm-up dia {chip.warmup_day}/7
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
