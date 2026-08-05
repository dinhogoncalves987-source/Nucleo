import { useState, useEffect } from 'react'
import { MessageCircle, Search, Phone, Clock, CheckCircle2, AlertCircle } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/tenant-context'
import { supabase } from '../lib/supabase'

interface Conversa {
  id: string
  client_name: string
  client_phone: string
  last_message: string
  last_at: string
  status: 'ativa' | 'resolvida' | 'pendente'
  lead_status: string
}

const STATUS_COLORS = {
  ativa:     { dot: '#10b981', label: 'Ativa' },
  pendente:  { dot: '#f59e0b', label: 'Pendente' },
  resolvida: { dot: '#6b7280', label: 'Resolvida' },
}

export default function Atendimento() {
  const { tenant } = useTenant()
  const [conversas, setConversas] = useState<Conversa[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'todas' | 'ativa' | 'pendente'>('todas')

  useEffect(() => { if (tenant?.id) fetchData() }, [tenant])

  const fetchData = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('leads')
      .select('id, name, phone, status, created_at')
      .eq('tenant_id', tenant!.id)
      .in('status', ['new', 'contacted', 'qualified'])
      .order('created_at', { ascending: false })
      .limit(50)

    const mapped: Conversa[] = (data ?? []).map(l => ({
      id: l.id,
      client_name: l.name ?? 'Cliente',
      client_phone: l.phone,
      last_message: l.status === 'new' ? 'Aguardando primeiro contato'
        : l.status === 'contacted' ? 'Conversa em andamento'
        : 'Qualificado — pronto para agendamento',
      last_at: l.created_at,
      status: l.status === 'new' ? 'pendente' : 'ativa',
      lead_status: l.status,
    }))
    setConversas(mapped)
    setLoading(false)
  }

  const filtered = conversas.filter(c => {
    const matchSearch = c.client_name.toLowerCase().includes(search.toLowerCase()) ||
      c.client_phone.includes(search)
    const matchFilter = filter === 'todas' || c.status === filter
    return matchSearch && matchFilter
  })

  const ativas = conversas.filter(c => c.status === 'ativa').length
  const pendentes = conversas.filter(c => c.status === 'pendente').length

  const filterBtn = (f: typeof filter, label: string, count: number) => (
    <button onClick={() => setFilter(f)}
      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
      style={{
        background: filter === f ? 'var(--accent-muted)' : 'transparent',
        color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
        border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
      }}>
      {label} ({count})
    </button>
  )

  return (
    <AppLayout title="Atendimento" subtitle="Conversas e suporte via WhatsApp">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Total', value: String(conversas.length), color: 'var(--accent)', icon: MessageCircle },
          { label: 'Ativas', value: String(ativas), color: '#10b981', icon: CheckCircle2 },
          { label: 'Pendentes', value: String(pendentes), color: '#f59e0b', icon: AlertCircle },
        ].map(k => (
          <div key={k.label} className="card">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
              <k.icon size={14} style={{ color: k.color, opacity: 0.6 }} />
            </div>
            <p className="text-2xl font-bold" style={{ color: k.color }}>{loading ? '—' : k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input type="text" placeholder="Buscar por nome ou telefone..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border)', color: 'var(--text-main)' }}
          />
        </div>
        <div className="flex gap-2">
          {filterBtn('todas', 'Todas', conversas.length)}
          {filterBtn('ativa', 'Ativas', ativas)}
          {filterBtn('pendente', 'Pendentes', pendentes)}
        </div>
      </div>

      {/* Conversations list */}
      <div className="flex flex-col gap-2">
        {loading ? (
          <div className="card text-center py-12" style={{ color: 'var(--text-muted)' }}>Carregando conversas...</div>
        ) : filtered.length === 0 ? (
          <div className="card text-center py-16" style={{ color: 'var(--text-muted)' }}>
            <MessageCircle size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium mb-1">Nenhuma conversa encontrada</p>
            <p className="text-xs">As conversas do WhatsApp aparecerão aqui quando o James estiver ativo.</p>
          </div>
        ) : filtered.map(conv => {
          const stColor = STATUS_COLORS[conv.status] ?? STATUS_COLORS.pendente
          return (
            <div key={conv.id} className="card flex items-center gap-4 transition-all cursor-pointer"
              style={{ padding: '14px 16px' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.transform = 'translateX(2px)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateX(0)' }}>
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                {conv.client_name.charAt(0).toUpperCase()}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-main)' }}>{conv.client_name}</p>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: stColor.dot }} />
                  <span className="text-[10px]" style={{ color: stColor.dot }}>{stColor.label}</span>
                </div>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{conv.last_message}</p>
              </div>
              {/* Meta */}
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <Phone size={11} />{conv.client_phone}
                </span>
                <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <Clock size={10} />{new Date(conv.last_at).toLocaleDateString('pt-BR')}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </AppLayout>
  )
}
