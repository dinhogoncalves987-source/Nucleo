// ════════════════════════════════════════════════════════════════════════════
// JamesCommandCenter.tsx — Central de Inteligência Operacional do James
// Rota: /james-learning-command-center
// PÁGINA ISOLADA — NÃO MODIFICA NENHUM ARQUIVO EXISTENTE
// ════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useCallback } from 'react'
import AppLayout from '../components/AppLayout'

// ── Types ─────────────────────────────────────────────────────────────────────
type ChannelType = 'whatsapp' | 'voz' | 'texto' | 'ligacao'
type StatusType  = 'novo' | 'analisando' | 'aprovado' | 'corrigido' | 'convertido'
type ChipStatus  = 'ativo' | 'aprendendo' | 'estavel' | 'avancado' | 'alerta' | 'quente'
type TabKey      = 'whatsapp' | 'voz' | 'texto' | 'ligacao' | 'pendentes' | 'aprovados' | 'convertidos'
type BottomTab   = 'memorias' | 'historico' | 'correcoes' | 'logs'


interface InboxItem {
  id: string; cliente: string; estabelecimento: string; canal: ChannelType
  preview: string; hora: string; status: StatusType
}
interface ChatMsg {
  id: string; role: 'user'|'james'; texto: string; canal: ChannelType
  ts: string; chip?: string; tempo?: number; confianca?: number; tipo?: string
  feedback?: 'ok' | 'erro' | null
}
interface Chip {
  id: string; nome: string; status: ChipStatus; learn: number; conv: number
  promo: number; recov: number; health: number; heat: number; ultima: string
  estab: string
}
interface AgendaOp {
  dia: string; horario: string; furos: number; profissional: string
  publico: string; promocao: string; tipo: string; chance: number
}
interface Promotion {
  id: string; titulo: string; status: 'pendente'|'aprovado'|'ativo'
  publico: string; canal: ChannelType; impactados: number; resposta: number; agend: number
}
interface Memory {
  id: string; tipo: string; input: string; output: string
  tags: string; prioridade: number; origem: string; uso: number; taxa: number
}

// ── Mock data factories ────────────────────────────────────────────────────────
const ESTABS = ['Beleza & Cia - SP', 'Studio Hair - RJ', 'Nail Art Center - MG', 'Top Style - BA', 'Glamour Space - PR']
const CLIENTES = ['Ana Souza', 'Mariana Costa', 'Patrícia Lima', 'Fernanda Rocha', 'Juliana Alves', 'Camila Torres', 'Beatriz Nunes', 'Larissa Pinto']
const CANAIS: ChannelType[] = ['whatsapp', 'voz', 'texto', 'ligacao']

function makeInbox(): InboxItem[] {
  const statuses: StatusType[] = ['novo','analisando','aprovado','corrigido','convertido']
  const previews = [
    'Oi! Quero remarcar meu horário de quinta...','Vocês têm promoção para coloração hoje?',
    'Me passa o valor do corte com escova?','Esqueci meu horário, pode confirmar?',
    'Boa tarde! Estou interessada no pacote facial','Tenho 3 horários vagos essa semana',
    'Cliente perguntou sobre o cashback','Promoção de manicure aprovada pelo gerente',
    'Janaina confirmou o agendamento','Resposta automática aprovada com correção',
  ]
  return Array.from({length: 18}, (_, i) => ({
    id: `inbox-${i}`, cliente: CLIENTES[i % CLIENTES.length],
    estabelecimento: ESTABS[i % ESTABS.length], canal: CANAIS[i % CANAIS.length],
    preview: previews[i % previews.length],
    hora: `${String(8 + Math.floor(i * 0.8)).padStart(2,'0')}:${String((i*7)%60).padStart(2,'0')}`,
    status: statuses[i % statuses.length],
  }))
}

function makeChips(): Chip[] {
  const statuses: ChipStatus[] = ['ativo','aprendendo','estavel','avancado','alerta','quente']
  return Array.from({length: 100}, (_, i) => ({
    id: `CHI-${String(i+1).padStart(3,'0')}`, nome: `Chip ${i+1}`,
    status: statuses[Math.floor(Math.random() * statuses.length)],
    learn:  Math.round(60 + Math.random() * 40), conv:  Math.round(50 + Math.random() * 50),
    promo:  Math.round(40 + Math.random() * 60), recov: Math.round(55 + Math.random() * 45),
    health: Math.round(70 + Math.random() * 30), heat:  Math.round(Math.random() * 100),
    ultima: `${Math.floor(Math.random() * 12)}h atrás`, estab: ESTABS[i % ESTABS.length],
  }))
}

function makeAgenda(): AgendaOp[] {
  return [
    {dia:'Terça',horario:'10:00-12:00',furos:4,profissional:'Gisele',publico:'Clientes inativos >30d',promocao:'15% off escova + trat.',tipo:'desconto',chance:78,},
    {dia:'Quarta',horario:'14:00-17:00',furos:6,profissional:'Tatiane',publico:'Fãs de manicure',promocao:'Combo manicure + pedicure',tipo:'combo',chance:84,},
    {dia:'Quinta',horario:'09:00-11:00',furos:3,profissional:'Roberta',publico:'VIP clients',promocao:'Cashback R$30 em facial',tipo:'cashback',chance:91,},
    {dia:'Sexta',horario:'15:00-18:00',furos:5,profissional:'Amanda',publico:'Clientes de aniversário',promocao:'Hidratação grátis no aniversário',tipo:'fidelidade',chance:72,},
    {dia:'Sábado',horario:'08:00-10:00',furos:2,profissional:'Priscila',publico:'Novos clientes',promocao:'1ª visita: 20% desconto',tipo:'captação',chance:65,},
  ]
}

