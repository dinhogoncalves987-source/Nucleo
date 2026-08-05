// ════════════════════════════════════════════════════════════════════════════
// IntelOverview.tsx — Overview com cards navegáveis para sub-páginas
// Rota: /intel
// ════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import AppLayout from '../../components/AppLayout'
import {
  INTEL_CSS, KpiCard, Badge, MiniBar, SectionHeader,
  makeChips, makeAgenda, makePromos, makeInitialMetrics,
  CANAL_ICON, CHIP_STATUS_COLOR,
  type Chip, type AgendaOp, type Promotion, type IntelMetrics, type ChipStatus,
  colStyle, tabBtnStyle,
} from './intel-shared'

export default function IntelOverview() {
  const navigate = useNavigate()
  const [chips]   = useState<Chip[]>(makeChips)
  const [agenda]  = useState<AgendaOp[]>(makeAgenda)
  const [promos]  = useState<Promotion[]>(makePromos)
  const [metrics, setMetrics] = useState<IntelMetrics>(makeInitialMetrics)
  const [chipFilter, setChipFilter] = useState<ChipStatus|'todos'>('todos')

  useEffect(() => {
    const t = setInterval(() => {
      setMetrics(m => ({
        ...m,
        conversasHoje: m.conversasHoje + Math.floor(Math.random() * 2),
        clientesImpactados: m.clientesImpactados + Math.floor(Math.random() * 3),
        taxaSucesso: Math.min(99, m.taxaSucesso + (Math.random() > 0.7 ? 1 : 0)),
        agendamentosGerados: m.agendamentosGerados + (Math.random() > 0.8 ? 1 : 0),
        receitaPotencial: m.receitaPotencial + Math.floor(Math.random() * 150),
        emTreino: Math.floor(8 + Math.random() * 18),
      }))
    }, 3000)
    return () => clearInterval(t)
  }, [])

  const filteredChips = chipFilter === 'todos' ? chips : chips.filter(c => c.status === chipFilter)

  // Build context for Copilot
  const copilotContext = {
    page: 'overview' as const,
    data: {
      metrics,
      chipsResumo: {
        total: chips.length,
        ativo: chips.filter(c => c.status === 'ativo').length,
        alerta: chips.filter(c => c.status === 'alerta').length,
        quente: chips.filter(c => c.status === 'quente').length,
      },
      furosAgenda: agenda.reduce((a, b) => a + b.furos, 0),
      promosPendentes: promos.filter(p => p.status === 'pendente').length,
    },
  }
  void copilotContext

  return (
    <AppLayout title="James Intel" subtitle="Central de Inteligência Operacional — visão geral do sistema">
      <style>{INTEL_CSS}</style>

      {/* ═══ KPI BAR ═══ */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <KpiCard label="Chips ativos"     value={metrics.chipsAtivos}      color="#00B4FF" pulse />
        <KpiCard label="Em treino"        value={metrics.emTreino}          color="#a78bfa" pulse />
        <KpiCard label="Conversas hoje"   value={metrics.conversasHoje}     color="#34d399" pulse />
        <KpiCard label="Taxa de sucesso"  value={`${metrics.taxaSucesso}%`} color="#fbbf24" />
        <KpiCard label="Objeções resol."  value={metrics.objetosResolvidos} color="#34d399" />
        <KpiCard label="Furos detectados" value={metrics.furosDetectados}   color="#fb923c" />
        <KpiCard label="Furos convertidos" value={metrics.furosConvertidos} color="#00B4FF" />
        <KpiCard label="Agendamentos"     value={metrics.agendamentosGerados} color="#00B4FF" pulse />
        <KpiCard label="Receita potenc."  value={`R$ ${(metrics.receitaPotencial/1000).toFixed(1)}k`} color="#34d399" sub="recuperada" />
      </div>

      {/* ═══ NAVIGATION CARDS ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { icon: '📥', title: 'Inbox', desc: 'Interações multicanal', route: '/intel/inbox', color: '#00B4FF', stat: `${metrics.conversasHoje} conversas` },
          { icon: '🔲', title: 'Chips', desc: 'Mapa dos 100 chips', route: '/intel/chips', color: '#a78bfa', stat: `${chips.filter(c=>c.status==='alerta').length} alertas` },
          { icon: '📊', title: 'Analytics', desc: 'Evolução e tendências', route: '/intel/analytics', color: '#34d399', stat: `${metrics.taxaSucesso}% sucesso` },
          { icon: '🧠', title: 'Memórias', desc: 'Base de conhecimento', route: '/intel/memory', color: '#fbbf24', stat: '24 memórias' },
        ].map(card => (
          <div
            key={card.route}
            onClick={() => navigate(card.route)}
            className="cc-btn"
            style={{
              ...colStyle, padding: '20px 18px', cursor: 'pointer',
              transition: 'all 0.2s', position: 'relative', overflow: 'hidden',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${card.color}60` }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(0,180,255,0.1)' }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>{card.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: card.color, marginBottom: 4 }}>{card.title}</div>
            <div style={{ fontSize: 11, color: 'rgba(160,190,210,0.6)', marginBottom: 10 }}>{card.desc}</div>
            <Badge text={card.stat} color={card.color} />
          </div>
        ))}
      </div>

      {/* ═══ CHIP MAP (compact) ═══ */}
      <div style={{ ...colStyle, marginBottom: 12 }}>
        <SectionHeader title="MAPA DOS 100 CHIPS">
          <div style={{ display: 'flex', gap: 4 }}>
            {(['todos','ativo','aprendendo','estavel','avancado','alerta','quente'] as Array<ChipStatus|'todos'>).map(s => (
              <button key={s} style={tabBtnStyle(chipFilter===s)} onClick={() => setChipFilter(s)}>{s}</button>
            ))}
          </div>
        </SectionHeader>
        <div style={{ padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
          {filteredChips.slice(0, 50).map(chip => (
            <div key={chip.id}
              onClick={() => navigate(`/intel/chips/${chip.id}`)}
              title={`${chip.nome} · Learn:${chip.learn}% Conv:${chip.conv}%`}
              className="cc-btn"
              style={{
                padding: '4px 8px', borderRadius: 5, fontSize: 9, fontFamily: 'monospace',
                background: 'rgba(0,15,35,0.9)', border: `1px solid ${CHIP_STATUS_COLOR[chip.status]}30`,
                color: CHIP_STATUS_COLOR[chip.status], cursor: 'pointer', minWidth: 62,
              }}>
              <div style={{ marginBottom: 2, fontWeight: 700 }}>{chip.id}</div>
              <div style={{ opacity: 0.6 }}>{chip.status}</div>
            </div>
          ))}
          {filteredChips.length > 50 && (
            <div onClick={() => navigate('/intel/chips')} className="cc-btn" style={{
              padding: '8px 12px', borderRadius: 5, fontSize: 10, color: '#00B4FF',
              border: '1px solid rgba(0,180,255,0.2)', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}>
              +{filteredChips.length - 50} chips →
            </div>
          )}
        </div>
      </div>

      {/* ═══ AGENDA + PROMOÇÕES ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10, marginBottom: 12 }}>
        {/* Agenda */}
        <div style={colStyle}>
          <SectionHeader title="INTELIGÊNCIA DE AGENDA" color="#fb923c" />
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: 280 }}>
            {agenda.map((a, i) => (
              <div key={i} className="cc-row" style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: 'rgba(200,220,240,0.9)', fontWeight: 600 }}>{a.dia} · {a.horario}</span>
                  <span style={{ fontSize: 10, color: '#fb923c', fontWeight: 700 }}>{a.furos} furos</span>
                </div>
                <div style={{ fontSize: 10, color: 'rgba(160,190,210,0.6)', marginBottom: 4 }}>👤 {a.profissional} · {a.publico}</div>
                <div style={{ fontSize: 10, color: 'rgba(200,225,245,0.75)', marginBottom: 5 }}>🎯 {a.promocao}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Badge text={a.tipo} color='#fb923c'/>
                  <div style={{ flex: 1 }}/>
                  <span style={{ fontSize: 9, color: '#34d399' }}>{a.chance}%</span>
                  <MiniBar value={a.chance} color="#34d399"/>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Promoções */}
        <div style={colStyle}>
          <SectionHeader title="MOTOR DE PROMOÇÕES" color="#fbbf24" />
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: 280 }}>
            {promos.map(p => (
              <div key={p.id} className="cc-row" style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: 'rgba(200,220,240,0.9)', fontWeight: 600 }}>{p.titulo}</span>
                  <Badge text={p.status} color={p.status==='ativo'?'#34d399':p.status==='aprovado'?'#fbbf24':'#a78bfa'}/>
                </div>
                <div style={{ fontSize: 10, color: 'rgba(160,190,210,0.55)', marginBottom: 6 }}>{CANAL_ICON[p.canal]} {p.publico}</div>
                {p.impactados > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
                    {[{l:'Impactados',v:p.impactados,c:'#00B4FF'},{l:'Resposta',v:`${p.resposta}%`,c:'#34d399'},{l:'Agend.',v:`${p.agend}%`,c:'#fbbf24'}].map(({l,v,c}) => (
                      <div key={l} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</div>
                        <div style={{ fontSize: 8, color: 'rgba(100,130,160,0.5)' }}>{l}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
