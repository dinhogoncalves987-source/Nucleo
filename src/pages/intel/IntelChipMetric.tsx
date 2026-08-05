// ════════════════════════════════════════════════════════════════════════════
// IntelChipMetric.tsx — Página detalhada de uma métrica específica do chip
// Rota: /intel/chips/:id/:metric
// ════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AppLayout from '../../components/AppLayout'
import {
  INTEL_CSS, BackButton, Badge, MiniBar, SectionHeader,
  makeChips, CHIP_STATUS_COLOR,
  type Chip, colStyle,
} from './intel-shared'

type MetricKey = 'learn' | 'conv' | 'promo' | 'recov' | 'health' | 'heat'

interface MetricConfig {
  key: MetricKey
  label: string
  fullLabel: string
  color: string
  icon: string
  desc: string
}

const METRIC_MAP: Record<string, MetricConfig> = {
  learn:  { key: 'learn',  label: 'Aprendizado',  fullLabel: 'Score de Aprendizado',    color: '#a78bfa', icon: '🧠', desc: 'Capacidade do chip de aprender com interações e melhorar respostas ao longo do tempo' },
  conv:   { key: 'conv',   label: 'Conversão',    fullLabel: 'Taxa de Conversão',       color: '#34d399', icon: '🎯', desc: 'Percentual de interações que resultam em agendamento, venda ou ação concreta' },
  promo:  { key: 'promo',  label: 'Promoção',     fullLabel: 'Eficácia Promocional',    color: '#fbbf24', icon: '📢', desc: 'Performance do chip em campanhas promocionais e ofertas direcionadas' },
  recov:  { key: 'recov',  label: 'Recuperação',   fullLabel: 'Score de Recuperação',    color: '#00B4FF', icon: '🔄', desc: 'Capacidade de recuperar clientes inativos via reativação e follow-up' },
  health: { key: 'health', label: 'Saúde',        fullLabel: 'Saúde Operacional',       color: '#34d399', icon: '💚', desc: 'Estado geral do chip — estabilidade, uptime e ausência de erros críticos' },
  heat:   { key: 'heat',   label: 'Temperatura',  fullLabel: 'Temperatura de Operação', color: '#fb923c', icon: '🌡️', desc: 'Nível de utilização do chip — valores altos indicam sobrecarga potencial' },
}

// ── Mock builders for metric detail ───────────────────────────────────────
function makeTimeline(_metric: MetricKey, value: number) {
  const base = Math.max(20, value - 30)
  return Array.from({ length: 14 }, (_, i) => ({
    day: `${14 - i}d`,
    value: Math.min(100, Math.round(base + (value - base) * (i / 13) + (Math.random() - 0.5) * 8)),
  }))
}

function makeBreakdown(metric: MetricKey, value: number): { label: string; value: number; color: string }[] {
  const configs: Record<MetricKey, { label: string; color: string }[]> = {
    learn: [
      { label: 'Memórias aplicadas', color: '#a78bfa' },
      { label: 'Correções absorvidas', color: '#c084fc' },
      { label: 'Padrões detectados', color: '#7c3aed' },
      { label: 'Respostas otimizadas', color: '#ddd6fe' },
    ],
    conv: [
      { label: 'Agendamentos gerados', color: '#34d399' },
      { label: 'Vendas fechadas', color: '#10b981' },
      { label: 'Follow-ups eficazes', color: '#6ee7b7' },
      { label: 'Objeções convertidas', color: '#059669' },
    ],
    promo: [
      { label: 'Promoções enviadas', color: '#fbbf24' },
      { label: 'Taxa de abertura', color: '#f59e0b' },
      { label: 'Promoções convertidas', color: '#d97706' },
      { label: 'ROI de campanha', color: '#fde68a' },
    ],
    recov: [
      { label: 'Clientes reativados', color: '#00B4FF' },
      { label: 'Follow-ups enviados', color: '#38bdf8' },
      { label: 'Retorno em 7 dias', color: '#0284c7' },
      { label: 'Win-back rate', color: '#7dd3fc' },
    ],
    health: [
      { label: 'Uptime', color: '#34d399' },
      { label: 'Latência média', color: '#10b981' },
      { label: 'Erros/hora', color: '#6ee7b7' },
      { label: 'Confiabilidade', color: '#059669' },
    ],
    heat: [
      { label: 'Msgs/hora', color: '#fb923c' },
      { label: 'Carga de CPU', color: '#f97316' },
      { label: 'Fila de espera', color: '#ea580c' },
      { label: 'Tempo de resposta', color: '#fdba74' },
    ],
  }
  return configs[metric].map(c => ({
    ...c,
    value: Math.min(100, Math.max(10, Math.round(value + (Math.random() - 0.5) * 30))),
  }))
}

