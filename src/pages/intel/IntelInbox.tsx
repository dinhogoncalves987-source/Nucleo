// ════════════════════════════════════════════════════════════════════════════
// IntelInbox.tsx — Inbox multicanal + Chat + Inspeção
// Rota: /intel/inbox
// ════════════════════════════════════════════════════════════════════════════
import { useState, useRef, useEffect, useCallback } from 'react'
import AppLayout from '../../components/AppLayout'
import {
  BackButton, Badge, SectionHeader,
} from './intel-shared'
import {
  makeInbox, CANAL_ICON, STATUS_COLOR,
  type InboxItem, type ChatMsg, type TabKey, type ChannelType,
} from './intel-data'
import { INTEL_CSS, colStyle, secHeadStyle, tabBtnStyle } from './intel-styles'

export default function IntelInbox() {
  const [inbox] = useState<InboxItem[]>(makeInbox)
  const [activeTab, setActiveTab] = useState<TabKey>('whatsapp')
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null)
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    { id: '1', role: 'james', texto: 'Central de Inteligência ativa. Monitorando 100 chips. Pronto para operar.', canal: 'texto', ts: '09:00', chip: 'CHI-001', tempo: 142, confianca: 98, tipo: 'inicialização' },
  ])
  const [chatInput, setChatInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMsgs])

  const sendChat = useCallback(async () => {
    if (!chatInput.trim()) return
    const userMsg: ChatMsg = {
      id: Date.now().toString(), role: 'user', texto: chatInput, canal: 'texto',
      ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    }
    setChatMsgs(m => [...m, userMsg])
    setChatInput(''); setIsTyping(true)
    await new Promise(r => setTimeout(r, 900 + Math.random() * 600))
    const responses = [
      'Analisei os dados. Recomendo abordar via áudio — cliente com 47 dias sem visita.',
      'Chip CHI-023 processou requisição. Agenda de quarta com 6 furos identificados.',
      'Detectei padrão: clientes que cancelam na terça têm 3× mais chance de reagendar via ligação.',
      'Memória atualizada. Regra nova: desconto de 15% funciona melhor entre 14h-16h.',
      'Análise de funil: taxa de conversão subiu 12% após mensagem de voz personalizada.',
    ]
    const jamesMsg: ChatMsg = {
      id: (Date.now() + 1).toString(), role: 'james',
      texto: responses[Math.floor(Math.random() * responses.length)],
      canal: ['texto', 'voz', 'ligacao'][Math.floor(Math.random() * 3)] as ChannelType,
      ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      chip: `CHI-${String(Math.floor(Math.random() * 100) + 1).padStart(3, '0')}`,
      tempo: Math.floor(300 + Math.random() * 800),
      confianca: Math.floor(78 + Math.random() * 21),
      tipo: ['análise', 'decisão', 'recomendação', 'aprendizado'][Math.floor(Math.random() * 4)],
      feedback: null,
    }
    setIsTyping(false)
    setChatMsgs(m => [...m, jamesMsg])
  }, [chatInput])

  const filteredInbox = inbox.filter(i => {
    if (activeTab === 'pendentes') return ['novo', 'analisando'].includes(i.status)
    if (activeTab === 'aprovados') return i.status === 'aprovado'
    if (activeTab === 'convertidos') return i.status === 'convertido'
    return i.canal === activeTab
  })

  const copilotContext = {
    page: 'inbox' as const,
    data: {
      totalMsgs: inbox.length,
      pendentes: inbox.filter(i => ['novo', 'analisando'].includes(i.status)).length,
      aprovados: inbox.filter(i => i.status === 'aprovado').length,
      convertidos: inbox.filter(i => i.status === 'convertido').length,
      selectedCliente: selectedItem?.cliente ?? null,
    },
  }
  void copilotContext

  return (
    <AppLayout title="Inbox" subtitle="Interações multicanal — conversas, treino ao vivo e inspeção">
      <style>{INTEL_CSS}</style>
      <BackButton to="/intel" label="Intel Overview" />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 280px) 1fr minmax(240px, 280px)', gap: 10 }}>
        {/* ─── INBOX LIST ─── */}
        <div style={{ ...colStyle, height: 520 }}>
          <SectionHeader title="INBOX MULTICANAL" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 10px', borderBottom: '1px solid rgba(0,180,255,0.07)' }}>
            {(['whatsapp', 'voz', 'texto', 'ligacao', 'pendentes', 'aprovados', 'convertidos'] as TabKey[]).map(t => (
              <button key={t} style={tabBtnStyle(activeTab === t)} onClick={() => setActiveTab(t)}>
                {CANAL_ICON[t] || '📋'} {t}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {filteredInbox.map(item => (
              <div key={item.id} className="cc-row"
                onClick={() => setSelectedItem(item)}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  background: selectedItem?.id === item.id ? 'rgba(0,180,255,0.07)' : 'transparent',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: 'rgba(200,220,240,0.9)', fontWeight: 600 }}>{item.cliente}</span>
                  <span style={{ fontSize: 9, color: 'rgba(100,130,160,0.6)' }}>{item.hora}</span>
                </div>
                <div style={{ fontSize: 9, color: 'rgba(100,130,160,0.55)', marginBottom: 4 }}>{item.estabelecimento}</div>
                <div style={{ fontSize: 10, color: 'rgba(160,190,210,0.6)', marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.preview}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 9 }}>{CANAL_ICON[item.canal]}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_COLOR[item.status]}`} style={{ fontSize: 9 }}>{item.status}</span>
                </div>
              </div>
            ))}
            {filteredInbox.length === 0 && <div style={{ textAlign: 'center', padding: 24, color: 'rgba(100,130,160,0.4)', fontSize: 11 }}>Nenhum item</div>}
          </div>
        </div>

        {/* ─── CHAT ─── */}
        <div style={{ ...colStyle, height: 520 }}>
          <div style={secHeadStyle}>
            <span style={{ fontSize: 10, color: '#00B4FF', letterSpacing: '0.15em' }}>CONVERSA & TREINO</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {[{ c: '#4ade80', l: 'VAD' }, { c: '#00B4FF', l: 'Stream' }, { c: '#fbbf24', l: '97 chips' }].map(({ c, l }) => (
                <span key={l} style={{ fontSize: 9, color: c, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: c, boxShadow: `0 0 4px ${c}`, animation: 'cc-pulse 1.5s infinite', display: 'inline-block' }} /> {l}
                </span>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {chatMsgs.map(msg => (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', animation: 'cc-slide 0.2s ease-out' }}>
                <div style={{
                  maxWidth: '82%', padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                  background: msg.role === 'user' ? 'rgba(0,100,200,0.2)' : 'rgba(0,20,50,0.8)',
                  border: msg.role === 'user' ? '1px solid rgba(0,150,255,0.2)' : '1px solid rgba(0,180,255,0.12)',
                  color: msg.role === 'user' ? 'rgba(180,210,240,0.9)' : 'rgba(200,225,245,0.9)',
                }}>
                  {msg.texto}
                </div>
                {msg.role === 'james' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 8, color: 'rgba(100,130,160,0.5)' }}>{CANAL_ICON[msg.canal]} {msg.canal}</span>
                    {msg.chip && <span style={{ fontSize: 8, color: 'rgba(0,180,255,0.4)' }}>🔲 {msg.chip}</span>}
                    {msg.tempo && <span style={{ fontSize: 8, color: 'rgba(100,130,160,0.4)' }}>⚡ {msg.tempo}ms</span>}
                    {msg.confianca && <span style={{ fontSize: 8, color: 'rgba(251,191,36,0.5)' }}>🎯 {msg.confianca}%</span>}
                  </div>
                )}
              </div>
            ))}
            {isTyping && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: 'rgba(100,130,160,0.5)' }}>James processando</span>
                {[0, 1, 2].map(i => <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(0,180,255,0.6)', display: 'inline-block', animation: 'cc-pulse 1s infinite', animationDelay: `${i * 0.2}s` }} />)}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: 10, borderTop: '1px solid rgba(0,180,255,0.08)' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void sendChat()}
                placeholder="Digite uma instrução..."
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6, fontSize: 12,
                  background: 'rgba(0,20,50,0.8)', border: '1px solid rgba(0,180,255,0.18)',
                  color: 'rgba(200,220,240,0.9)', outline: 'none',
                }}
              />
              <button className="cc-btn" onClick={() => void sendChat()} style={{ padding: '8px 12px', borderRadius: 6, fontSize: 13, border: '1px solid rgba(0,180,255,0.25)', background: 'rgba(0,180,255,0.1)', color: '#00B4FF', cursor: 'pointer' }}>➤</button>
            </div>
          </div>
        </div>

        {/* ─── INSPECTION ─── */}
        <div style={{ ...colStyle, height: 520 }}>
          <SectionHeader title="INSPEÇÃO INTELIGENTE" />
          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            {selectedItem ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div><div style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Cliente</div><div style={{ fontSize: 13, color: 'rgba(200,225,245,0.9)', fontWeight: 700 }}>{selectedItem.cliente}</div></div>
                <div><div style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Estabelecimento</div><div style={{ fontSize: 11, color: 'rgba(160,190,210,0.7)' }}>{selectedItem.estabelecimento}</div></div>
                <div><div style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)', marginBottom: 3, textTransform: 'uppercase' }}>Conteúdo</div><div style={{ fontSize: 11, color: 'rgba(180,205,225,0.8)', padding: 8, background: 'rgba(0,20,50,0.6)', borderRadius: 5, border: '1px solid rgba(0,180,255,0.1)', lineHeight: 1.5 }}>{selectedItem.preview}</div></div>
                <div style={{ padding: 10, background: 'rgba(0,40,80,0.4)', borderRadius: 6, border: '1px solid rgba(0,180,255,0.15)' }}>
                  <div style={{ fontSize: 9, color: '#00B4FF', marginBottom: 6, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Decisão de Canal</div>
                  {[
                    { l: 'Canal', v: `${CANAL_ICON[selectedItem.canal]} ${selectedItem.canal}`, c: '#00B4FF' },
                    { l: 'Objetivo', v: 'Engajar + Converter', c: '#a78bfa' },
                    { l: 'Confiança', v: '84%', c: '#fbbf24' },
                  ].map(({ l, v, c }) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)' }}>{l}</span>
                      <span style={{ fontSize: 10, color: c }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)', marginBottom: 4, textTransform: 'uppercase' }}>Tags sugeridas</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {['reativação', 'promoção', 'horário-vago'].map(t => <Badge key={t} text={t} color='#a78bfa' />)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                  {[{ l: 'Aprovar', c: '#34d399' }, { l: 'Editar', c: '#fbbf24' }, { l: '→ Memória', c: '#00B4FF' }].map(({ l, c }) => (
                    <button key={l} className="cc-btn" style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, border: `1px solid ${c}40`, color: c, background: `${c}10`, cursor: 'pointer' }}>{l}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
                <div style={{ fontSize: 24, opacity: 0.3 }}>🔍</div>
                <div style={{ fontSize: 11, color: 'rgba(100,130,160,0.4)', textAlign: 'center' }}>Selecione uma interação<br />no inbox para inspecionar</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