function makePromos(): Promotion[] {
  return [
    {id:'P1',titulo:'Combo Anti-Queda + Hidratação',status:'ativo',publico:'Clientes 45d sem visita',canal:'whatsapp',impactados:142,resposta:68,agend:44},
    {id:'P2',titulo:'Terça do Bem-Estar',status:'ativo',publico:'Clientes ociosos terça',canal:'voz',impactados:89,resposta:51,agend:29},
    {id:'P3',titulo:'Cashback Dark Friday',status:'aprovado',publico:'All-Base',canal:'texto',impactados:380,resposta:72,agend:61},
    {id:'P4',titulo:'Manicure Flash Quinta',status:'pendente',publico:'Manicure addicts',canal:'ligacao',impactados:0,resposta:0,agend:0},
    {id:'P5',titulo:'Escova VIP Sáb Manhã',status:'pendente',publico:'VIPs inativas',canal:'whatsapp',impactados:0,resposta:0,agend:0},
  ]
}

function makeMemories(): Memory[] {
  const tipos = ['fact','response','behavior','correction']
  const tags = ['agenda','promocao','objecao','fidelidade','reativacao','cancelamento']
  return Array.from({length: 24}, (_, i) => ({
    id: `MEM-${i+1}`, tipo: tipos[i%tipos.length],
    input: `Pergunta/situação de contexto #${i+1}`,
    output: `Resposta ideal do James para o contexto ${i+1}`,
    tags: tags[i%tags.length], prioridade: Math.floor(6 + Math.random()*5),
    origem: ['simulador','correção','aprovação manual'][i%3],
    uso: Math.floor(Math.random()*90), taxa: Math.round(70 + Math.random()*30),
  }))
}

