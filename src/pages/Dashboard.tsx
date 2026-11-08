import { useState, useEffect, useCallback, useRef } from 'react'
import {
  TrendingUp, ArrowUpRight, RefreshCw,
  AlertCircle, Users, BarChart3, Zap,
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/tenant-context'
import { useTheme } from '../contexts/theme-context'
import { supabase } from '../lib/supabase'

import { loadDashboard, conversionRate as getConversionRate, createRequestGate } from '../lib/dashboard-data'
import type { ReadPage } from '../lib/dashboard-data'

const fmt = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
const readPage: ReadPage = (table, tenantId, from, to, start, end) => {
  let query = supabase.from(table)
    .select(table === 'finances' ? 'id, transaction_date, amount' : 'id, status', { count: 'exact' })
    .eq('tenant_id', tenantId)
  if (table === 'finances') query = query.gte('transaction_date', start).lt('transaction_date', end)
  return query.order('id', { ascending: true }).range(from, to)
}

export default function Dashboard() {
  const { tenant } = useTenant()
  // Switching companies destroys previous local state before the new company renders.
  return <TenantDashboard key={tenant?.id ?? 'no-tenant'} />
}

function TenantDashboard() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id
  const { isDark } = useTheme()
  const [data, setData] = useState<Awaited<ReturnType<typeof loadDashboard>> | null>(null)
  const [loading, setLoading] = useState(Boolean(tenantId))
  const gate = useRef(createRequestGate())
  const fetchData = useCallback(async () => {
    if (!tenantId) return
    const current = gate.current.begin()
    setLoading(true)
    setData(null)
    const next = await loadDashboard(readPage, tenantId, new Date())
    if (!current()) return
    setData(next)
    setLoading(false)
  }, [tenantId])

  useEffect(() => {
    const requests = gate.current
    void fetchData()
    return () => requests.cancel()
  }, [fetchData])

  const leads = data?.leads.status === 'ready' ? data.leads.data : null
  const billing = data?.billing.status === 'ready' ? data.billing.data : null
  const totalLeads = leads ? Object.values(leads).reduce((a, b) => a + b, 0) : null
  const conversion = leads ? getConversionRate(leads) : null
  const conversionRate = conversion === null ? 'Indisponível' : `${conversion.toFixed(1)}%`
  const unavailable = loading ? 'Carregando...' : !tenantId ? 'Selecione uma empresa' : 'Indisponível'
  const billingData = billing?.points ?? []

  const tooltipStyle = {
    background: isDark ? '#1E1218' : '#ffffff',
    border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text-main)', fontSize: 12,
  }

  const funnelData = leads ? [
    { name: 'Novos', value: leads.new, fill: '#C2185B' },
    { name: 'Contatados', value: leads.contacted, fill: '#E91E8C' },
    { name: 'Qualificados', value: leads.qualified, fill: '#D4A017' },
    { name: 'Convertidos', value: leads.converted, fill: '#B5860D' },
    { name: 'Perdidos', value: leads.lost, fill: '#64748b' },
  ] : []

  return (
    <AppLayout title="Dashboard" subtitle={`Visão geral — ${tenant?.name}`}>

      {!tenantId && <p role="status">Selecione uma empresa para consultar os dados.</p>}
      {(data?.billing.status === 'error' || data?.leads.status === 'error') && (
        <div role="alert" className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-4 text-xs">
          <AlertCircle size={13} /> Não foi possível carregar todos os dados. Atualize para tentar novamente.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {[
          { icon: Users, label: 'Estabelecimentos', value: 'Indisponível', sub: 'Sem fonte consolidada autorizada', c: 'var(--accent)', bg: 'var(--accent-muted)' },
          { icon: TrendingUp, label: 'Leads cadastrados', value: totalLeads === null ? unavailable : String(totalLeads), sub: 'Empresa selecionada; inclui perdidos', c: '#10b981', bg: 'rgba(16,185,129,0.1)' },
          { icon: BarChart3, label: 'Leads Pipeline', value: leads ? String(leads.new + leads.contacted + leads.qualified) : unavailable, sub: 'Novos, contatados e qualificados', c: 'var(--gold)', bg: 'var(--gold-muted)' },
          { icon: Zap, label: 'Taxa de Conversão', value: leads ? conversionRate : unavailable, sub: leads ? totalLeads === 0 ? 'Sem leads para calcular' : `${leads.converted} convertidos / ${totalLeads} leads` : 'Conversões / todos os leads', c: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
        ].map(({ icon: Icon, label, value, sub, c, bg }) => (
          <div key={label} className="card animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: bg, color: c }}>
                <Icon size={15} />
              </span>
            </div>
            <p className="text-2xl font-bold" style={{ color: c, fontFamily: "'Playfair Display', serif" }}>
              {loading ? '—' : value}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="section-title">Lançamentos financeiros</p>
              <p className="section-subtitle">Últimos 6 meses — {tenant?.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={billing ? 'badge-success' : 'badge-warning'}>
                <ArrowUpRight size={11} />{loading ? 'Carregando' : billing ? 'Registrados' : 'Indisponível'}
              </span>
              <button onClick={() => void fetchData()} disabled={!tenantId || loading} aria-label="Atualizar dashboard" className="btn-secondary py-1 px-2 gap-1 text-xs">
                <RefreshCw size={11} />
              </button>
            </div>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Soma dos lançamentos; não representa receita recorrente nem recebimentos confirmados.</p>
          {!billing || billing.count === 0 ? <p role="status" className="h-[190px] flex items-center justify-center text-sm">{loading ? 'Carregando lançamentos...' : billing ? 'Nenhum lançamento no período. Total registrado: R$ 0,00.' : unavailable}</p> : <ResponsiveContainer width="100%" height={190}>
            <AreaChart data={billingData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="accentGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmt(v), 'Lançamentos']} />
              <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5} fill="url(#accentGrad)" />
            </AreaChart>
          </ResponsiveContainer>}
        </div>

        <div className="card">
          <p className="section-title">Funil de Leads</p>
          <p className="section-subtitle">Quantidade atual por status; não indica histórico de passagem</p>
          {!leads || totalLeads === 0 ? <p role="status" className="h-[160px] flex items-center justify-center text-sm">{loading ? 'Carregando leads...' : leads ? 'Nenhum lead cadastrado.' : unavailable}</p> : <ResponsiveContainer width="100%" height={160}>
            <BarChart data={funnelData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 60 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, 'leads']} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {funnelData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>}
          <div className="flex justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Taxa de conversão</span>
            <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{loading ? '—' : conversionRate}</span>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
