import { useState, useEffect, useRef } from 'react'
import {
  Zap, Send, MessageSquare, Plus, Trash2, CheckCircle2,
  Clock, AlertTriangle, RefreshCw, Phone, ChevronDown, ChevronUp,
  Sparkles, Copy, ExternalLink,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/TenantContext'
import { supabase } from '../lib/supabase'
import { BubbleAgendamentos, BubbleClientes, type BubbleClient } from '../lib/bubble'
import { generateRescueMessage } from '../lib/openai'
import { getOrCreateAffiliate, generateAffiliateLink } from '../lib/affiliates'
import type { Campaign } from '../types'

// ─── Absent Client Card ──────────────────────────────────────────────────────
interface AbsentClientCardProps {
  client: BubbleClient
  diasAusente: number
  affiliateLink?: string  // link carimbado do salão para incluir na mensagem
}

function AbsentClientCard({ client, diasAusente, affiliateLink }: AbsentClientCardProps) {
  const [open, setOpen] = useState(false)
  const [msgText, setMsgText] = useState('')
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)

  const nome = (client.nome ?? `${client['First Name'] ?? ''} ${client['Last Name'] ?? ''}`.trim()) || 'Cliente'
  const tel = String(client.telefone ?? client['Phone'] ?? client['Telefone'] ?? client['whatsapp'] ?? '')
  const waLink = tel ? `https://wa.me/55${tel.replace(/\D/g, '')}` : null

  const handleCopy = () => {
    if (textRef.current?.value) {
      navigator.clipboard.writeText(textRef.current.value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleCopyLink = () => {
    if (affiliateLink) {
      navigator.clipboard.writeText(affiliateLink)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    }
  }

  const handleGenerateAI = async () => {
    setAiLoading(true)
    setAiError('')
    try {
      // Passa o link de afiliado para James incluir na mensagem
      const msg = await generateRescueMessage(nome, diasAusente, 'o salão', affiliateLink)
      setMsgText(msg)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Erro ao gerar mensagem')
    }
    setAiLoading(false)
  }

  const templateMsg = `Olá ${nome}! 🌸 Sentimos sua falta no salão! Que tal renovar aquele visual? Temos horários disponíveis essa semana. Chama a gente!`

  return (
    <div className="rounded-2xl overflow-hidden animate-fade-in"
      style={{ border: '1px solid var(--border)', background: 'var(--surface-card)' }}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ background: 'var(--gradient-accent)', color: '#fff' }}>
            {nome.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>{nome}</p>
            <div className="flex items-center gap-2">
              {tel ? (
                <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <Phone size={10} /> {tel}
                </p>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem telefone</p>
              )}
              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: 'rgba(251,146,60,0.15)', color: '#ea580c' }}>
                +{diasAusente}d
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {waLink && (
            <a href={waLink} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold"
              style={{ background: 'rgba(37,211,102,0.12)', color: '#16a34a', border: '1px solid rgba(37,211,102,0.25)' }}>
              <Phone size={11} /> WhatsApp
            </a>
          )}
          <button onClick={() => setOpen(p => !p)}
            className="flex items-center gap-1.5 btn-primary py-1.5 px-3 text-xs">
            <Sparkles size={11} />
            Resgatar
            {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* Rescue message panel */}
      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="pt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold" style={{ color: 'var(--text-main)' }}>
                ✏️ Mensagem de Resgate
              </p>
              <a href="https://chat.openai.com" target="_blank" rel="noopener noreferrer"
                className="text-xs flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                <ExternalLink size={11} /> ChatGPT
              </a>
            </div>

            <textarea
              ref={textRef}
              className="input-field text-sm mb-2"
              rows={4}
              placeholder={templateMsg}
              value={msgText}
              onChange={e => setMsgText(e.target.value)}
            />

            {aiError && (
              <p className="text-xs mb-2 px-1" style={{ color: '#dc2626' }}>⚠️ {aiError}</p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {/* IA button */}
              <button
                onClick={handleGenerateAI}
                disabled={aiLoading}
                className="btn-primary text-xs gap-1.5 py-1.5 px-3">
                {aiLoading
                  ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Gerando...</>
                  : <><Sparkles size={11} /> Gerar com IA</>}
              </button>

              <button
                onClick={() => setMsgText(templateMsg)}
                className="btn-secondary text-xs gap-1.5 py-1.5">
                Template
              </button>

              <button
                onClick={handleCopy}
                disabled={!msgText}
                className={`text-xs gap-1.5 py-1.5 px-3 rounded-xl font-semibold flex items-center ${!msgText ? 'opacity-40 cursor-not-allowed' : ''}`}
                style={{ background: copied ? 'rgba(16,185,129,0.1)' : 'var(--surface-hover)', color: copied ? '#059669' : 'var(--text-muted)', border: '1px solid var(--border)' }}>
                <Copy size={11} /> {copied ? 'Copiado!' : 'Copiar'}
              </button>

              {/* Link de afiliado carimbado */}
              {affiliateLink && (
                <button
                  onClick={handleCopyLink}
                  className="text-xs gap-1.5 py-1.5 px-3 rounded-xl font-semibold flex items-center"
                  style={{ background: linkCopied ? 'rgba(16,185,129,0.1)' : 'rgba(194,24,91,0.07)', color: linkCopied ? '#059669' : 'var(--accent)', border: '1px solid rgba(194,24,91,0.2)' }}>
                  <Copy size={11} /> {linkCopied ? 'Link copiado!' : '📎 Link Afiliado'}
                </button>
              )}

              {waLink && msgText && (
                <a href={`${waLink}?text=${encodeURIComponent(msgText)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="btn-primary text-xs gap-1.5 py-1.5 px-3 ml-auto">
                  <Send size={11} /> Enviar via WhatsApp
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Activations() {
  const { tenant } = useTenant()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newCampaign, setNewCampaign] = useState({ message_template: '', send_interval_minutes: 5 })
  const [creating, setCreating] = useState(false)
  const [running, setRunning] = useState<string | null>(null)

  // Ausentes
  const [ausentesLoading, setAusentesLoading] = useState(false)
  const [ausentes, setAusentes] = useState<{ client: BubbleClient; dias: number }[]>([])
  const [ausentesDias, setAusentesDias] = useState(30)
  const [didLoad, setDidLoad] = useState(false)
  const [bubbleError, setBubbleError] = useState<string | null>(null)
  const [affiliateLink, setAffiliateLink] = useState<string | undefined>(undefined)

  useEffect(() => { if (tenant?.id) fetchCampaigns() }, [tenant])

  // Gera link de afiliado do tenant
  useEffect(() => {
    if (!tenant?.id) return
    // Gera link de afiliado carimbado para esse tenant
    getOrCreateAffiliate(tenant.id, tenant.name).then(aff => {
      if (aff) setAffiliateLink(generateAffiliateLink(aff.slug))
    })
  }, [tenant?.id])

  const fetchCampaigns = async () => {
    setLoading(true)
    const { data } = await supabase.from('campaigns').select('*')
      .eq('tenant_id', tenant!.id).order('created_at', { ascending: false })
    if (data) setCampaigns(data as Campaign[])
    setLoading(false)
  }

  const fetchAusentes = async () => {
    setAusentesLoading(true)
    setDidLoad(true)
    setBubbleError(null)
    try {
      // 1) Buscar todos os clientes e todos os agendamentos em paralelo
      const [todosClientes, agendamentos] = await Promise.all([
        BubbleClientes.list(500),
        BubbleAgendamentos.list(500).catch(() => [] as Awaited<ReturnType<typeof BubbleAgendamentos.list>>),
      ])

      if (todosClientes.length === 0) {
        setBubbleError('Não foi possível carregar clientes do Bubble. Verifique se a Data API está habilitada para "clientes".')
        setAusentesLoading(false)
        return
      }

      const corte = new Date()
      corte.setDate(corte.getDate() - ausentesDias)

      // 2) Último agendamento por clienteID
      const ultimoPorCliente: Record<string, Date> = {}
      agendamentos.forEach(ag => {
        const raw = ag['Data e Hora'] ?? ag.data ?? ag['Hora'] ?? ag['Created Date']
        const dataAg = new Date(String(raw ?? ''))
        const clientId = String(ag.cliente ?? ag['Cliente'] ?? ag.client ?? '')
        if (!clientId || isNaN(dataAg.getTime())) return
        if (!ultimoPorCliente[clientId] || dataAg > ultimoPorCliente[clientId]) {
          ultimoPorCliente[clientId] = dataAg
        }
      })

      // 3) Ausentes = nunca agendaram OU último agendamento foi antes do corte
      const result: { client: (typeof todosClientes)[number]; dias: number }[] = []

      todosClientes.forEach(cliente => {
        const ultima = ultimoPorCliente[cliente._id]
        if (!ultima) {
          // Nunca agendou → ausente pelo tempo de criação do cadastro
          const criado = new Date(cliente['Created Date'])
          const diasDesde = Math.floor((Date.now() - criado.getTime()) / 86_400_000)
          if (diasDesde >= ausentesDias) {
            result.push({ client: cliente, dias: diasDesde })
          }
        } else if (ultima < corte) {
          // Já agendou mas não volta há muito tempo
          const dias = Math.floor((Date.now() - ultima.getTime()) / 86_400_000)
          result.push({ client: cliente, dias })
        }
      })

      setAusentes(result.sort((a, b) => b.dias - a.dias))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setBubbleError(`Erro ao acessar o Bubble: ${msg}`)
    }
    setAusentesLoading(false)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCampaign.message_template.trim()) return
    setCreating(true)
    const { data } = await supabase.from('campaigns')
      .insert({ ...newCampaign, tenant_id: tenant!.id }).select().single()
    if (data) setCampaigns(prev => [data as Campaign, ...prev])
    setNewCampaign({ message_template: '', send_interval_minutes: 5 })
    setShowForm(false)
    setCreating(false)
  }

  const handleDelete = async (id: string) => {
    await supabase.from('campaigns').delete().eq('id', id)
    setCampaigns(prev => prev.filter(c => c.id !== id))
  }

  return (
    <AppLayout title="Viralizador" subtitle="Campanhas de WhatsApp + Retenção de Clientes">
      <div className="flex flex-col gap-4">

        {/* ── Clientes Ausentes ─────────────────────────────────────────── */}
        <div className="card">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div>
              <p className="section-title flex items-center gap-2">
                <AlertTriangle size={16} style={{ color: 'var(--gold)' }} />
                Clientes Ausentes
              </p>
              <p className="section-subtitle">Detectado via agenda do Bubble · Nome + WhatsApp</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  Dias sem retorno:
                </label>
                <input type="number" className="input-field w-20 py-1.5 text-sm text-center"
                  min={7} max={365} value={ausentesDias}
                  onChange={e => setAusentesDias(parseInt(e.target.value))} />
              </div>
              <button onClick={fetchAusentes} disabled={ausentesLoading}
                className="btn-gold gap-2">
                {ausentesLoading
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><RefreshCw size={13} /> Detectar Ausentes</>}
              </button>
            </div>
          </div>

          {!didLoad && (
            <div className="text-center py-10">
              <AlertTriangle size={32} className="mx-auto mb-3 opacity-30" style={{ color: 'var(--gold)' }} />
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-main)' }}>
                Detecção de clientes ausentes
              </p>
              <p className="text-xs max-w-xs mx-auto" style={{ color: 'var(--text-muted)' }}>
                Clique em "Detectar Ausentes" para buscar na agenda do Bubble os clientes que não agendaram nos últimos {ausentesDias} dias.
              </p>
            </div>
          )}

          {bubbleError && (
            <div className="p-4 rounded-xl mb-2" style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.18)' }}>
              <p className="text-sm font-semibold mb-1" style={{ color: '#dc2626' }}>⚠️ Configuração necessária no Bubble</p>
              <p className="text-xs mb-2" style={{ color: '#dc2626' }}>{bubbleError}</p>
              <p className="text-xs mb-3 font-medium" style={{ color: 'var(--text-muted)' }}>
                No Bubble: Settings → API → Habilitar API de Dados → marcar ✅ <strong>clientes</strong> e <strong>agendamento</strong> → Implantar
              </p>
                <button
                  onClick={() => {
                    // SIMULATION: fallback demo para validar a interface sem depender do Bubble
                    setBubbleError(null)
                    setDidLoad(true)
                    setAusentes([
                    { client: { _id: 'demo1', nome: 'Ana Silva', telefone: '11987654321', 'Created Date': new Date(Date.now() - 45*86400000).toISOString(), 'First Name': 'Ana' }, dias: 45 },
                    { client: { _id: 'demo2', nome: 'Maria Souza', telefone: '11976543210', 'Created Date': new Date(Date.now() - 62*86400000).toISOString(), 'First Name': 'Maria' }, dias: 62 },
                    { client: { _id: 'demo3', nome: 'Juliana Costa', telefone: '11965432109', 'Created Date': new Date(Date.now() - 38*86400000).toISOString(), 'First Name': 'Juliana' }, dias: 38 },
                  ])
                }}
                className="btn-primary text-xs gap-1.5 py-1.5 px-4">
                <Sparkles size={11} /> Testar IA com clientes demo
              </button>
            </div>
          )}

          {ausentesLoading && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className="w-7 h-7 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Consultando agenda do Bubble...</p>
            </div>
          )}

          {didLoad && !ausentesLoading && !bubbleError && ausentes.length === 0 && (
            <div className="flex items-center gap-3 p-4 rounded-xl"
              style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <CheckCircle2 size={20} style={{ color: '#10b981' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: '#10b981' }}>Todos os clientes estão ativos!</p>
                <p className="text-xs" style={{ color: '#10b981', opacity: 0.7 }}>Nenhum cliente ausente nos últimos {ausentesDias} dias.</p>
              </div>
            </div>
          )}

          {ausentes.length > 0 && !ausentesLoading && (
            <>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                <p className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>
                  {ausentes.length} cliente(s) para reativar — clique em "Resgatar" para enviar uma mensagem
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {ausentes.map(({ client, dias }) => (
                  <AbsentClientCard key={client._id} client={client} diasAusente={dias} affiliateLink={affiliateLink} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Campanhas ─────────────────────────────────────────────────── */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="section-title flex items-center gap-2">
                <Zap size={16} style={{ color: 'var(--accent)' }} /> Campanhas em Massa
              </p>
              <p className="section-subtitle">{campaigns.length} campanha(s) ativa(s)</p>
            </div>
            <button onClick={() => setShowForm(!showForm)} className="btn-primary gap-2">
              <Plus size={14} /> Nova Campanha
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleCreate}
              className="card mb-4 animate-fade-in" style={{ background: 'var(--surface-hover)', boxShadow: 'none' }}>
              <label className="label">Mensagem Template</label>
              <textarea className="input-field mb-3" rows={4}
                placeholder="Olá {nome}! Sentimos sua falta... Que tal agendar um horário?"
                value={newCampaign.message_template}
                onChange={e => setNewCampaign(p => ({ ...p, message_template: e.target.value }))} required />
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label">Intervalo (min)</label>
                  <input type="number" className="input-field" min={1} max={60}
                    value={newCampaign.send_interval_minutes}
                    onChange={e => setNewCampaign(p => ({ ...p, send_interval_minutes: parseInt(e.target.value) }))} />
                </div>
                <div className="flex items-end gap-2">
                  <button type="submit" disabled={creating} className="btn-primary h-[46px] gap-2">
                    {creating
                      ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <><MessageSquare size={14} /> Salvar</>}
                  </button>
                  <button type="button" onClick={() => setShowForm(false)} className="btn-secondary h-[46px]">Cancelar</button>
                </div>
              </div>
            </form>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10">
              <MessageSquare size={32} className="opacity-20" style={{ color: 'var(--accent)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nenhuma campanha ainda. Crie a primeira!</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {campaigns.map(c => (
                <div key={c.id} className="p-4 rounded-xl"
                  style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-sm flex-1" style={{ color: 'var(--text-main)', lineHeight: 1.5 }}>
                      {c.message_template.slice(0, 120)}{c.message_template.length > 120 ? '...' : ''}
                    </p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => { setRunning(c.id); setTimeout(() => setRunning(null), 3000) }}
                        className={running === c.id
                          ? 'inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold'
                          : 'btn-primary gap-1.5 py-1.5 px-3 text-xs'}
                        style={running === c.id ? { background: 'rgba(16,185,129,0.1)', color: '#059669', border: '1px solid rgba(16,185,129,0.25)' } : {}}>
                        {running === c.id
                          ? <><div className="w-3 h-3 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /> Enviando...</>
                          : <><Send size={12} /> Disparar</>}
                      </button>
                      <button onClick={() => handleDelete(c.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#dc2626'; (e.currentTarget as HTMLElement).style.background = 'rgba(220,38,38,0.08)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                    <Clock size={11} /> {c.send_interval_minutes}min entre envios
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
