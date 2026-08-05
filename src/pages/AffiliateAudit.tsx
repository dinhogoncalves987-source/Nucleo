import { useState, useEffect } from 'react'
import { Network, TrendingUp, Users, DollarSign,
  Award, RefreshCw, Copy, CheckCircle2, Zap, AlertCircle
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { getAffiliateAuditData, getOrCreateAffiliate, generateAffiliateLink, type AffiliateAuditRow } from '../lib/affiliates'
import { checkAffiliateOpportunities } from '../lib/openai'
import { useTenant } from '../contexts/tenant-context'

export default function AffiliateAudit() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<AffiliateAuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [myLink, setMyLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [jamesSuggestion, setJamesSuggestion] = useState<string | null>(null)
  const [jamesLoading, setJamesLoading] = useState(false)
  const [totalStats, setTotalStats] = useState({ referrals: 0, gmv: 0, commission: 0, pending: 0 })

  useEffect(() => {
    fetchData()
    if (tenant) loadMyLink()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant])

  const fetchData = async () => {
    setLoading(true)
    const data = await getAffiliateAuditData()
    setRows(data)
    setTotalStats({
      referrals: data.reduce((s, r) => s + r.total_referrals, 0),
      gmv: data.reduce((s, r) => s + r.total_gmv, 0),
      commission: data.reduce((s, r) => s + r.commission_earned, 0),
      pending: data.reduce((s, r) => s + r.commission_pending, 0),
    })
    setLoading(false)
  }

  const loadMyLink = async () => {
    if (!tenant) return
    const aff = await getOrCreateAffiliate(tenant.id, tenant.name)
    if (aff) setMyLink(generateAffiliateLink(aff.slug))
  }

  const copyLink = () => {
    navigator.clipboard.writeText(myLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const askJames = async () => {
    setJamesLoading(true)
    try {
      const summary = rows.map(r =>
        `${r.tenant_name}: ${r.total_referrals} refs, GMV R$${r.total_gmv.toFixed(0)}`
      ).join(' | ')
      const suggestion = await checkAffiliateOpportunities(summary)
      setJamesSuggestion(suggestion)
    } finally {
      setJamesLoading(false)
    }
  }

  // SIMULATION: pagamento demo local para validar cashback/comissao sem depender do Asaas real
  const [simulating, setSimulating] = useState(false)
  const [simResult, setSimResult] = useState<string | null>(null)
  const simulatePayment = async () => {
    setSimulating(true)
    setSimResult(null)
    try {
      const { createMockAsaasEvent, processAsaasPayment } = await import('../lib/asaas')
      const event = createMockAsaasEvent(
        tenant?.id ?? '00000000-0000-0000-0000-000000000001',
        'demo-client-001',
        320
      )
      const result = await processAsaasPayment(event)
      setSimResult(result.message)
    } catch (e) {
      setSimResult('Erro: ' + String(e))
    } finally {
      setSimulating(false)
    }
  }

  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <AppLayout title="Auditoria de Afiliados" subtitle="Rede cross-tenant · Comissão 1% sobre GMV">
      <div className="flex flex-col gap-4">

        {/* Meu Link de Afiliado */}
        {myLink && (
          <div className="card animate-fade-in" style={{ borderColor: 'var(--accent)', background: 'var(--gradient-subtle)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--accent)' }}>
              🔗 Meu Link de Afiliado
            </p>
            <div className="flex items-center gap-3">
              <code className="flex-1 text-xs p-3 rounded-xl truncate"
                style={{ background: 'var(--surface-hover)', color: 'var(--text-main)', border: '1px solid var(--border)' }}>
                {myLink}
              </code>
              <button onClick={copyLink} className={copied ? '' : 'btn-primary gap-2'}
                style={copied ? { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(16,185,129,0.1)', color: '#059669', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, padding: '10px 16px', fontWeight: 600, fontSize: 13 } : {}}>
                {copied ? <><CheckCircle2 size={13} /> Copiado!</> : <><Copy size={13} /> Copiar</>}
              </button>
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: <Users size={17} />, label: 'Clientes Referidos', value: totalStats.referrals, color: 'var(--accent)' },
            { icon: <TrendingUp size={17} />, label: 'GMV Cross-Tenant', value: fmtBRL(totalStats.gmv), color: 'var(--gold)' },
            { icon: <DollarSign size={17} />, label: 'Comissão Paga', value: fmtBRL(totalStats.commission), color: '#10b981' },
            { icon: <Award size={17} />, label: 'Comissão Pendente', value: fmtBRL(totalStats.pending), color: '#f59e0b' },
          ].map((kpi, i) => (
            <div key={i} className="card">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
                style={{ background: `${kpi.color}18`, color: kpi.color }}>
                {kpi.icon}
              </div>
              <p className="font-bold text-xl" style={{ color: kpi.color }}>{kpi.value}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* James Sugere */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="section-title flex items-center gap-2">
              <Zap size={16} style={{ color: '#7c3aed' }} /> James Analisa a Rede
            </p>
            <button onClick={askJames} disabled={jamesLoading} className="btn-primary text-xs gap-1.5 py-1.5 px-4">
              {jamesLoading
                ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Analisando...</>
                : '✨ Pedir análise ao James'}
            </button>
          </div>
          {jamesSuggestion ? (
            <div className="p-4 rounded-xl text-sm" style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.2)', color: 'var(--text-main)', lineHeight: 1.6 }}>
              💡 {jamesSuggestion}
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Clique em "Pedir análise" para o James identificar oportunidades na rede de afiliados.
            </p>
          )}
        </div>

        {/* Tabela de Auditoria */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="section-title flex items-center gap-2">
                <Network size={16} style={{ color: 'var(--accent)' }} /> Auditoria Cross-Tenant
              </p>
              <p className="section-subtitle">GMV gerado por cada afiliado · Comissão 1%</p>
            </div>
            <button onClick={fetchData} className="btn-secondary gap-2 py-1.5 px-3 text-xs">
              <RefreshCw size={12} /> Atualizar
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'var(--surface-hover)' }}>
              <AlertCircle size={16} style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Nenhum afiliado ativo. Execute <code className="text-xs">supabase/affiliates_schema.sql</code> para ativar.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--surface-hover)' }}>
                    {['Salão', 'Slug', 'Referidos', 'GMV Cross-Tenant', 'Comissão Paga', 'Pendente'].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                      <td className="table-cell font-semibold" style={{ color: 'var(--text-main)' }}>{row.tenant_name}</td>
                      <td className="table-cell">
                        <code className="text-xs px-2 py-0.5 rounded-md" style={{ background: 'var(--surface-hover)', color: 'var(--accent)' }}>
                          ?ref={row.slug}
                        </code>
                      </td>
                      <td className="table-cell text-center font-bold" style={{ color: 'var(--accent)' }}>{row.total_referrals}</td>
                      <td className="table-cell font-bold" style={{ color: 'var(--gold)' }}>{fmtBRL(row.total_gmv)}</td>
                      <td className="table-cell" style={{ color: '#10b981' }}>{fmtBRL(row.commission_earned)}</td>
                      <td className="table-cell">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
                          {fmtBRL(row.commission_pending)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Simulador Asaas (dev/demo) */}
        <div className="card" style={{ border: '1px dashed var(--border)' }}>
          <p className="section-title flex items-center gap-2 mb-2">
            <DollarSign size={15} style={{ color: '#10b981' }} /> Simulador de Pagamento Asaas
          </p>
          <p className="section-subtitle mb-3">Simule um pagamento de R$320 para testar cashback + comissão</p>
          <div className="flex items-center gap-3">
            <button onClick={simulatePayment} disabled={simulating}
              className="btn-primary gap-2 text-sm"
              style={{ background: 'rgba(16,185,129,0.15)', color: '#059669', border: '1px solid rgba(16,185,129,0.3)' }}>
              {simulating
                ? <><div className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /> Processando...</>
                : '▶ Simular Pagamento R$320'}
            </button>
            {simResult && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>✅ {simResult}</p>
            )}
          </div>
        </div>

      </div>
    </AppLayout>
  )
}