// ── Color maps ────────────────────────────────────────────────────────────────
const CHIP_STATUS_COLOR: Record<ChipStatus, string> = {
  ativo:      '#00B4FF', aprendendo: '#a78bfa', estavel: '#34d399',
  avancado:   '#fbbf24', alerta:     '#f87171', quente:  '#fb923c',
}
const CANAL_ICON: Record<ChannelType|string, string> = {
  whatsapp: '💬', voz: '🎤', texto: '📝', ligacao: '📞',
}
const STATUS_COLOR: Record<StatusType, string> = {
  novo:       'text-cyan-400 bg-cyan-900/30 border-cyan-700/40',
  analisando: 'text-purple-400 bg-purple-900/30 border-purple-700/40',
  aprovado:   'text-emerald-400 bg-emerald-900/30 border-emerald-700/40',
  corrigido:  'text-amber-400 bg-amber-900/30 border-amber-700/40',
  convertido: 'text-blue-300 bg-blue-900/30 border-blue-700/40',
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = '#00B4FF', pulse }: {
  label: string; value: string | number; sub?: string; color?: string; pulse?: boolean
}) {
  return (
    <div style={{
      background: 'rgba(0,20,40,0.6)', border: '1px solid rgba(0,180,255,0.12)',
      borderRadius: 8, padding: '10px 14px', minWidth: 100, position: 'relative',
      backdropFilter: 'blur(4px)',
    }}>
      {pulse && <span style={{
        position: 'absolute', top: 6, right: 8, width: 6, height: 6, borderRadius: '50%',
        background: color, boxShadow: `0 0 6px ${color}`,
        animation: 'cc-pulse 1.5s ease-in-out infinite',
      }}/>}
      <div style={{ fontSize: 10, color: 'rgba(120,160,200,0.7)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'rgba(100,140,180,0.5)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Badge({ text, color = '#00B4FF' }: { text: string; color?: string }) {
  return (
    <span style={{
      fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.1em',
      color, border: `1px solid ${color}40`, borderRadius: 3,
      padding: '1px 5px', textTransform: 'uppercase',
    }}>{text}</span>
  )
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 4, transition: 'width 0.5s' }}/>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function JamesCommandCenter() {
  // State
  const [inbox]         = useState<InboxItem[]>(makeInbox)
  const [chips]         = useState<Chip[]>(makeChips)
  const [agenda]        = useState<AgendaOp[]>(makeAgenda)
  const [promos]        = useState<Promotion[]>(makePromos)
  const [memories]      = useState<Memory[]>(makeMemories)
  const [activeTab,  setActiveTab]  = useState<TabKey>('whatsapp')
  const [bottomTab,  setBottomTab]  = useState<BottomTab>('memorias')
  const [chipFilter, setChipFilter] = useState<ChipStatus|'todos'>('todos')
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null)
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    {id:'1',role:'james',texto:'Central de Inteligência ativa. Monitorando 100 chips. Agenda analisada. Pronto para operar.',canal:'texto',ts:'09:00',chip:'CHI-001',tempo:142,confianca:98,tipo:'inicialização'},
  ])
  const [chatInput, setChatInput] = useState('')
  const [isTyping,  setIsTyping]  = useState(false)
  const [metrics, setMetrics] = useState({
    chipsAtivos: 97, emTreino: 14, conversasHoje: 348, taxaSucesso: 87,
    objetosResolvidos: 62, furosDetectados: 28, furosConvertidos: 19,
    promocoesSugeridas: 11, promocoesAprovadas: 7, clientesImpactados: 2840,
    agendamentosGerados: 89, receitaPotencial: 18400,
  })
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Live metrics simulation
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

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMsgs])

  const sendChat = useCallback(async () => {
    if (!chatInput.trim()) return
    const userMsg: ChatMsg = {
      id: Date.now().toString(), role: 'user', texto: chatInput, canal: 'texto',
      ts: new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}),
    }
    setChatMsgs(m => [...m, userMsg])
    setChatInput(''); setIsTyping(true)
    await new Promise(r => setTimeout(r, 900 + Math.random() * 600))
    const responses = [
      'Analisei os dados. Recomendo abordar via áudio — cliente com 47 dias sem visita, histórico de resposta baixo em texto.',
      'Chip CHI-023 processou requisição. Agenda de quarta com 6 furos identificados. Promoção de combo gerada automaticamente.',
      'Detectei padrão: clientes que cancelam na terça têm 3× mais chance de reagendar via ligação curta. Ação automática preparada.',
      'Memória atualizada. Regra nova: desconto de 15% funciona melhor entre 14h-16h para o público identificado.',
      'Análise de funil: taxa de conversão subiu 12% após implementação de mensagem de voz personalizada.',
    ]
    const jamesMsg: ChatMsg = {
      id: (Date.now()+1).toString(), role: 'james',
      texto: responses[Math.floor(Math.random() * responses.length)],
      canal: ['texto','voz','ligacao'][Math.floor(Math.random()*3)] as ChannelType,
      ts: new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}),
      chip: `CHI-${String(Math.floor(Math.random()*100)+1).padStart(3,'0')}`,
      tempo: Math.floor(300 + Math.random() * 800),
      confianca: Math.floor(78 + Math.random() * 21),
      tipo: ['análise','decisão','recomendação','aprendizado'][Math.floor(Math.random()*4)],
      feedback: null,
    }
    setIsTyping(false)
    setChatMsgs(m => [...m, jamesMsg])
  }, [chatInput])

  const filteredInbox = inbox.filter(i => {
    if (activeTab === 'pendentes')  return ['novo','analisando'].includes(i.status)
    if (activeTab === 'aprovados')  return i.status === 'aprovado'
    if (activeTab === 'convertidos') return i.status === 'convertido'
    return i.canal === activeTab
  })

  const filteredChips = chipFilter === 'todos' ? chips : chips.filter(c => c.status === chipFilter)

  // ── Styles ──────────────────────────────────────────────────────────────────
  const col = {
    background: 'rgba(0,10,24,0.7)', border: '1px solid rgba(0,180,255,0.1)',
    borderRadius: 10, display: 'flex', flexDirection: 'column' as const,
    overflow: 'hidden',
  }
  const secHead = {
    padding: '8px 14px', borderBottom: '1px solid rgba(0,180,255,0.1)',
    background: 'rgba(0,20,50,0.5)', display: 'flex', alignItems: 'center', gap: 8,
  }
  const tabBtn = (active: boolean) => ({
    padding: '4px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
    border: `1px solid ${active ? 'rgba(0,180,255,0.5)' : 'rgba(255,255,255,0.06)'}`,
    background: active ? 'rgba(0,180,255,0.12)' : 'transparent',
    color: active ? '#00B4FF' : 'rgba(120,160,200,0.5)', transition: 'all 0.2s',
  })

  return (
    <AppLayout title="James Command Center" subtitle="Central de Inteligência Operacional — aprendizado, comunicação e recuperação em tempo real">
      <style>{`
        @keyframes cc-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }
        @keyframes cc-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes cc-slide { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .cc-row:hover { background:rgba(0,180,255,0.04)!important; }
        .cc-btn { transition:all 0.15s; }
        .cc-btn:hover { filter:brightness(1.3); }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(0,180,255,0.2); border-radius:4px; }
      `}</style>

      {/* ═══ TOPO: KPI BAR ════════════════════════════════════════════════════ */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
        <KpiCard label="Chips ativos"     value={metrics.chipsAtivos}      color="#00B4FF" pulse />
        <KpiCard label="Em treino"        value={metrics.emTreino}          color="#a78bfa" pulse />
        <KpiCard label="Conversas hoje"   value={metrics.conversasHoje}     color="#34d399" pulse />
        <KpiCard label="Taxa de sucesso"  value={`${metrics.taxaSucesso}%`} color="#fbbf24" />
        <KpiCard label="Objeções resol."  value={metrics.objetosResolvidos} color="#34d399" />
        <KpiCard label="Furos detectados" value={metrics.furosDetectados}   color="#fb923c" />
        <KpiCard label="Furos convertidos" value={metrics.furosConvertidos} color="#00B4FF" />
        <KpiCard label="Promoções suger." value={metrics.promocoesSugeridas} color="#a78bfa" />
        <KpiCard label="Promoções aprov." value={metrics.promocoesAprovadas} color="#34d399" />
        <KpiCard label="Clientes impact." value={metrics.clientesImpactados.toLocaleString('pt-BR')} color="#fbbf24" pulse />
        <KpiCard label="Agendamentos"     value={metrics.agendamentosGerados} color="#00B4FF" pulse />
        <KpiCard label="Receita potenc."  value={`R$ ${(metrics.receitaPotencial/1000).toFixed(1)}k`} color="#34d399" sub="recuperada" />
      </div>

      {/* ═══ 3 COLUNAS PRINCIPAIS ══════════════════════════════════════════════ */}
      <div style={{ display:'grid', gridTemplateColumns:'280px 1fr 280px', gap:10, marginBottom:12 }}>

        {/* ─── COL ESQ: INBOX ──────────────────────────────────────────────── */}
        <div style={{ ...col, height:460 }}>
          <div style={secHead}>
            <span style={{ fontSize:10, color:'#00B4FF', letterSpacing:'0.15em' }}>INBOX MULTICANAL</span>
          </div>
          {/* Tabs */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:4, padding:'8px 10px', borderBottom:'1px solid rgba(0,180,255,0.07)' }}>
            {(['whatsapp','voz','texto','ligacao','pendentes','aprovados','convertidos'] as TabKey[]).map(t => (
              <button key={t} style={tabBtn(activeTab===t)} onClick={() => setActiveTab(t)}>
                {CANAL_ICON[t] || '📋'} {t}
              </button>
            ))}
          </div>
          {/* List */}
          <div style={{ flex:1, overflowY:'auto', padding:'4px 0' }}>
            {filteredInbox.map(item => (
              <div key={item.id} className="cc-row"
                onClick={() => setSelectedItem(item)}
                style={{
                  padding:'8px 12px', cursor:'pointer',
                  borderBottom:'1px solid rgba(255,255,255,0.03)',
                  background: selectedItem?.id === item.id ? 'rgba(0,180,255,0.07)' : 'transparent',
                }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontSize:11, color:'rgba(200,220,240,0.9)', fontWeight:600 }}>{item.cliente}</span>
                  <span style={{ fontSize:9, color:'rgba(100,130,160,0.6)' }}>{item.hora}</span>
                </div>
                <div style={{ fontSize:9, color:'rgba(100,130,160,0.55)', marginBottom:4 }}>{item.estabelecimento}</div>
                <div style={{ fontSize:10, color:'rgba(160,190,210,0.6)', marginBottom:5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {item.preview}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ fontSize:9 }}>{CANAL_ICON[item.canal]}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_COLOR[item.status]}`} style={{ fontSize:9 }}>{item.status}</span>
                  <div style={{ flex:1 }}/>
                  {['abrir','aprovar','converter'].map(a => (
                    <button key={a} className="cc-btn" style={{ fontSize:8, padding:'1px 5px', borderRadius:3, border:'1px solid rgba(0,180,255,0.25)', color:'rgba(0,180,255,0.7)', background:'transparent', cursor:'pointer' }}>{a}</button>
                  ))}
                </div>
              </div>
            ))}
            {filteredInbox.length === 0 && (
              <div style={{ textAlign:'center', padding:24, color:'rgba(100,130,160,0.4)', fontSize:11 }}>Nenhum item</div>
            )}
          </div>
        </div>

        {/* ─── COL CENTRAL: CHAT ───────────────────────────────────────────── */}
        <div style={{ ...col, height:460 }}>
          <div style={secHead}>
            <span style={{ fontSize:10, color:'#00B4FF', letterSpacing:'0.15em' }}>CONVERSA & TREINO AO VIVO</span>
            <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
              {[{c:'#4ade80',l:'VAD ativo'},{c:'#00B4FF',l:'Stream on'},{c:'#fbbf24',l:'97 chips'}].map(({c,l}) => (
                <span key={l} style={{ fontSize:9, color:c, display:'flex', alignItems:'center', gap:3 }}>
                  <span style={{ width:5,height:5,borderRadius:'50%',background:c,boxShadow:`0 0 4px ${c}`,animation:'cc-pulse 1.5s infinite',display:'inline-block',animationDelay:Math.random()+'s' }}/> {l}
                </span>
              ))}
            </div>
          </div>
          {/* Messages */}
          <div style={{ flex:1, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:10 }}>
            {chatMsgs.map(msg => (
              <div key={msg.id} style={{ display:'flex', flexDirection:'column', alignItems:msg.role==='user'?'flex-end':'flex-start', animation:'cc-slide 0.2s ease-out' }}>
                <div style={{
                  maxWidth:'82%', padding:'8px 12px', borderRadius:8, fontSize:12, lineHeight:1.5,
                  background: msg.role==='user'
                    ? 'rgba(0,100,200,0.2)' : 'rgba(0,20,50,0.8)',
                  border: msg.role==='user'
                    ? '1px solid rgba(0,150,255,0.2)' : '1px solid rgba(0,180,255,0.12)',
                  color: msg.role==='user' ? 'rgba(180,210,240,0.9)' : 'rgba(200,225,245,0.9)',
                }}>
                  {msg.texto}
                </div>
                {/* Metadata */}
                {msg.role === 'james' && (
                  <div style={{ display:'flex', gap:6, marginTop:4, flexWrap:'wrap' }}>
                    <span style={{ fontSize:8, color:'rgba(100,130,160,0.5)' }}>{CANAL_ICON[msg.canal]} {msg.canal}</span>
                    {msg.chip && <span style={{ fontSize:8, color:'rgba(0,180,255,0.4)' }}>🔲 {msg.chip}</span>}
                    {msg.tempo && <span style={{ fontSize:8, color:'rgba(100,130,160,0.4)' }}>⚡ {msg.tempo}ms</span>}
                    {msg.confianca && <span style={{ fontSize:8, color:'rgba(251,191,36,0.5)' }}>🎯 {msg.confianca}%</span>}
                    {msg.tipo && <span style={{ fontSize:8, color:'rgba(167,139,250,0.5)' }}>💡 {msg.tipo}</span>}
                  </div>
                )}
                {/* Feedback */}
                {msg.role === 'james' && msg.feedback === null && (
                  <div style={{ display:'flex', gap:4, marginTop:4 }}>
                    {[{l:'👍 Aprovar',c:'#34d399'},{l:'👎 Erro',c:'#f87171'},{l:'✍️ Corrigir',c:'#fbbf24'},{l:'💾 Memória',c:'#00B4FF'},{l:'📌 Regra',c:'#a78bfa'}].map(({l,c}) => (
                      <button key={l} className="cc-btn" style={{ fontSize:8, padding:'2px 6px', borderRadius:3, border:`1px solid ${c}40`, color:c, background:`${c}10`, cursor:'pointer' }}>{l}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isTyping && (
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:10, color:'rgba(100,130,160,0.5)' }}>James processando</span>
                {[0,1,2].map(i => <span key={i} style={{ width:5,height:5,borderRadius:'50%',background:'rgba(0,180,255,0.6)',display:'inline-block',animation:'cc-pulse 1s infinite',animationDelay:`${i*0.2}s` }}/>)}
              </div>
            )}
            <div ref={chatEndRef}/>
          </div>
          {/* Input */}
          <div style={{ padding:10, borderTop:'1px solid rgba(0,180,255,0.08)' }}>
            <div style={{ display:'flex', gap:6 }}>
              <input
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key==='Enter' && sendChat()}
                placeholder="Digite uma instrução ou pergunta para o James..."
                style={{
                  flex:1, padding:'8px 12px', borderRadius:6, fontSize:12,
                  background:'rgba(0,20,50,0.8)', border:'1px solid rgba(0,180,255,0.18)',
                  color:'rgba(200,220,240,0.9)', outline:'none',
                }}
              />
              {[{l:'➤',t:'Enviar'},{l:'🎤',t:'Voz'},{l:'⚡',t:'Simular'}].map(({l,t}) => (
                <button key={t} className="cc-btn" onClick={t==='Enviar'?sendChat:undefined} title={t}
                  style={{ padding:'8px 12px', borderRadius:6, fontSize:13, border:'1px solid rgba(0,180,255,0.25)', background:'rgba(0,180,255,0.1)', color:'#00B4FF', cursor:'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ─── COL DIR: INSPEÇÃO ───────────────────────────────────────────── */}
        <div style={{ ...col, height:460 }}>
          <div style={secHead}>
            <span style={{ fontSize:10, color:'#00B4FF', letterSpacing:'0.15em' }}>INSPEÇÃO INTELIGENTE</span>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:14 }}>
            {selectedItem ? (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <div>
                  <div style={{ fontSize:9, color:'rgba(100,130,160,0.5)', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.1em' }}>Cliente</div>
                  <div style={{ fontSize:13, color:'rgba(200,225,245,0.9)', fontWeight:700 }}>{selectedItem.cliente}</div>
                </div>
                <div>
                  <div style={{ fontSize:9, color:'rgba(100,130,160,0.5)', marginBottom:2, textTransform:'uppercase', letterSpacing:'0.1em' }}>Estabelecimento</div>
                  <div style={{ fontSize:11, color:'rgba(160,190,210,0.7)' }}>{selectedItem.estabelecimento}</div>
                </div>
                <div>
                  <div style={{ fontSize:9, color:'rgba(100,130,160,0.5)', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.1em' }}>Conteúdo</div>
                  <div style={{ fontSize:11, color:'rgba(180,205,225,0.8)', padding:8, background:'rgba(0,20,50,0.6)', borderRadius:5, border:'1px solid rgba(0,180,255,0.1)', lineHeight:1.5 }}>{selectedItem.preview}</div>
                </div>
                {/* Decisão de canal */}
                <div style={{ padding:10, background:'rgba(0,40,80,0.4)', borderRadius:6, border:'1px solid rgba(0,180,255,0.15)' }}>
                  <div style={{ fontSize:9, color:'#00B4FF', marginBottom:6, letterSpacing:'0.12em', textTransform:'uppercase' }}>Decisão de Canal</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    {[
                      {l:'Canal', v:`${CANAL_ICON[selectedItem.canal]} ${selectedItem.canal}`, c:'#00B4FF'},
                      {l:'Objetivo', v:'Engajar + Converter', c:'#a78bfa'},
                      {l:'Motivo', v:'Histórico de baixa resposta em texto', c:'rgba(160,190,210,0.7)'},
                      {l:'Confiança', v:'84%', c:'#fbbf24'},
                    ].map(({l,v,c}) => (
                      <div key={l} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                        <span style={{ fontSize:9, color:'rgba(100,130,160,0.5)' }}>{l}</span>
                        <span style={{ fontSize:10, color:c, textAlign:'right', maxWidth:'60%' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Tags & meta */}
                <div>
                  <div style={{ fontSize:9, color:'rgba(100,130,160,0.5)', marginBottom:4, textTransform:'uppercase' }}>Tags sugeridas</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                    {['reativação','promoção','horário-vago','alto-potencial'].map(t => (
                      <Badge key={t} text={t} color='#a78bfa'/>
                    ))}
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:4 }}>
                  {[{l:'Aprovar',c:'#34d399'},{l:'Editar',c:'#fbbf24'},{l:'→ Memória',c:'#00B4FF'},{l:'↗ Regra Global',c:'#a78bfa'},{l:'Ajustar Prio.',c:'#fb923c'}].map(({l,c}) => (
                    <button key={l} className="cc-btn" style={{ fontSize:10, padding:'4px 8px', borderRadius:4, border:`1px solid ${c}40`, color:c, background:`${c}10`, cursor:'pointer' }}>{l}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:8 }}>
                <div style={{ fontSize:24, opacity:0.3 }}>🔍</div>
                <div style={{ fontSize:11, color:'rgba(100,130,160,0.4)', textAlign:'center' }}>Selecione uma interação<br/>no inbox para inspecionar</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ CHIP MAP ═════════════════════════════════════════════════════════ */}
      <div style={{ ...col, marginBottom:12 }}>
        <div style={secHead}>
          <span style={{ fontSize:10, color:'#00B4FF', letterSpacing:'0.15em' }}>MAPA DOS 100 CHIPS</span>
          <div style={{ marginLeft:'auto', display:'flex', gap:4 }}>
            {(['todos','ativo','aprendendo','estavel','avancado','alerta','quente'] as Array<ChipStatus|'todos'>).map(s => (
              <button key={s} style={tabBtn(chipFilter===s)} onClick={() => setChipFilter(s)}>{s}</button>
            ))}
          </div>
        </div>
        <div style={{ padding:'10px 12px', display:'flex', flexWrap:'wrap', gap:4, maxHeight:180, overflowY:'auto' }}>
          {filteredChips.map(chip => (
            <div key={chip.id} title={`${chip.nome} · Learn:${chip.learn}% Conv:${chip.conv}% Heat:${chip.heat}%`}
              style={{
                padding:'4px 8px', borderRadius:5, fontSize:9, fontFamily:'monospace',
                background:'rgba(0,15,35,0.9)', border:`1px solid ${CHIP_STATUS_COLOR[chip.status]}30`,
                color: CHIP_STATUS_COLOR[chip.status], cursor:'default', minWidth:62,
              }}>
              <div style={{ marginBottom:2, fontWeight:700 }}>{chip.id}</div>
              <div style={{ opacity:0.6 }}>{chip.status}</div>
              <div style={{ marginTop:2, height:2, background:'rgba(255,255,255,0.06)', borderRadius:2, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${chip.health}%`, background:CHIP_STATUS_COLOR[chip.status], opacity:0.7 }}/>
              </div>
            </div>
          ))}
        </div>
        {/* Chip detail strip */}
        <div style={{ padding:'8px 14px', borderTop:'1px solid rgba(0,180,255,0.07)', display:'flex', gap:20, overflowX:'auto' }}>
          {(['learn','conv','promo','recov'] as Array<keyof Chip>).map(k => {
            const avg = Math.round(filteredChips.reduce((a,c) => a + (c[k] as number), 0) / Math.max(1, filteredChips.length))
            const colors: Record<string,string> = {learn:'#a78bfa',conv:'#34d399',promo:'#fbbf24',recov:'#00B4FF'}
            return (
              <div key={String(k)} style={{ display:'flex', flexDirection:'column', gap:3, minWidth:120 }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ fontSize:9, color:'rgba(100,130,160,0.5)', textTransform:'uppercase' }}>{k} score</span>
                  <span style={{ fontSize:9, color:colors[String(k)] }}>{avg}%</span>
                </div>
                <MiniBar value={avg} color={colors[String(k)]}/>
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══ ROW: AGENDA + PROMOÇÕES + CANAIS ════════════════════════════════ */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:12 }}>

        {/* Agenda */}
        <div style={{ ...col }}>
          <div style={secHead}>
            <span style={{ fontSize:10, color:'#fb923c', letterSpacing:'0.15em' }}>INTELIGÊNCIA DE AGENDA</span>
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            {agenda.map((a, i) => (
              <div key={i} className="cc-row" style={{ padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ fontSize:11, color:'rgba(200,220,240,0.9)', fontWeight:600 }}>{a.dia} · {a.horario}</span>
                  <span style={{ fontSize:10, color:'#fb923c', fontWeight:700 }}>{a.furos} furos</span>
                </div>
                <div style={{ fontSize:10, color:'rgba(160,190,210,0.6)', marginBottom:4 }}>👤 {a.profissional} · {a.publico}</div>
                <div style={{ fontSize:10, color:'rgba(200,225,245,0.75)', marginBottom:5 }}>🎯 {a.promocao}</div>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <Badge text={a.tipo} color='#fb923c'/>
                  <div style={{ flex:1 }}/>
                  <span style={{ fontSize:9, color:'#34d399' }}>{a.chance}% conversão</span>
                  <div style={{ width:50, height:3, background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${a.chance}%`, background:'#34d399' }}/>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Promoções */}
        <div style={{ ...col }}>
          <div style={secHead}>
            <span style={{ fontSize:10, color:'#fbbf24', letterSpacing:'0.15em' }}>MOTOR DE PROMOÇÕES</span>
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            {promos.map(p => (
              <div key={p.id} className="cc-row" style={{ padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontSize:11, color:'rgba(200,220,240,0.9)', fontWeight:600 }}>{p.titulo}</span>
                  <Badge text={p.status} color={p.status==='ativo'?'#34d399':p.status==='aprovado'?'#fbbf24':'#a78bfa'}/>
                </div>
                <div style={{ fontSize:10, color:'rgba(160,190,210,0.55)', marginBottom:6 }}>{CANAL_ICON[p.canal]} {p.publico}</div>
                {p.impactados > 0 && (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:4 }}>
                    {[{l:'Impactados',v:p.impactados,c:'#00B4FF'},{l:'Resposta',v:`${p.resposta}%`,c:'#34d399'},{l:'Agend.',v:`${p.agend}%`,c:'#fbbf24'}].map(({l,v,c}) => (
                      <div key={l} style={{ textAlign:'center' }}>
                        <div style={{ fontSize:13, fontWeight:700, color:c }}>{v}</div>
                        <div style={{ fontSize:8, color:'rgba(100,130,160,0.5)' }}>{l}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Canais */}
        <div style={{ ...col }}>
          <div style={secHead}>
            <span style={{ fontSize:10, color:'#34d399', letterSpacing:'0.15em' }}>MULTICANAL · DESEMPENHO</span>
          </div>
          <div style={{ padding:14, display:'flex', flexDirection:'column', gap:12 }}>
            {[
              { canal:'💬 WhatsApp', metrics:[{l:'Taxa resposta',v:72,c:'#34d399'},{l:'Conversão',v:44,c:'#00B4FF'}], aprendizado:'Funciona melhor para clientes recorrentes' },
              { canal:'🎤 Áudio', metrics:[{l:'Taxa escuta',v:81,c:'#a78bfa'},{l:'Resposta',v:67,c:'#34d399'}], aprendizado:'Performa +3× em clientes indecisos' },
              { canal:'📞 Ligação', metrics:[{l:'Atendimento',v:58,c:'#fbbf24'},{l:'Fechamento',v:49,c:'#34d399'}], aprendizado:'Converte mais em horários vagos' },
              { canal:'📝 Texto', metrics:[{l:'Taxa abertura',v:64,c:'#00B4FF'},{l:'Conversão',v:31,c:'#fb923c'}], aprendizado:'Ideal para informativos e lembretes' },
            ].map(({canal,metrics,aprendizado}) => (
              <div key={canal}>
                <div style={{ fontSize:11, color:'rgba(200,225,245,0.8)', marginBottom:6, fontWeight:600 }}>{canal}</div>
                {metrics.map(({l,v,c}) => (
                  <div key={l} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:9, color:'rgba(100,130,160,0.5)', minWidth:80 }}>{l}</span>
                    <MiniBar value={v} color={c}/>
                    <span style={{ fontSize:10, color:c, minWidth:28, textAlign:'right' }}>{v}%</span>
                  </div>
                ))}
                <div style={{ fontSize:9, color:'rgba(100,130,160,0.4)', fontStyle:'italic', marginTop:2 }}>💡 {aprendizado}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ ANALYTICS ════════════════════════════════════════════════════════ */}
      <div style={{ ...col, marginBottom:12 }}>
        <div style={secHead}>
          <span style={{ fontSize:10, color:'#a78bfa', letterSpacing:'0.15em' }}>ANALYTICS DE APRENDIZADO</span>
        </div>
        <div style={{ padding:14, display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:12 }}>
          {[
            { label:'Evolução chips', data:[42,51,58,63,71,79,84,89], color:'#a78bfa' },
            { label:'Situações difíceis', data:[28,35,41,38,52,58,64,71], color:'#f87171' },
            { label:'Memórias usadas', data:[120,180,240,310,390,445,520,610], max:800, color:'#00B4FF' },
            { label:'Erros recorrentes', data:[22,18,15,12,9,7,5,4], color:'#fb923c' },
            { label:'Campanhas efic.', data:[3,5,6,8,8,10,11,12], max:15, color:'#34d399' },
            { label:'Horários recup.', data:[4,7,11,14,17,19,22,25], max:30, color:'#fbbf24' },
          ].map(({ label, data, color, max: mx }) => {
            const maxVal = mx ?? Math.max(...data)
            return (
              <div key={label}>
                <div style={{ fontSize:9, color:'rgba(100,130,160,0.55)', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.08em' }}>{label}</div>
                <div style={{ display:'flex', alignItems:'flex-end', gap:3, height:52 }}>
                  {data.map((v, i) => (
                    <div key={i} style={{
                      flex:1, borderRadius:2,
                      height: `${Math.max(4,(v/maxVal)*100)}%`,
                      background: i === data.length-1 ? color : `${color}55`,
                      transition:'height 0.3s',
                    }}/>
                  ))}
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
                  <span style={{ fontSize:8, color:'rgba(100,130,160,0.35)' }}>7d atrás</span>
                  <span style={{ fontSize:9, color, fontWeight:700 }}>{data[data.length-1]}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══ BOTTOM TABS ══════════════════════════════════════════════════════ */}
      <div style={{ ...col }}>
        <div style={{ ...secHead, flexWrap:'wrap', gap:4 }}>
          {(['memorias','historico','correcoes','logs'] as BottomTab[]).map(t => (
            <button key={t} style={tabBtn(bottomTab===t)} onClick={() => setBottomTab(t)}>
              {t === 'memorias' ? '🧠' : t === 'historico' ? '📋' : t === 'correcoes' ? '✍️' : '📊'} {t}
            </button>
          ))}
        </div>
        <div style={{ maxHeight:240, overflowY:'auto' }}>
          {bottomTab === 'memorias' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ background:'rgba(0,20,50,0.6)' }}>
                  {['tipo','input','tags','prioridade','origem','uso','taxa sucesso','ações'].map(h => (
                    <th key={h} style={{ padding:'6px 12px', textAlign:'left', fontSize:9, color:'rgba(100,130,160,0.5)', textTransform:'uppercase', letterSpacing:'0.1em', borderBottom:'1px solid rgba(0,180,255,0.08)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {memories.slice(0,12).map(m => (
                  <tr key={m.id} className="cc-row" style={{ borderBottom:'1px solid rgba(255,255,255,0.025)' }}>
                    <td style={{ padding:'6px 12px' }}><Badge text={m.tipo} color={m.tipo==='fact'?'#00B4FF':m.tipo==='response'?'#a78bfa':m.tipo==='behavior'?'#fbbf24':'#34d399'}/></td>
                    <td style={{ padding:'6px 12px', color:'rgba(180,200,220,0.7)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.input}</td>
                    <td style={{ padding:'6px 12px' }}><Badge text={m.tags} color='#34d399'/></td>
                    <td style={{ padding:'6px 12px', color:'#fbbf24', fontWeight:700 }}>{m.prioridade}</td>
                    <td style={{ padding:'6px 12px', color:'rgba(130,160,190,0.5)' }}>{m.origem}</td>
                    <td style={{ padding:'6px 12px', color:'rgba(130,160,190,0.6)' }}>{m.uso}×</td>
                    <td style={{ padding:'6px 12px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                        <div style={{ width:40, height:3, background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${m.taxa}%`, background:'#34d399' }}/>
                        </div>
                        <span style={{ fontSize:9, color:'#34d399' }}>{m.taxa}%</span>
                      </div>
                    </td>
                    <td style={{ padding:'6px 12px' }}>
                      <div style={{ display:'flex', gap:3 }}>
                        {['editar','excluir'].map(a => (
                          <button key={a} className="cc-btn" style={{ fontSize:9, padding:'2px 6px', borderRadius:3, border:'1px solid rgba(0,180,255,0.2)', color:'rgba(0,180,255,0.6)', background:'transparent', cursor:'pointer' }}>{a}</button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {bottomTab === 'historico' && (
            <div style={{ padding:14, display:'flex', flexDirection:'column', gap:6 }}>
              {Array.from({length:8}, (_,i) => ({
                ts: `${String(8+i).padStart(2,'0')}:${String((i*13)%60).padStart(2,'0')}`,
                chip: `CHI-${String(i*7+1).padStart(3,'0')}`,
                cliente: CLIENTES[i%CLIENTES.length],
                acao: ['Resposta aprovada','Promoção enviada','Correção salva','Memória criada','Agendamento confirmado','Objeção resolvida','Canal alterado para voz','Feedback positivo'][i],
                canal: CANAIS[i%CANAIS.length],
              })).map((s,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'5px 8px', borderRadius:5, background:'rgba(0,15,35,0.4)', fontSize:10 }}>
                  <span style={{ color:'rgba(100,130,160,0.4)', minWidth:35 }}>{s.ts}</span>
                  <Badge text={s.chip} color='#00B4FF'/>
                  <span style={{ color:'rgba(160,190,210,0.6)' }}>{s.cliente}</span>
                  <span style={{ color:'rgba(200,220,240,0.7)' }}>{s.acao}</span>
                  <span style={{ marginLeft:'auto' }}>{CANAL_ICON[s.canal]}</span>
                </div>
              ))}
            </div>
          )}
          {bottomTab === 'correcoes' && (
            <div style={{ padding:14, display:'flex', flexDirection:'column', gap:8 }}>
              {Array.from({length:6}, (_,i) => ({
                original: `[Resposta original ${i+1}] Texto automático gerado pelo James antes da correção`,
                corrigido: `[Resposta corrigida ${i+1}] Versão ajustada pelo operador para melhorar precisão`,
                tipo: ['resposta','comportamento','fato'][i%3],
                chip: `CHI-${String(i*11+5).padStart(3,'0')}`, salvo: i < 4,
              })).map((c,i) => (
                <div key={i} style={{ padding:10, background:'rgba(0,15,35,0.5)', borderRadius:6, border:'1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display:'flex', gap:6, marginBottom:6 }}>
                    <Badge text={c.tipo} color='#fbbf24'/>
                    <Badge text={c.chip} color='#a78bfa'/>
                    {c.salvo && <Badge text='memória salva' color='#34d399'/>}
                  </div>
                  <div style={{ fontSize:10, color:'rgba(240,80,80,0.6)', marginBottom:3 }}>❌ {c.original}</div>
                  <div style={{ fontSize:10, color:'rgba(52,211,153,0.8)' }}>✅ {c.corrigido}</div>
                </div>
              ))}
            </div>
          )}
          {bottomTab === 'logs' && (
            <div style={{ padding:'10px 14px', fontFamily:'monospace', fontSize:10 }}>
              {Array.from({length:20}, (_,i) => ({
                ts: `2026-03-23T${String(8+Math.floor(i/3)).padStart(2,'0')}:${String((i*7)%60).padStart(2,'0')}:${String((i*11)%60).padStart(2,'0')}Z`,
                level: ['INFO','DEBUG','WARN','INFO','INFO','DEBUG'][i%6] as string,
                msg: [
                  'Chip CHI-023 iniciou ciclo de aprendizado',
                  'Análise de agenda: 6 furos detectados — quarta 14h-17h',
                  'RMS threshold atingido — enviando para Whisper',
                  'Promoção P2 aprovada — enviando para fila de distribuição',
                  'Memória MEM-041 criada via correção manual',
                  'Chip CHI-087 entrou em modo alerta — heat 94%',
                  'callBackendStream: 3 chunks enviados — 1.2s de resposta total',
                  'Agendamento confirmado: Ana Souza — Beleza & Cia 14:00',
                  'Canal alterado: texto → voz (indecisão detectada após 2 negativas)',
                  'Taxa de sucesso atualizada: 87% → 88%',
                ][i%10],
              })).map((log,i) => (
                <div key={i} style={{ display:'flex', gap:10, padding:'3px 0', borderBottom:'1px solid rgba(255,255,255,0.025)' }}>
                  <span style={{ color:'rgba(100,130,160,0.35)', minWidth:190 }}>{log.ts}</span>
                  <span style={{ minWidth:40, color: log.level==='WARN'?'#fb923c':log.level==='DEBUG'?'rgba(100,130,160,0.4)':'rgba(52,211,153,0.6)', fontWeight:600 }}>{log.level}</span>
                  <span style={{ color:'rgba(180,200,220,0.65)' }}>{log.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
