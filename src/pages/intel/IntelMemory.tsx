// ════════════════════════════════════════════════════════════════════════════
// IntelMemory.tsx — Memórias, histórico, correções e logs
// Rota: /intel/memory
// ════════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import AppLayout from '../../components/AppLayout'
import {
  BackButton, Badge,
} from './intel-shared'
import {
  makeMemories, CLIENTES, CANAIS, CANAL_ICON,
  type Memory, type BottomTab,
} from './intel-data'
import { INTEL_CSS, colStyle, tabBtnStyle } from './intel-styles'

export default function IntelMemory() {
  const [memories] = useState<Memory[]>(makeMemories)
  const [tab, setTab] = useState<BottomTab>('memorias')

  const copilotContext = {
    page: 'memory' as const,
    data: {
      totalMemorias: memories.length,
      tipos: memories.reduce((acc, m) => { acc[m.tipo] = (acc[m.tipo] || 0) + 1; return acc }, {} as Record<string, number>),
      mediaUso: Math.round(memories.reduce((a, m) => a + m.uso, 0) / memories.length),
      mediaTaxa: Math.round(memories.reduce((a, m) => a + m.taxa, 0) / memories.length),
    },
  }
  void copilotContext

  return (
    <AppLayout title="Memórias" subtitle="Base de conhecimento, histórico, correções e logs do sistema">
      <style>{INTEL_CSS}</style>
      <BackButton to="/intel" label="Intel Overview" />

      {/* Tabs */}
      <div style={{ ...colStyle }}>
        <div style={{ display: 'flex', gap: 4, padding: '10px 14px', borderBottom: '1px solid rgba(0,180,255,0.1)', background: 'rgba(0,20,50,0.5)', flexWrap: 'wrap' }}>
          {(['memorias','historico','correcoes','logs'] as BottomTab[]).map(t => (
            <button key={t} style={tabBtnStyle(tab===t)} onClick={() => setTab(t)}>
              {t === 'memorias' ? '🧠' : t === 'historico' ? '📋' : t === 'correcoes' ? '✍️' : '📊'} {t}
            </button>
          ))}
        </div>

        {/* Memórias */}
        {tab === 'memorias' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'rgba(0,20,50,0.6)' }}>
                  {['tipo','input','output','tags','prioridade','origem','uso','taxa sucesso','ações'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 9, color: 'rgba(100,130,160,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid rgba(0,180,255,0.08)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {memories.map(m => (
                  <tr key={m.id} className="cc-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.025)' }}>
                    <td style={{ padding: '8px 12px' }}><Badge text={m.tipo} color={m.tipo==='fact'?'#00B4FF':m.tipo==='response'?'#a78bfa':m.tipo==='behavior'?'#fbbf24':'#34d399'}/></td>
                    <td style={{ padding: '8px 12px', color: 'rgba(180,200,220,0.7)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.input}</td>
                    <td style={{ padding: '8px 12px', color: 'rgba(160,190,210,0.5)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.output}</td>
                    <td style={{ padding: '8px 12px' }}><Badge text={m.tags} color='#34d399'/></td>
                    <td style={{ padding: '8px 12px', color: '#fbbf24', fontWeight: 700 }}>{m.prioridade}</td>
                    <td style={{ padding: '8px 12px', color: 'rgba(130,160,190,0.5)' }}>{m.origem}</td>
                    <td style={{ padding: '8px 12px', color: 'rgba(130,160,190,0.6)' }}>{m.uso}×</td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 50, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${m.taxa}%`, background: '#34d399' }}/>
                        </div>
                        <span style={{ fontSize: 9, color: '#34d399' }}>{m.taxa}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {['editar','excluir'].map(a => (
                          <button key={a} className="cc-btn" style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, border: '1px solid rgba(0,180,255,0.2)', color: 'rgba(0,180,255,0.6)', background: 'transparent', cursor: 'pointer' }}>{a}</button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Histórico */}
        {tab === 'historico' && (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Array.from({length: 12}, (_,i) => ({
              ts: `${String(8+i).padStart(2,'0')}:${String((i*13)%60).padStart(2,'0')}`,
              chip: `CHI-${String(i*7+1).padStart(3,'0')}`,
              cliente: CLIENTES[i%CLIENTES.length],
              acao: ['Resposta aprovada','Promoção enviada','Correção salva','Memória criada','Agendamento confirmado','Objeção resolvida','Canal alterado para voz','Feedback positivo','Follow-up automático','Campanha ativada','Memória editada','Resposta rejeitada'][i],
              canal: CANAIS[i%CANAIS.length],
            })).map((s,i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 5, background: 'rgba(0,15,35,0.4)', fontSize: 10 }}>
                <span style={{ color: 'rgba(100,130,160,0.4)', minWidth: 35 }}>{s.ts}</span>
                <Badge text={s.chip} color='#00B4FF'/>
                <span style={{ color: 'rgba(160,190,210,0.6)' }}>{s.cliente}</span>
                <span style={{ color: 'rgba(200,220,240,0.7)', flex: 1 }}>{s.acao}</span>
                <span>{CANAL_ICON[s.canal]}</span>
              </div>
            ))}
          </div>
        )}

        {/* Correções */}
        {tab === 'correcoes' && (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({length: 8}, (_,i) => ({
              original: `[Resposta original ${i+1}] Texto automático gerado pelo James antes da correção`,
              corrigido: `[Resposta corrigida ${i+1}] Versão ajustada pelo operador para melhorar precisão`,
              tipo: ['resposta','comportamento','fato'][i%3],
              chip: `CHI-${String(i*11+5).padStart(3,'0')}`, salvo: i < 6,
            })).map((c,i) => (
              <div key={i} style={{ padding: 12, background: 'rgba(0,15,35,0.5)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <Badge text={c.tipo} color='#fbbf24'/>
                  <Badge text={c.chip} color='#a78bfa'/>
                  {c.salvo && <Badge text='memória salva' color='#34d399'/>}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(240,80,80,0.6)', marginBottom: 4 }}>❌ {c.original}</div>
                <div style={{ fontSize: 11, color: 'rgba(52,211,153,0.8)' }}>✅ {c.corrigido}</div>
              </div>
            ))}
          </div>
        )}

        {/* Logs */}
        {tab === 'logs' && (
          <div style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 10 }}>
            {Array.from({length: 20}, (_,i) => ({
              ts: `2026-04-01T${String(8+Math.floor(i/3)).padStart(2,'0')}:${String((i*7)%60).padStart(2,'0')}:${String((i*11)%60).padStart(2,'0')}Z`,
              level: ['INFO','DEBUG','WARN','INFO','INFO','DEBUG'][i%6],
              msg: [
                'Chip CHI-023 iniciou ciclo de aprendizado',
                'Análise de agenda: 6 furos detectados — quarta 14h-17h',
                'RMS threshold atingido — enviando para Whisper',
                'Promoção P2 aprovada — enviando para fila de distribuição',
                'Memória MEM-041 criada via correção manual',
                'Chip CHI-087 entrou em modo alerta — heat 94%',
                'callBackendStream: 3 chunks enviados — 1.2s de resposta total',
                'Agendamento confirmado: Ana Souza — Beleza & Cia 14:00',
                'Canal alterado: texto → voz (indecisão detectada)',
                'Taxa de sucesso atualizada: 87% → 88%',
              ][i%10],
            })).map((log,i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.025)', flexWrap: 'wrap' }}>
                <span style={{ color: 'rgba(100,130,160,0.35)', minWidth: 190 }}>{log.ts}</span>
                <span style={{ minWidth: 40, color: log.level==='WARN'?'#fb923c':log.level==='DEBUG'?'rgba(100,130,160,0.4)':'rgba(52,211,153,0.6)', fontWeight: 600 }}>{log.level}</span>
                <span style={{ color: 'rgba(180,200,220,0.65)', flex: 1 }}>{log.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
