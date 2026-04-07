// ════════════════════════════════════════════════════════════════════════════
// IntelAnalytics.tsx — Analytics de aprendizado em tela dedicada
// Rota: /intel/analytics
// ════════════════════════════════════════════════════════════════════════════
import AppLayout from '../../components/AppLayout'
import { INTEL_CSS, BackButton, colStyle, SectionHeader, MiniBar } from './intel-shared'

const ANALYTICS_DATA = [
  { label: 'Evolução dos chips', data: [42,51,58,63,71,79,84,89], color: '#a78bfa', desc: 'Score médio de aprendizado dos chips ao longo do tempo' },
  { label: 'Situações difíceis', data: [28,35,41,38,52,58,64,71], color: '#f87171', desc: 'Objeções e cenários complexos tratados com sucesso' },
  { label: 'Memórias utilizadas', data: [120,180,240,310,390,445,520,610], max: 800, color: '#00B4FF', desc: 'Memórias do repositório usadas em respostas' },
  { label: 'Erros recorrentes', data: [22,18,15,12,9,7,5,4], color: '#fb923c', desc: 'Tendência de queda — sistema aprendendo a evitar erros' },
  { label: 'Campanhas eficazes', data: [3,5,6,8,8,10,11,12], max: 15, color: '#34d399', desc: 'Campanhas que geraram agendamento real' },
  { label: 'Horários recuperados', data: [4,7,11,14,17,19,22,25], max: 30, color: '#fbbf24', desc: 'Furos de agenda convertidos em agendamentos' },
]

const CHANNEL_PERFORMANCE = [
  { canal: '💬 WhatsApp', metrics: [{l:'Taxa resposta',v:72,c:'#34d399'},{l:'Conversão',v:44,c:'#00B4FF'}], insight: 'Funciona melhor para clientes recorrentes' },
  { canal: '🎤 Áudio', metrics: [{l:'Taxa escuta',v:81,c:'#a78bfa'},{l:'Resposta',v:67,c:'#34d399'}], insight: 'Performa +3× em clientes indecisos' },
  { canal: '📞 Ligação', metrics: [{l:'Atendimento',v:58,c:'#fbbf24'},{l:'Fechamento',v:49,c:'#34d399'}], insight: 'Converte mais em horários vagos' },
  { canal: '📝 Texto', metrics: [{l:'Taxa abertura',v:64,c:'#00B4FF'},{l:'Conversão',v:31,c:'#fb923c'}], insight: 'Ideal para informativos e lembretes' },
]

export default function IntelAnalytics() {
  const copilotContext = {
    page: 'analytics' as const,
    data: {
      evolucaoChips: ANALYTICS_DATA[0].data,
      errosTendencia: ANALYTICS_DATA[3].data,
      memorias: ANALYTICS_DATA[2].data[ANALYTICS_DATA[2].data.length - 1],
      campanhasEficazes: ANALYTICS_DATA[4].data[ANALYTICS_DATA[4].data.length - 1],
      horariosRecuperados: ANALYTICS_DATA[5].data[ANALYTICS_DATA[5].data.length - 1],
    },
  }

  return (
    <AppLayout title="Analytics" subtitle="Evolução de aprendizado, canais e performance do sistema">
      <style>{INTEL_CSS}</style>
      <BackButton to="/intel" label="Intel Overview" />

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 20 }}>
        {ANALYTICS_DATA.map(({ label, data, color, max: mx, desc }) => {
          const maxVal = mx ?? Math.max(...data)
          return (
            <div key={label} style={{ ...colStyle, padding: '18px 20px' }}>
              <div style={{ fontSize: 10, color: 'rgba(100,130,160,0.55)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
              <div style={{ fontSize: 9, color: 'rgba(100,130,160,0.35)', marginBottom: 12 }}>{desc}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
                {data.map((v, i) => (
                  <div key={i} style={{
                    flex: 1, borderRadius: 3,
                    height: `${Math.max(4, (v/maxVal)*100)}%`,
                    background: i === data.length-1 ? color : `${color}55`,
                    transition: 'height 0.3s',
                  }}/>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <span style={{ fontSize: 9, color: 'rgba(100,130,160,0.35)' }}>7 dias atrás</span>
                <span style={{ fontSize: 14, color, fontWeight: 700 }}>{data[data.length-1]}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Channel performance */}
      <div style={{ ...colStyle }}>
        <SectionHeader title="PERFORMANCE POR CANAL" color="#34d399" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, padding: 18 }}>
          {CHANNEL_PERFORMANCE.map(({ canal, metrics, insight }) => (
            <div key={canal}>
              <div style={{ fontSize: 13, color: 'rgba(200,225,245,0.8)', marginBottom: 10, fontWeight: 600 }}>{canal}</div>
              {metrics.map(({ l, v, c }) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: 'rgba(100,130,160,0.5)', minWidth: 90 }}>{l}</span>
                  <MiniBar value={v} color={c} />
                  <span style={{ fontSize: 11, color: c, minWidth: 30, textAlign: 'right', fontWeight: 600 }}>{v}%</span>
                </div>
              ))}
              <div style={{ fontSize: 9, color: 'rgba(100,130,160,0.4)', fontStyle: 'italic', marginTop: 6 }}>💡 {insight}</div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