function makeEvents(metric: MetricKey) {
  const eventSets: Record<MetricKey, string[]> = {
    learn: ['Memória MEM-042 aplicada com sucesso', 'Correção manual absorvida (resposta #228)', 'Padrão de linguagem detectado: estilo informal', 'Score subiu 3% após bulk training', 'Novo caso de objeção catalogado', 'Modelo refinado com 12 novas amostras'],
    conv: ['Agendamento confirmado: Ana Souza 14:00', 'Venda fechada: Combo Capilar R$189', 'Follow-up converteu cliente inativa 45d', 'Objeção de preço resolvida com desconto 15%', 'Agendamento via áudio: Mariana Costa', 'Cross-sell sugerido e aceito'],
    promo: ['Campanha "Combo Anti-Queda" enviada para 142 clientes', 'Taxa abertura: 68% (acima da média)', 'Promoção "Terça Bem-Estar" converteu 29 agendamentos', 'Flash promo impacto: R$2.400 em receita', 'A/B test: versão B +12% conversão', 'Promo segmentada para VIPs ativada'],
    recov: ['Cliente Juliana Alves reativada após 60d', 'Follow-up automático enviado: 23 clientes', 'Win-back: 7 retornos em 48h', 'Campanha reativação: 31% taxa resposta', 'Cliente premium recuperada via ligação', 'Sequência de 3 toques concluída'],
    health: ['Uptime: 99.7% nas últimas 24h', 'Latência média: 142ms (normal)', 'Zero erros críticos hoje', 'Backup de memórias sincronizado', 'Healthcheck automático: OK', 'Reinício programado executado'],
    heat: ['Pico de mensagens entre 14h-16h: 48 msgs', 'Fila de espera zerada às 15:30', 'Alerta de temperatura: >90% por 12min', 'Carga normalizada após redistribuição', 'Rate limit preventivo ativado', 'Cooldown automático às 16:00'],
  }
  return eventSets[metric].map((text, i) => ({
    ts: `${String(8 + Math.floor(i * 1.5)).padStart(2, '0')}:${String((i * 17) % 60).padStart(2, '0')}`,
    text,
    status: ['ok', 'ok', 'warn', 'ok', 'ok', 'info'][i] as 'ok' | 'warn' | 'info',
  }))
}

function makeInsights(_metric: MetricKey, value: number): string[] {
  if (value >= 85) return [`Score de ${value}% está excelente — manter estratégia atual`, 'Chip opera no top 10% da frota', 'Sem ações corretivas necessárias']
  if (value >= 65) return [`Score de ${value}% está bom mas pode melhorar`, `Potencial de +${100 - value}% com ajustes finos`, 'Recomendação: revisar casos de baixa confiança']
  return [`Score de ${value}% está abaixo do ideal`, 'Ação imediata necessária para correção', 'Recomendação: treino intensivo + revisão de memórias']
}

function makeComparison(_metric: MetricKey, value: number) {
  return {
    frota: Math.round(65 + Math.random() * 15),
    melhor: Math.round(90 + Math.random() * 10),
    pior: Math.round(30 + Math.random() * 20),
    atual: value,
    rank: Math.round(1 + (100 - value) * 0.8),
  }
}

