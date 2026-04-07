import { useState, useEffect } from 'react'
import { RefreshCw, Clock, CheckCircle2, XCircle, AlertTriangle, Layers, Activity } from 'lucide-react'
import AppLayout from '../components/AppLayout'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''
const API_SECRET  = import.meta.env.VITE_API_SECRET  ?? ''

interface QueueStats {
  outbound: Record<string, number>
  inbound:  Record<string, number>
  warmup:   Record<string, number>
  timestamp: string
}

interface QueueJob {
  id: string
  name: string
  data: { phone?: string; leadId?: string; message?: string }
  status: string
  createdAt: string
}

export default function QueueMonitor() {
  const [stats, setStats]     = useState<QueueStats | null>(null)
  const [jobs, setJobs]       = useState<QueueJob[]>([])
  const [activeQueue, setActiveQueue] = useState<'outbound' | 'inbound'>('outbound')
  const [loading, setLoading] = useState(true)

  const headers = { 'x-api-secret': API_SECRET }

  const fetchStats = async () => {
    setLoading(true)
    try {
      const [sRes, jRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/queue/stats`, { headers }),
        fetch(`${BACKEND_URL}/api/queue/jobs/${activeQueue}`, { headers }),
      ])
      if (sRes.ok) setStats(await sRes.json())
      if (jRes.ok) setJobs(await jRes.json())
    } catch { /* backend offline */ }
    setLoading(false)
  }

  useEffect(() => { fetchStats() }, [activeQueue])
  useEffect(() => {
    const id = setInterval(() => fetchStats(), 10_000) // atualiza a cada 10s
    return () => clearInterval(id)
  }, [activeQueue])

  const queueCard = (name: string, data: Record<string, number>, color: string) => (
    <div className="card">
      <p className="section-title flex items-center gap-2 mb-3">
        <Layers size={14} style={{ color }} />{name}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {[
          { key: 'waiting',   label: 'Na fila',  icon: <Clock size={12} /> },
          { key: 'active',    label: 'Ativos',   icon: <Activity size={12} /> },
          { key: 'completed', label: 'Concluídos', icon: <CheckCircle2 size={12} /> },
          { key: 'failed',    label: 'Falhas',   icon: <XCircle size={12} /> },
          { key: 'delayed',   label: 'Adiados',  icon: <AlertTriangle size={12} /> },
        ].map(s => (
          <div key={s.key} className="text-center p-2 rounded-xl"
            style={{ background: 'var(--surface-hover)' }}>
            <div className="flex justify-center mb-0.5" style={{ color }}>{s.icon}</div>
            <p className="text-lg font-bold" style={{ color }}>{data[s.key] ?? 0}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <AppLayout title="Monitor de Filas 📊" subtitle="BullMQ + Redis — Outbound (8h–18h) · Inbound James (24h)">
      <div className="flex flex-col gap-4">
        {/* Stats por fila */}
        {loading && !stats ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : stats ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {queueCard('Outbound (Predador)', stats.outbound, '#f97316')}
            {queueCard('Inbound (James 24h)', stats.inbound,  'var(--accent)')}
            {queueCard('Warm-up (chips)',      stats.warmup,   '#a78bfa')}
          </div>
        ) : (
          <div className="card text-center py-12">
            <AlertTriangle size={32} className="mx-auto mb-2" style={{ color: '#dc2626' }} />
            <p className="font-semibold">Backend VPS offline</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Configure VITE_BACKEND_URL e suba o docker-compose.
            </p>
          </div>
        )}

        {/* Jobs recentes */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveQueue('outbound')}
                className="text-sm px-3 py-1.5 rounded-lg font-semibold"
                style={activeQueue === 'outbound'
                  ? { background: '#f97316', color: '#fff' }
                  : { color: 'var(--text-muted)' }}>
                Outbound
              </button>
              <button onClick={() => setActiveQueue('inbound')}
                className="text-sm px-3 py-1.5 rounded-lg font-semibold"
                style={activeQueue === 'inbound'
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { color: 'var(--text-muted)' }}>
                Inbound
              </button>
            </div>
            <button onClick={fetchStats} disabled={loading}
              className="btn-secondary gap-1 py-2 text-xs">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {jobs.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
              Nenhum job recente
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--surface-hover)' }}>
                    <th className="table-header">Job ID</th>
                    <th className="table-header">Lead / Telefone</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map(job => (
                    <tr key={job.id}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                      <td className="table-cell font-mono text-xs">{job.id}</td>
                      <td className="table-cell text-xs">{job.data.phone ?? job.data.leadId ?? '—'}</td>
                      <td className="table-cell">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          job.status === 'done' ? 'text-emerald-600' : 'text-amber-600'
                        }`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="table-cell text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(job.createdAt).toLocaleTimeString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
