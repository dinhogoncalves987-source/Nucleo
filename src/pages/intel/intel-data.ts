// ── Types ─────────────────────────────────────────────────────────────────
export type ChannelType = 'whatsapp' | 'voz' | 'texto' | 'ligacao'
export type StatusType  = 'novo' | 'analisando' | 'aprovado' | 'corrigido' | 'convertido'
export type ChipStatus  = 'ativo' | 'aprendendo' | 'estavel' | 'avancado' | 'alerta' | 'quente'
export type TabKey      = 'whatsapp' | 'voz' | 'texto' | 'ligacao' | 'pendentes' | 'aprovados' | 'convertidos'
export type BottomTab   = 'memorias' | 'historico' | 'correcoes' | 'logs'

export interface InboxItem {
  id: string; cliente: string; estabelecimento: string; canal: ChannelType
  preview: string; hora: string; status: StatusType
}
export interface ChatMsg {
  id: string; role: 'user'|'james'; texto: string; canal: ChannelType
  ts: string; chip?: string; tempo?: number; confianca?: number; tipo?: string
  feedback?: 'ok' | 'erro' | null
}
export interface Chip {
  id: string; nome: string; status: ChipStatus; learn: number; conv: number
  promo: number; recov: number; health: number; heat: number; ultima: string
  estab: string
}
export interface AgendaOp {
  dia: string; horario: string; furos: number; profissional: string
  publico: string; promocao: string; tipo: string; chance: number
}
export interface Promotion {
  id: string; titulo: string; status: 'pendente'|'aprovado'|'ativo'
  publico: string; canal: ChannelType; impactados: number; resposta: number; agend: number
}
export interface Memory {
  id: string; tipo: string; input: string; output: string
  tags: string; prioridade: number; origem: string; uso: number; taxa: number
}
export interface IntelMetrics {
  chipsAtivos: number; emTreino: number; conversasHoje: number; taxaSucesso: number
  objetosResolvidos: number; furosDetectados: number; furosConvertidos: number
  promocoesSugeridas: number; promocoesAprovadas: number; clientesImpactados: number
  agendamentosGerados: number; receitaPotencial: number
}

// ── Constants ─────────────────────────────────────────────────────────────
export const ESTABS = ['Beleza & Cia - SP','Studio Hair - RJ','Nail Art Center - MG','Top Style - BA','Glamour Space - PR']
export const CLIENTES = ['Ana Souza','Mariana Costa','Patrícia Lima','Fernanda Rocha','Juliana Alves','Camila Torres','Beatriz Nunes','Larissa Pinto']
export const CANAIS: ChannelType[] = ['whatsapp','voz','texto','ligacao']

export const CHIP_STATUS_COLOR: Record<ChipStatus, string> = {
  ativo:'#00B4FF', aprendendo:'#a78bfa', estavel:'#34d399',
  avancado:'#fbbf24', alerta:'#f87171', quente:'#fb923c',
}
export const CANAL_ICON: Record<string, string> = {
  whatsapp:'💬', voz:'🎤', texto:'📝', ligacao:'📞',
}
export const STATUS_COLOR: Record<StatusType, string> = {
  novo:'text-cyan-400 bg-cyan-900/30 border-cyan-700/40',
  analisando:'text-purple-400 bg-purple-900/30 border-purple-700/40',
  aprovado:'text-emerald-400 bg-emerald-900/30 border-emerald-700/40',
  corrigido:'text-amber-400 bg-amber-900/30 border-amber-700/40',
  convertido:'text-blue-300 bg-blue-900/30 border-blue-700/40',
}

// ── Mock Data Factories ───────────────────────────────────────────────────
export function makeInbox(): InboxItem[] {
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

export function makeChips(): Chip[] {
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

export function makeAgenda(): AgendaOp[] {
  return [
    {dia:'Terça',horario:'10:00-12:00',furos:4,profissional:'Gisele',publico:'Clientes inativos >30d',promocao:'15% off escova + trat.',tipo:'desconto',chance:78},
    {dia:'Quarta',horario:'14:00-17:00',furos:6,profissional:'Tatiane',publico:'Fãs de manicure',promocao:'Combo manicure + pedicure',tipo:'combo',chance:84},
    {dia:'Quinta',horario:'09:00-11:00',furos:3,profissional:'Roberta',publico:'VIP clients',promocao:'Cashback R$30 em facial',tipo:'cashback',chance:91},
    {dia:'Sexta',horario:'15:00-18:00',furos:5,profissional:'Amanda',publico:'Clientes de aniversário',promocao:'Hidratação grátis no aniversário',tipo:'fidelidade',chance:72},
    {dia:'Sábado',horario:'08:00-10:00',furos:2,profissional:'Priscila',publico:'Novos clientes',promocao:'1ª visita: 20% desconto',tipo:'captação',chance:65},
  ]
}

export function makePromos(): Promotion[] {
  return [
    {id:'P1',titulo:'Combo Anti-Queda + Hidratação',status:'ativo',publico:'Clientes 45d sem visita',canal:'whatsapp',impactados:142,resposta:68,agend:44},
    {id:'P2',titulo:'Terça do Bem-Estar',status:'ativo',publico:'Clientes ociosos terça',canal:'voz',impactados:89,resposta:51,agend:29},
    {id:'P3',titulo:'Cashback Dark Friday',status:'aprovado',publico:'All-Base',canal:'texto',impactados:380,resposta:72,agend:61},
    {id:'P4',titulo:'Manicure Flash Quinta',status:'pendente',publico:'Manicure addicts',canal:'ligacao',impactados:0,resposta:0,agend:0},
    {id:'P5',titulo:'Escova VIP Sáb Manhã',status:'pendente',publico:'VIPs inativas',canal:'whatsapp',impactados:0,resposta:0,agend:0},
  ]
}

export function makeMemories(): Memory[] {
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

export function makeInitialMetrics(): IntelMetrics {
  return {
    chipsAtivos: 97, emTreino: 14, conversasHoje: 348, taxaSucesso: 87,
    objetosResolvidos: 62, furosDetectados: 28, furosConvertidos: 19,
    promocoesSugeridas: 11, promocoesAprovadas: 7, clientesImpactados: 2840,
    agendamentosGerados: 89, receitaPotencial: 18400,
  }
}