// ── Component ─────────────────────────────────────────────────────────────
export default function IntelChipMetric() {
  const { id, metric: metricParam } = useParams<{ id: string; metric: string }>()
  const navigate = useNavigate()
  const [chips] = useState<Chip[]>(makeChips)

  const chip = useMemo(() => chips.find(c => c.id === id), [chips, id])
  const metricConfig = metricParam ? METRIC_MAP[metricParam] : null

  if (!chip || !metricConfig) {
    return (
      <AppLayout title="Métrica não encontrada" subtitle="">
        <BackButton to={chip ? `/intel/chips/${id}` : '/intel/chips'} label="Voltar" />
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(160,190,210,0.5)', fontSize: 14 }}>
          {!chip ? `Chip "${id}" não encontrado.` : `Métrica "${metricParam}" não existe.`}
        </div>
      </AppLayout>
    )
  }

  const value = chip[metricConfig.key] as number
  const color = metricConfig.color
  const timeline = useMemo(() => makeTimeline(metricConfig.key, value), [metricConfig.key, value])
  const breakdown = useMemo(() => makeBreakdown(metricConfig.key, value), [metricConfig.key, value])
  const events = useMemo(() => makeEvents(metricConfig.key), [metricConfig.key])
  const insights = useMemo(() => makeInsights(metricConfig.key, value), [metricConfig.key, value])
  const comparison = useMemo(() => makeComparison(metricConfig.key, value), [metricConfig.key, value])

  // Other metrics for quick navigation
  const otherMetrics = Object.values(METRIC_MAP).filter(m => m.key !== metricConfig.key)

  const copilotContext = {
    page: 'chipDetail' as const,
    data: {
      chip: { id: chip.id, status: chip.status },
      metricaAtual: metricConfig.label,
      valor: value,
      timeline: timeline.map(t => t.value),
      breakdown: breakdown.map(b => ({ label: b.label, value: b.value })),
      insights,
      comparacaoFrota: comparison,
    },
  }
  void copilotContext

  return (
    <AppLayout title={`${chip.id} · ${metricConfig.fullLabel}`} subtitle={`${metricConfig.icon} ${metricConfig.desc}`}>
      <style>{INTEL_CSS}</style>

      {/* Breadcrumb navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/intel/chips')} className="cc-btn" style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,180,255,0.15)', background: 'rgba(0,180,255,0.04)', color: 'rgba(0,180,255,0.6)', cursor: 'pointer' }}>
          Chips
        </button>
        <span style={{ color: 'rgba(100,130,160,0.3)' }}>›</span>
        <button onClick={() => navigate(`/intel/chips/${id}`)} className="cc-btn" style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${CHIP_STATUS_COLOR[chip.status]}30`, background: `${CHIP_STATUS_COLOR[chip.status]}08`, color: CHIP_STATUS_COLOR[chip.status], cursor: 'pointer' }}>
          {chip.id}
        </button>
        <span style={{ color: 'rgba(100,130,160,0.3)' }}>›</span>
        <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${color}40`, background: `${color}15`, color, fontWeight: 600 }}>
          {metricConfig.icon} {metricConfig.label}
        </span>
      </div>

      {/* Hero metric */}
      <div style={{ ...colStyle, padding: '24px 28px', marginBottom: 16, borderColor: `${color}30` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{
            width: 80, height: 80, borderRadius: 16,
            background: `${color}12`, border: `2px solid ${color}35`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32,
          }}>
            {metricConfig.icon}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 10, color: 'rgba(100,130,160,0.5)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>{metricConfig.fullLabel}</div>
            <div style={{ fontSize: 42, fontWeight: 900, color, lineHeight: 1 }}>{value}%</div>
            <div style={{ fontSize: 11, color: 'rgba(160,190,210,0.5)', marginTop: 4 }}>{metricConfig.desc}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
              <span style={{ color: 'rgba(100,130,160,0.5)' }}>Rank na frota</span>
              <span style={{ color, fontWeight: 700 }}>#{comparison.rank} / 100</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
              <span style={{ color: 'rgba(100,130,160,0.5)' }}>Média frota</span>
              <span style={{ color: 'rgba(200,220,240,0.7)' }}>{comparison.frota}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
              <span style={{ color: 'rgba(100,130,160,0.5)' }}>vs Média</span>
              <span style={{ color: value > comparison.frota ? '#34d399' : '#f87171', fontWeight: 600 }}>
                {value > comparison.frota ? `+${value - comparison.frota}%` : `${value - comparison.frota}%`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline chart */}
      <div style={{ ...colStyle, padding: '18px 20px', marginBottom: 16 }}>
        <SectionHeader title={`EVOLUÇÃO — ${metricConfig.label.toUpperCase()} (14 DIAS)`} color={color} />
        <div style={{ padding: '16px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100 }}>
            {timeline.map((point, i) => {
              const isLast = i === timeline.length - 1
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 8, color: isLast ? color : 'transparent' }}>{point.value}</span>
                  <div style={{
                    width: '100%', borderRadius: 3, minHeight: 4,
                    height: `${Math.max(4, point.value)}%`,
                    background: isLast ? color : `${color}50`,
                    transition: 'height 0.4s',
                    boxShadow: isLast ? `0 0 8px ${color}40` : 'none',
                  }} />
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 8, color: 'rgba(100,130,160,0.3)' }}>14d atrás</span>
            <span style={{ fontSize: 8, color: 'rgba(100,130,160,0.3)' }}>Hoje</span>
          </div>
        </div>
      </div>

      {/* Breakdown + Insights + Comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
        {/* Breakdown */}
        <div style={colStyle}>
          <SectionHeader title="COMPOSIÇÃO DO SCORE" color={color} />
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {breakdown.map(b => (
              <div key={b.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: 'rgba(200,220,240,0.7)' }}>{b.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: b.color }}>{b.value}%</span>
                </div>
                <MiniBar value={b.value} color={b.color} />
              </div>
            ))}
          </div>
        </div>

        {/* Insights */}
        <div style={colStyle}>
          <SectionHeader title="ANÁLISE JAMES" color="#00B4FF" />
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insights.map((insight, i) => (
              <div key={i} style={{
                padding: '10px 14px', borderRadius: 6,
                background: i === 0 ? `${color}08` : 'rgba(0,15,35,0.4)',
                border: `1px solid ${i === 0 ? `${color}25` : 'rgba(255,255,255,0.04)'}`,
              }}>
                <span style={{ fontSize: 11, color: i === 0 ? color : 'rgba(200,220,240,0.7)', lineHeight: 1.5 }}>
                  {i === 0 ? '📊' : i === 1 ? '💡' : '🎯'} {insight}
                </span>
              </div>
            ))}

            {/* Comparison box */}
            <div style={{ marginTop: 4, padding: 12, borderRadius: 6, background: 'rgba(0,20,50,0.5)', border: '1px solid rgba(0,180,255,0.1)' }}>
              <div style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Comparativo frota</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { l: 'Melhor', v: comparison.melhor, c: '#34d399' },
                  { l: 'Média', v: comparison.frota, c: '#fbbf24' },
                  { l: 'Pior', v: comparison.pior, c: '#f87171' },
                ].map(({ l, v, c }) => (
                  <div key={l} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{v}%</div>
                    <div style={{ fontSize: 8, color: 'rgba(100,130,160,0.4)' }}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 9, color: 'rgba(100,130,160,0.4)' }}>Este chip</span>
                  <span style={{ fontSize: 9, color }}>{value}%</span>
                </div>
                <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 4 }}>
                  <div style={{ position: 'absolute', left: `${comparison.pior}%`, width: `${comparison.melhor - comparison.pior}%`, height: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }} />
                  <div style={{ position: 'absolute', left: `${value}%`, top: -2, width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, transform: 'translateX(-50%)' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Events timeline */}
      <div style={{ ...colStyle, marginBottom: 16 }}>
        <SectionHeader title={`EVENTOS RECENTES — ${metricConfig.label.toUpperCase()}`} color={color} />
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {events.map((e, i) => (
            <div key={i} className="cc-row" style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
            }}>
              <span style={{ fontSize: 9, color: 'rgba(100,130,160,0.4)', minWidth: 32 }}>{e.ts}</span>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: e.status === 'ok' ? '#34d399' : e.status === 'warn' ? '#fbbf24' : '#00B4FF',
              }} />
              <span style={{ fontSize: 11, color: 'rgba(200,220,240,0.8)', flex: 1 }}>{e.text}</span>
              <Badge text={e.status} color={e.status === 'ok' ? '#34d399' : e.status === 'warn' ? '#fbbf24' : '#00B4FF'} />
            </div>
          ))}
        </div>
      </div>

      {/* Quick-nav to other metrics */}
      <div style={{ ...colStyle, padding: '14px 16px' }}>
        <div style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
          Explorar outras métricas de {chip.id}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {otherMetrics.map(m => {
            const mValue = chip[m.key] as number
            return (
              <button key={m.key}
                onClick={() => navigate(`/intel/chips/${id}/${m.key}`)}
                className="cc-btn"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                  background: `${m.color}08`, border: `1px solid ${m.color}25`,
                  color: m.color, fontSize: 11, fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >
                {m.icon} {m.label}
                <span style={{ fontSize: 12, fontWeight: 800 }}>{mValue}%</span>
              </button>
            )
          })}
        </div>
      </div>
    </AppLayout>
  )
}
