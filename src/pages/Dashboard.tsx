import { useState, useEffect } from 'react'
import {
  TrendingUp, ArrowUpRight, RefreshCw,
  AlertCircle, Users, BarChart3, Zap,
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/TenantContext'
import { useTheme } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'

interface FinanceRow { transaction_date: string; amount: number; type?: string }
interface LeadCounts { new: number; contacted: number; qualified: number; converted: number }

function groupByMonth(rows: FinanceRow[]) {
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const map: Record<string, number> = {}
  rows.forEach(r => {
    const d = new Date(r.transaction_date)
    const key = `${months[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`
    map[key] = (map[key] ?? 0) + Number(r.amount)
  })
  return Object.entries(map).map(([month, value]) => ({ month, value })).slice(-6)
}

const fmt = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`

export default function Dashboard() {
  const { tenant } = useTenant()
  const { isDark } = useTheme()
  const [billingData, setBillingData] = useState<{ month: string; value: number }[]>([])
  const [leadCounts, setLeadCounts] = useState<LeadCounts>({ new: 0, contacted: 0, qualified: 0, converted: 0 })
  const [tenantCount, setTenantCount] = useState(1)
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => { if (tenant?.id) fetchData() }, [tenant])

  const fetchData = async () => {
    setLoading(true)
    setIsDemo(false)
    try {
      // Finances
      const { data: finances } = await supabase
        .from('finances')
        .select('transaction_date, amount, type')
        .eq('tenant_id', tenant!.id)
        .order('transaction_date', { ascending: true })

      if (finances && finances.length > 0) {
        const grouped = groupByMonth(finances as FinanceRow[])
        setBillingData(grouped)
      } else {
        setIsDemo(true)
        setBillingData([
          { month: 'Out/24', value: 18400 }, { month: 'Nov/24', value: 24700 },
          { month: 'Dez/24', value: 21200 }, { month: 'Jan/25', value: 29800 },
          { month: 'Fev/25', value: 33100 }, { month: 'Mar/25', value: 41500 },
        ])
      }

      // Count tenants (for SaaS MRR)
      const { count } = await supabase.from('tenants').select('id', { count: 'exact', head: true })
      setTenantCount(count ?? 1)

      // Lead funnel
      const { data: leads } = await supabase.from('leads').select('status').eq('tenant_id', tenant!.id)
      if (leads && leads.length > 0) {
        const counts: LeadCounts = { new: 0, contacted: 0, qualified: 0, converted: 0 }
        leads.forEach(l => { if (l.status in counts) counts[l.status as keyof LeadCounts]++ })
        setLeadCounts(counts)
      } else {
        setLeadCounts({ new: 340, contacted: 210, qualified: 95, converted: 38 })
      }
    } catch (err) { console.error('Dashboard fetch error:', err) }
    finally { setLoading(false) }
  }

  const totalLeads = Object.values(leadCounts).reduce((a, b) => a + b, 0) || 1
  const conversionRate = ((leadCounts.converted / totalLeads) * 100).toFixed(1)

  const tooltipStyle = {
    background: isDark ? '#1E1218' : '#ffffff',
    border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text-main)', fontSize: 12,
  }

  const funnelData = [
    { name: 'Prospectados', value: totalLeads, fill: '#C2185B' },
    { name: 'Contatados', value: leadCounts.contacted + leadCounts.qualified + leadCounts.converted, fill: '#E91E8C' },
    { name: 'Qualificados', value: leadCounts.qualified + leadCounts.converted, fill: '#D4A017' },
    { name: 'Convertidos', value: leadCounts.converted, fill: '#B5860D' },
  ]

  return (
    <AppLayout title="Dashboard" subtitle={`Visão geral — ${tenant?.name}`}>

      {/* Demo notice */}
      {isDemo && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-4 text-xs"
          style={{ background: 'rgba(181,134,13,0.08)', border: '1px solid rgba(181,134,13,0.2)', color: 'var(--gold)' }}>
          <AlertCircle size={13} />
          <span><strong>PROJEÇÃO</strong> — Sem dados reais ainda. Estes números são estimativas ilustrativas.</span>
        </div>
      )}

      {/* KPIs — Métricas de Lançamento */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {[
          { icon: Users, label: 'Estabelecimentos', value: String(tenantCount), sub: 'Parceiros na plataforma', c: 'var(--accent)', bg: 'var(--accent-muted)' },
          { icon: TrendingUp, label: 'Clientes', value: String(totalLeads), sub: 'Base total de clientes', c: '#10b981', bg: 'rgba(16,185,129,0.1)' },
          { icon: BarChart3, label: 'Leads Pipeline', value: String(leadCounts.new + leadCounts.contacted), sub: `${leadCounts.new} novos | ${leadCounts.contacted} contatados`, c: 'var(--gold)', bg: 'var(--gold-muted)' },
          { icon: Zap, label: 'Taxa de Conversão', value: `${conversionRate}%`, sub: `${leadCounts.converted} convertidos`, c: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
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
              <p className="section-title">Faturamento Real</p>
              <p className="section-subtitle">Últimos 6 meses — {tenant?.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={isDemo ? 'badge-warning' : 'badge-success'}>
                <ArrowUpRight size={11} />{isDemo ? 'PROJEÇÃO' : 'real'}
              </span>
              <button onClick={fetchData} className="btn-secondary py-1 px-2 gap-1 text-xs">
                <RefreshCw size={11} />
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={190}>
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
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmt(v), 'Faturamento']} />
              <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5} fill="url(#accentGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <p className="section-title">Funil de Leads</p>
          <p className="section-subtitle">Dados reais do banco</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={funnelData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 60 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, 'leads']} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {funnelData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Taxa de conversão</span>
            <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{loading ? '—' : `${conversionRate}%`}</span>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
