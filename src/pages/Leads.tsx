import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Search, Upload, CheckCircle2, XCircle, Clock, Filter,
  MapPin, Instagram, Trash2, Building2, Phone, Hash,
  Zap, Sparkles, Copy, CheckSquare, Square,
  Flame, Thermometer, Snowflake, ExternalLink, RefreshCw, ShieldCheck, StopCircle,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/tenant-context'
import { supabase } from '../lib/supabase'
import { generateBatchMessages } from '../lib/openai'
import type { Lead } from '../types'

// ─── DDD lookup ──────────────────────────────────────────────────────────────
const DDD_MAP: Record<string, string> = {
  'sp': '11', 'são paulo': '11', 'sao paulo': '11', 'campinas': '19', 'santos': '13',
  'rj': '21', 'rio de janeiro': '21', 'niterói': '21',
  'mg': '31', 'belo horizonte': '31', 'uberlândia': '34', 'juiz de fora': '32',
  'rs': '51', 'porto alegre': '51', 'caxias do sul': '54', 'farroupilha': '54',
  'pelotas': '53', 'novo hamburgo': '51', 'passo fundo': '54',
  'sc': '48', 'florianópolis': '48', 'florianopolis': '48', 'joinville': '47', 'blumenau': '47',
  'pr': '41', 'curitiba': '41', 'londrina': '43', 'maringá': '44',
  'go': '62', 'goiânia': '62', 'goiania': '62',
  'df': '61', 'brasília': '61', 'brasilia': '61',
  'ba': '71', 'salvador': '71', 'feira de santana': '75',
  'pe': '81', 'recife': '81', 'caruaru': '81',
  'ce': '85', 'fortaleza': '85',
  'am': '92', 'manaus': '92',
  'pa': '91', 'belém': '91', 'belem': '91',
  'mt': '65', 'cuiabá': '65', 'ms': '67', 'campo grande': '67',
  'rn': '84', 'natal': '84', 'al': '82', 'maceió': '82',
  'ma': '98', 'são luís': '98', 'pi': '86', 'teresina': '86',
  'pb': '83', 'joão pessoa': '83', 'se': '79', 'aracaju': '79',
  'es': '27', 'vitória': '27', 'ro': '69', 'to': '63', 'ac': '68', 'ap': '96', 'rr': '95',
}

function getDDD(location: string): string {
  const loc = location.toLowerCase().trim()
  const key = Object.keys(DDD_MAP).find(k => loc.includes(k))
  return key ? DDD_MAP[key] : '11'
}

// SIMULATION: gera telefones artificiais enquanto as capturas externas nao estao integradas de forma real
function generatePhone(ddd: string, i: number): string {
  const num1 = String(90000 + Math.floor(Math.random() * 9999) + i * 100).slice(0, 4)
  const num2 = String(1000 + Math.floor(Math.random() * 8999))
  return `(${ddd}) 9 ${num1}-${num2}`
}

// ─── Types ────────────────────────────────────────────────────────────────────
type TabId = 'maps' | 'instagram' | 'cnpj' | 'vcard'
type Temperature = 'all' | 'cold' | 'warm' | 'hot'

const TEMP_BY_SOURCE: Record<string, Temperature> = {
  maps: 'cold', instagram: 'warm', csv: 'hot', manual: 'hot',
}

const STATUS_BADGE: Record<Lead['status'], string> = {
  new: 'badge-muted', contacted: 'badge-warning', qualified: 'badge-success',
  converted: 'badge-success', lost: 'badge-danger',
}
const STATUS_LABEL: Record<Lead['status'], string> = {
  new: 'Novo', contacted: 'Contatado', qualified: 'Qualificado', converted: 'Convertido', lost: 'Perdido',
}
const VALIDATION_ICON: Record<Lead['validation_status'], React.ReactNode> = {
  valid:   <CheckCircle2 size={13} className="text-emerald-500" />,
  invalid: <XCircle size={13} className="text-red-500" />,
  pending: <Clock size={13} className="text-amber-500" />,
}
void STATUS_BADGE
void VALIDATION_ICON

// ─── Component ───────────────────────────────────────────────────────────────
export default function Leads() {
  const { tenant } = useTenant()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>('maps')
  const [temperature, setTemperature] = useState<Temperature>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [blitzing, setBlitzing] = useState(false)
  const [blitzResults, setBlitzResults] = useState<Record<string, string>>({})
  const [blitzOpen, setBlitzOpen] = useState(false)
  // Cadenciador de Segurança
  const [cadMinDelay, setCadMinDelay] = useState(15)
  const [cadMaxDelay, setCadMaxDelay] = useState(45)
  const [cadActive, setCadActive] = useState(false)
  const [cadCountdown, setCadCountdown] = useState(0)
  const [cadCurrentLead, setCadCurrentLead] = useState('')
  const [cadFired, setCadFired] = useState(0)
  const cadStopRef = useRef(false)

  // Maps
  const [scraperNiche, setScraperNiche] = useState('')
  const [scraperLocation, setScraperLocation] = useState('')
  const [scraping, setScraping] = useState(false)
  const [scraperError, setScraperError] = useState('')
  const [clearingLeads, setClearingLeads] = useState(false)

  // Instagram
  const [igTarget, setIgTarget] = useState('')
  const [igScraping, setIgScraping] = useState(false)

  // CNPJ
  const [cnpjCnae, setCnpjCnae] = useState('')
  const [cnpjCity, setCnpjCity] = useState('')
  const [cnpjScraping, setCnpjScraping] = useState(false)

  // vCard
  const fileRef = useRef<HTMLInputElement>(null)
  const tenantIdRef = useRef(tenant?.id)
  const leadsRequestRef = useRef(0)
  tenantIdRef.current = tenant?.id

  const fetchLeads = useCallback(async () => {
    const tenantId = tenantIdRef.current
    if (!tenantId) return
    const requestId = ++leadsRequestRef.current
    setLoading(true)
    const { data, error } = await supabase
      .from('leads').select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    if (
      leadsRequestRef.current !== requestId ||
      tenantIdRef.current !== tenantId
    ) return
    if (!error && data) setLeads(data as Lead[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchLeads()
    return () => { leadsRequestRef.current += 1 }
  }, [fetchLeads, tenant?.id])

  // Insere leads desduplicados por telefone (evita repetidos no banco)
  const insertDeduped = async (candidates: Omit<Lead, 'id' | 'created_at'>[]): Promise<{ inserted: number; skipped: number }> => {
    const phones = candidates.map(l => l.phone.replace(/\D/g, '')).filter(Boolean)
    void phones
    // Busca telefones já existentes
    const { data: existing } = await supabase
      .from('leads')
      .select('phone')
      .eq('tenant_id', tenant!.id)
    const existingPhones = new Set((existing ?? []).map((l: { phone: string }) => l.phone.replace(/\D/g, '')))
    const fresh = candidates.filter(l => !existingPhones.has(l.phone.replace(/\D/g, '')))
    if (fresh.length > 0) await supabase.from('leads').insert(fresh)
    return { inserted: fresh.length, skipped: candidates.length - fresh.length }
  }

  // ── Maps Scraper ────────────────────────────────────────────────────────────
  // SIMULATION: o scraping abaixo ainda nao consulta fontes externas reais
  const handleMapsScrape = async () => {
    if (!scraperNiche.trim()) {
      setScraperError('Preencha o campo Nicho antes de buscar.')
      return
    }
    setScraperError('')
    // Se localização vazia, tenta extrair do nicho (ex: 'barbearia caxias do sul')
    const loc = scraperLocation.trim() || scraperNiche
    setScraping(true)
    const ddd = getDDD(loc)
    const niche = scraperNiche.trim()
    const firstNames = ['Ana', 'Maria', 'Juliana', 'Sandra', 'Bruna', 'Carla', 'Renata', 'Petra', 'Cláudia', 'Vera']
    const types = ['Studio de Beleza', 'Salão', 'Espaço Beleza', 'Hair Design', 'Instituto', 'Clínica de Estética', 'Studio Hair']
    const suffixes = ['da Ju', 'da Mari', 'Glamour', 'Elegance', 'Prime', 'VIP', 'Express', 'Fashion', 'Gold']
    const generateName = (i: number) => {
      const nicheWord = niche.split(' ')[0] || 'Studio'
      const p = [
        `${types[i % types.length]} ${firstNames[i % firstNames.length]}`,
        `${firstNames[(i + 2) % firstNames.length]} ${types[(i + 1) % types.length]}`,
        `${nicheWord} ${suffixes[i % suffixes.length]}`,
        `${firstNames[(i + 3) % firstNames.length]} & Cia ${nicheWord}`,
        `${types[(i + 2) % types.length]} ${suffixes[(i + 1) % suffixes.length]}`,
      ]
      return p[i % p.length]
    }
    const newLeads = Array.from({ length: 5 }, (_, i) => ({
      tenant_id: tenant!.id,
      name: generateName(i),
      phone: generatePhone(ddd, i),
      source: 'maps' as const,
      status: 'new' as const,
      validation_status: 'pending' as const,
    }))
    const { inserted, skipped } = await insertDeduped(newLeads)
    await fetchLeads()
    if (skipped > 0) setScraperError(`✅ ${inserted} leads inseridos, ${skipped} duplicados ignorados.`)
    setScraping(false)
  }

  // ── Instagram Sniper ────────────────────────────────────────────────────────
  const handleIgScrape = async () => {
    if (!igTarget.trim()) return
    setIgScraping(true)
    await new Promise(r => setTimeout(r, 1800)) // SIMULATION: simula scraping

    const handle = igTarget.replace(/^[@#]/, '')
    const igNames = [
      `Studio ${handle} Beauty`, `Salão Influencer ${handle}`,
      `Hair by ${handle}`, `${handle} Estética Premium`,
      `Studio ${handle} VIP`,
    ]
    const ddd = '11'
    const newLeads = igNames.map((name, i) => ({
      tenant_id: tenant!.id,
      name,
      phone: generatePhone(ddd, i + 10),
      source: 'instagram' as const,
      status: 'new' as const,
      validation_status: 'pending' as const,
    }))
    const { inserted, skipped } = await insertDeduped(newLeads)
    await fetchLeads()
    if (inserted > 0 || skipped === 0) setIgTarget('')
    if (skipped > 0) setIgTarget(`${inserted} inseridos, ${skipped} já existem`)
    setIgScraping(false)
  }

  // ── Radar CNPJ ──────────────────────────────────────────────────────────────
  const handleCnpjScrape = async () => {
    if (!cnpjCnae || !cnpjCity) return
    setCnpjScraping(true)
    await new Promise(r => setTimeout(r, 2000)) // SIMULATION: simula consulta Receita

    const ddd = getDDD(cnpjCity)
    const razoes = [
      `${cnpjCnae} & Serviços ME`, `Instituto ${cnpjCnae} Ltda`,
      `Clínica ${cnpjCnae} EIRELI`, `Studio ${cnpjCnae} ME`,
      `${cnpjCnae} Empreendimentos`,
    ]
    const newLeads = razoes.map((name, i) => ({
      tenant_id: tenant!.id,
      name,
      phone: generatePhone(ddd, i + 20),
      source: 'manual' as const,
      status: 'new' as const,
      validation_status: 'pending' as const,
    }))
    const { inserted, skipped } = await insertDeduped(newLeads)
    await fetchLeads()
    if (inserted > 0) { setCnpjCnae(''); setCnpjCity('') }
    if (skipped > 0) console.info(`CNPJ: ${skipped} leads duplicados ignorados`)
    setCnpjScraping(false)
  }

  // ── vCard Import ────────────────────────────────────────────────────────────
  const handleVcard = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const vcards = text.split('BEGIN:VCARD').slice(1)
    const parsed = vcards.map(vc => {
      const name = (vc.match(/FN:(.+)/)?.[1] ?? vc.match(/N:([^;]+)/)?.[1] ?? 'Contato importado').trim()
      const phone = (vc.match(/TEL[^:]*:(.+)/)?.[1] ?? '').trim().replace(/\D/g, '')
      const formatted = phone ? `(${phone.slice(0, 2)}) 9 ${phone.slice(2, 6)}-${phone.slice(6, 10)}` : ''
      return { tenant_id: tenant!.id, name, phone: formatted || '(11) 9 0000-0000', source: 'csv' as const, status: 'new' as const, validation_status: 'pending' as const }
    }).filter(l => l.name)

    if (parsed.length) {
      const { inserted, skipped } = await insertDeduped(parsed)
      await fetchLeads()
      if (skipped > 0) console.info(`vCard: ${inserted} inseridos, ${skipped} duplicados ignorados`)
    }
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    await supabase.from('leads').delete().eq('id', id)
    setLeads(prev => prev.filter(l => l.id !== id))
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  const handleClearAll = async () => {
    if (!window.confirm(`Deletar TODOS os ${leads.length} leads do banco? Esta ação não pode ser desfeita.`)) return
    setClearingLeads(true)
    await supabase.from('leads').delete().eq('tenant_id', tenant!.id)
    setLeads([])
    setSelected(new Set())
    setClearingLeads(false)
  }

  const handleStatusChange = async (id: string, status: Lead['status']) => {
    await supabase.from('leads').update({ status }).eq('id', id)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l))
  }

  // ── Selection ───────────────────────────────────────────────────────────────
  const toggleSelect = (id: string) => setSelected(prev => {
    const s = new Set(prev)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    return s
  })
  const toggleAll = () => setSelected(prev =>
    prev.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id))
  )

  // ── Blitz Campaign + Cadenciador de Segurança ─────────────────────────────
  const handleBlitz = async () => {
    const targets = leads.filter(l => selected.has(l.id))
    if (!targets.length) return
    setBlitzing(true)
    // 1) James gera mensagens personalizadas por fonte
    const results = await generateBatchMessages(
      targets.map(l => ({ name: l.name, source: l.source })),
      tenant?.name ?? 'o salão'
    )
    setBlitzResults(results)
    setBlitzOpen(true)
    setBlitzing(false)
  }

  // SIMULATION: dispara links wa.me no navegador; nao usa fila real nem envio automatizado do backend
  // Cadenciador: dispara links wa.me sequencialmente com delay aleatorio anti-ban
  const handleCadenciadoBlitz = async () => {
    const targets = leads.filter(l => selected.has(l.id) && blitzResults[l.name])
    if (!targets.length) return
    setCadActive(true)
    cadStopRef.current = false
    setCadFired(0)

    for (let i = 0; i < targets.length; i++) {
      if (cadStopRef.current) break
      const lead = targets[i]
      const msg = blitzResults[lead.name] ?? `Olá, ${lead.name}! 💅`
      const phone = `55${lead.phone.replace(/\D/g, '')}`
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`

      setCadCurrentLead(lead.name)
      window.open(url, '_blank')
      setCadFired(i + 1)

      if (i < targets.length - 1) {
        // Delay aleatório entre cadMinDelay e cadMaxDelay segundos
        const delay = (cadMinDelay + Math.random() * (cadMaxDelay - cadMinDelay)) | 0
        for (let s = delay; s > 0; s--) {
          if (cadStopRef.current) break
          setCadCountdown(s)
          await new Promise(r => setTimeout(r, 1000))
        }
        setCadCountdown(0)
      }
    }
    setCadActive(false)
    setCadCurrentLead('')
  }

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = leads.filter(l => {
    const matchQuery = l.name?.toLowerCase().includes(query.toLowerCase()) || l.phone.includes(query)
    const matchTemp = temperature === 'all' || TEMP_BY_SOURCE[l.source] === temperature
    return matchQuery && matchTemp
  })

  // ─── Render ───────────────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; icon: React.ReactNode; color: string }[] = [
    { id: 'maps',      label: 'Maps',            icon: <MapPin size={14} />,     color: 'var(--accent)' },
    { id: 'instagram', label: 'Instagram Sniper', icon: <Instagram size={14} />, color: '#7c3aed' },
    { id: 'cnpj',      label: 'Radar CNPJ',       icon: <Building2 size={14} />, color: '#f59e0b' },
    { id: 'vcard',     label: 'vCard / CSV',       icon: <Upload size={14} />,    color: '#10b981' },
  ]

  const tempFilters: { id: Temperature; label: string; icon: React.ReactNode; color: string }[] = [
    { id: 'all',  label: 'Todos',         icon: <Filter size={12} />,       color: 'var(--text-muted)' },
    { id: 'cold', label: 'Frio (Maps)',   icon: <Snowflake size={12} />,    color: '#60a5fa' },
    { id: 'warm', label: 'Morno (IG)',    icon: <Thermometer size={12} />,  color: '#a78bfa' },
    { id: 'hot',  label: 'Quente',        icon: <Flame size={12} />,        color: '#f97316' },
  ]

  return (
    <AppLayout title="O Predador 🐙" subtitle="Central multifontes de prospecção — Maps · Instagram · CNPJ · vCard">
      <div className="flex flex-col gap-4">

        {/* ── TABS ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 p-1 rounded-2xl" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold flex-1 justify-center transition-all duration-200"
              style={activeTab === tab.id
                ? { background: tab.color, color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }
                : { color: 'var(--text-muted)' }}
            >
              {tab.icon} <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── MAPS ─────────────────────────────────────────────────────────── */}
        {activeTab === 'maps' && (
          <div className="card animate-fade-in">
            <p className="section-title flex items-center gap-2 mb-1"><MapPin size={16} style={{ color: 'var(--accent)' }} /> Scraper do Google Maps</p>
            <p className="section-subtitle mb-4">Busca salões por nicho e cidade — DDD detectado automaticamente</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input className="input-field flex-1" placeholder="Nicho: Salão de beleza, Barbearia..." value={scraperNiche} onChange={e => { setScraperNiche(e.target.value); setScraperError('') }} />
              <input className="input-field flex-1" placeholder="Cidade / Estado (opcional): farroupilha rs" value={scraperLocation} onChange={e => setScraperLocation(e.target.value)} />
              <button onClick={handleMapsScrape} disabled={scraping} className="btn-primary gap-2 whitespace-nowrap">
                {scraping ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Buscando...</> : <><Search size={14} /> Iniciar Scraping</>}
              </button>
            </div>
            {scraperError && (
              <p className="mt-2 text-sm" style={{ color: '#dc2626' }}>⚠️ {scraperError}</p>
            )}
          </div>
        )}

        {/* ── INSTAGRAM SNIPER ──────────────────────────────────────────────── */}
        {activeTab === 'instagram' && (
          <div className="card animate-fade-in" style={{ borderColor: 'rgba(124,58,237,0.3)' }}>
            <p className="section-title flex items-center gap-2 mb-1"><Instagram size={16} style={{ color: '#7c3aed' }} /> Instagram Sniper</p>
            <p className="section-subtitle mb-4">Cole um @perfil ou #hashtag — James extrai leads qualificados</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#7c3aed' }} />
                <input className="input-field pl-9" placeholder="@salaodabeleza ou #salaosp" value={igTarget} onChange={e => setIgTarget(e.target.value)} />
              </div>
              <button onClick={handleIgScrape} disabled={igScraping}
                className="gap-2 whitespace-nowrap px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center"
                style={{ background: 'rgba(124,58,237,0.15)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.3)' }}>
                {igScraping ? <><div className="w-4 h-4 border-2 border-purple-300/30 border-t-purple-500 rounded-full animate-spin" /> Analisando...</> : <><Sparkles size={14} /> Extrair com James</>}
              </button>
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              ⚡ Tom: <strong>descontraído e social</strong> — James menciona o perfil/hashtag na mensagem de prospecção
            </p>
          </div>
        )}

        {/* ── RADAR CNPJ ───────────────────────────────────────────────────── */}
        {activeTab === 'cnpj' && (
          <div className="card animate-fade-in" style={{ borderColor: 'rgba(245,158,11,0.3)' }}>
            <p className="section-title flex items-center gap-2 mb-1"><Building2 size={16} style={{ color: '#f59e0b' }} /> Radar de Novatos — CNPJ</p>
            <p className="section-subtitle mb-4">Empresas abertas recentemente por CNAE em cidades específicas</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="label">CNAE / Segmento</label>
                <input className="input-field" placeholder="ex: Estética, Saúde, Beleza" value={cnpjCnae} onChange={e => setCnpjCnae(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="label">Cidade / Estado</label>
                <input className="input-field" placeholder="ex: Caxias do Sul RS" value={cnpjCity} onChange={e => setCnpjCity(e.target.value)} />
              </div>
              <div className="flex items-end">
                <button onClick={handleCnpjScrape} disabled={cnpjScraping}
                  className="gap-2 whitespace-nowrap px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center h-[46px]"
                  style={{ background: 'rgba(245,158,11,0.15)', color: '#d97706', border: '1px solid rgba(245,158,11,0.3)' }}>
                  {cnpjScraping ? <><div className="w-4 h-4 border-2 border-amber-300/30 border-t-amber-500 rounded-full animate-spin" /> Consultando...</> : <><Search size={14} /> Radar</>}
                </button>
              </div>
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              📋 Consulta Receita Federal · Filtra abertura {"<"} 12 meses · CNAE 96.02-5 (Cabeleireiros) e similares
            </p>
          </div>
        )}

        {/* ── vCARD / CSV ───────────────────────────────────────────────────── */}
        {activeTab === 'vcard' && (
          <div className="card animate-fade-in" style={{ borderColor: 'rgba(16,185,129,0.3)' }}>
            <p className="section-title flex items-center gap-2 mb-1"><Upload size={16} style={{ color: '#10b981' }} /> Importação vCard / CSV</p>
            <p className="section-subtitle mb-4">Importe listas de contatos — classificados como leads Quentes 🔥</p>
            <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-2xl py-10 cursor-pointer transition-colors hover:border-emerald-400"
              style={{ borderColor: 'rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.04)' }}
              onClick={() => fileRef.current?.click()}>
              <Upload size={28} style={{ color: '#10b981' }} className="mb-2" />
              <span className="text-sm font-semibold" style={{ color: '#10b981' }}>Arraste ou clique para importar</span>
              <span className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>.vcf · .csv · .xlsx</span>
              <input ref={fileRef} type="file" accept=".vcf,.csv,.xlsx,.xls" className="hidden" onChange={handleVcard} />
            </label>
          </div>
        )}

        {/* ── LEAD TABLE ────────────────────────────────────────────────────── */}
        <div className="card">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <p className="section-title">{filtered.length} leads · {selected.size} selecionados</p>
              <p className="section-subtitle">Tenant: {tenant?.name}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Limpar todos */}
              {leads.length > 0 && (
                <button onClick={handleClearAll} disabled={clearingLeads}
                  className="text-xs px-3 py-1.5 rounded-xl font-semibold flex items-center gap-1"
                  style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
                  {clearingLeads ? <div className="w-3 h-3 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" /> : <Trash2 size={11} />}
                  Limpar todos ({leads.length})
                </button>
              )}
              {/* Temperature filter */}
              <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                {tempFilters.map(tf => (
                  <button key={tf.id} onClick={() => setTemperature(tf.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={temperature === tf.id ? { background: tf.color, color: '#fff' } : { color: 'var(--text-muted)' }}>
                    {tf.icon} <span className="hidden md:inline">{tf.label}</span>
                  </button>
                ))}
              </div>
              {/* Search */}
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input className="input-field pl-8 py-2 w-36 text-sm" placeholder="Buscar..." value={query} onChange={e => setQuery(e.target.value)} />
              </div>
              <button onClick={fetchLeads} className="btn-secondary gap-1 py-2 px-3 text-xs"><RefreshCw size={12} /></button>
            </div>
          </div>

          {/* Blitz bar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 animate-fade-in"
              style={{ background: 'var(--gradient-subtle)', border: '1px solid var(--accent)', boxShadow: 'var(--shadow-accent)' }}>
              <Zap size={15} style={{ color: 'var(--accent)' }} />
              <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-main)' }}>
                {selected.size} leads selecionados para Blitz
              </span>
              <button onClick={handleBlitz} disabled={blitzing}
                className="btn-primary gap-2 text-sm py-1.5">
                {blitzing
                  ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> James gerando...</>
                  : <><Sparkles size={13} /> James, Iniciar Blitz!</>}
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nenhum lead encontrado. Use uma das abas acima para prospectar.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--surface-hover)' }}>
                    <th className="table-header w-10">
                      <button onClick={toggleAll}>
                        {selected.size === filtered.length && filtered.length > 0
                          ? <CheckSquare size={14} style={{ color: 'var(--accent)' }} />
                          : <Square size={14} style={{ color: 'var(--text-muted)' }} />}
                      </button>
                    </th>
                    <th className="table-header">Nome</th>
                    <th className="table-header">Telefone</th>
                    <th className="table-header">Fonte</th>
                    <th className="table-header">Temperatura</th>
                    <th className="table-header">Status</th>
                    <th className="table-header"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(lead => {
                    const temp = TEMP_BY_SOURCE[lead.source] ?? 'cold'
                    const tempStyle = temp === 'cold'
                      ? { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' }
                      : temp === 'warm'
                      ? { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' }
                      : { color: '#f97316', bg: 'rgba(249,115,22,0.1)' }
                    const tempLabel = temp === 'cold' ? '❄️ Frio' : temp === 'warm' ? '🌡️ Morno' : '🔥 Quente'
                    const isSelected = selected.has(lead.id)
                    const blitzMsg = blitzResults[lead.name]

                    return (
                      <tr key={lead.id}
                        style={{ background: isSelected ? 'var(--accent-muted)' : undefined }}
                        onMouseEnter={e => !isSelected && ((e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)')}
                        onMouseLeave={e => !isSelected && ((e.currentTarget as HTMLElement).style.background = 'transparent')}>
                        <td className="table-cell">
                          <button onClick={() => toggleSelect(lead.id)}>
                            {isSelected
                              ? <CheckSquare size={14} style={{ color: 'var(--accent)' }} />
                              : <Square size={14} style={{ color: 'var(--text-muted)' }} />}
                          </button>
                        </td>
                        <td className="table-cell">
                          <div>
                            <p className="font-semibold" style={{ color: 'var(--text-main)' }}>{lead.name}</p>
                            {blitzMsg && (
                              <p className="text-xs mt-0.5 italic" style={{ color: '#7c3aed' }}>💬 {blitzMsg}</p>
                            )}
                          </div>
                        </td>
                        <td className="table-cell font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                          <div className="flex items-center gap-2">
                            {lead.phone}
                            <a href={`https://wa.me/55${lead.phone.replace(/\D/g, '')}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-xs px-1.5 py-0.5 rounded font-semibold"
                              style={{ background: 'rgba(37,211,102,0.12)', color: '#16a34a' }}>
                              <Phone size={10} />
                            </a>
                          </div>
                        </td>
                        <td className="table-cell">
                          {lead.source === 'maps' ? (
                            <a href={`https://www.google.com/maps/search/${encodeURIComponent(lead.name)}`}
                              target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--accent)' }}>
                              <MapPin size={11} /> Maps <ExternalLink size={9} />
                            </a>
                          ) : lead.source === 'instagram' ? (
                            <span className="flex items-center gap-1 text-xs" style={{ color: '#7c3aed' }}><Instagram size={11} /> Instagram</span>
                          ) : lead.source === 'csv' ? (
                            <span className="flex items-center gap-1 text-xs" style={{ color: '#10b981' }}><Upload size={11} /> vCard</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs" style={{ color: '#f59e0b' }}><Building2 size={11} /> CNPJ</span>
                          )}
                        </td>
                        <td className="table-cell">
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                            style={{ background: tempStyle.bg, color: tempStyle.color }}>
                            {tempLabel}
                          </span>
                        </td>
                        <td className="table-cell">
                          <select value={lead.status}
                            onChange={e => handleStatusChange(lead.id, e.target.value as Lead['status'])}
                            className="text-xs rounded-lg px-2 py-1 cursor-pointer"
                            style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-main)' }}>
                            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </td>
                        <td className="table-cell">
                          <button onClick={() => handleDelete(lead.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg"
                            style={{ color: 'var(--text-muted)' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#dc2626'; (e.currentTarget as HTMLElement).style.background = 'rgba(220,38,38,0.08)' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── BLITZ RESULTS + CADENCIADOR ───────────────────────────────────── */}
        {blitzOpen && Object.keys(blitzResults).length > 0 && (
          <div className="card animate-fade-in" style={{ borderColor: 'var(--accent)', background: 'var(--gradient-subtle)' }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <p className="section-title flex items-center gap-2">
                <Sparkles size={15} style={{ color: 'var(--accent)' }} />
                Blitz — {Object.keys(blitzResults).length} mensagens geradas
              </p>
              <button onClick={() => setBlitzOpen(false)} className="text-xs" style={{ color: 'var(--text-muted)' }}>Fechar</button>
            </div>

            {/* ── CADENCIADOR DE SEGURANÇA ── */}
            <div className="p-4 rounded-2xl mb-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={15} style={{ color: '#10b981' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>Cadenciador de Segurança Anti-Ban</p>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>Delay aleatório</span>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4 mb-3">
                <div className="flex-1">
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Mínimo (seg)</label>
                  <input type="number" min={5} max={120}
                    value={cadMinDelay} onChange={e => setCadMinDelay(Number(e.target.value))}
                    className="input-field py-1.5 text-sm w-full" disabled={cadActive} />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Máximo (seg)</label>
                  <input type="number" min={5} max={300}
                    value={cadMaxDelay} onChange={e => setCadMaxDelay(Number(e.target.value))}
                    className="input-field py-1.5 text-sm w-full" disabled={cadActive} />
                </div>
                <div className="flex items-end gap-2">
                  {!cadActive ? (
                    <button onClick={handleCadenciadoBlitz}
                      className="btn-primary gap-2 py-2 whitespace-nowrap text-sm">
                      <Zap size={13} /> Disparar com Cadênciador
                    </button>
                  ) : (
                    <button onClick={() => { cadStopRef.current = true }}
                      className="gap-2 py-2 px-4 rounded-xl text-sm font-semibold flex items-center"
                      style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
                      <StopCircle size={13} /> Parar
                    </button>
                  )}
                </div>
              </div>

              {/* Countdown visual */}
              {cadActive && (
                <div className="flex items-center gap-3 p-3 rounded-xl animate-fade-in" style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold" style={{ color: '#10b981' }}>
                      {cadCountdown > 0
                        ? `⏳ Próximo disparo em ${cadCountdown}s...`
                        : `📱 Enviando para ${cadCurrentLead}...`}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {cadFired} de {selected.size} disparados
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold" style={{ color: cadCountdown > 0 ? '#f59e0b' : '#10b981' }}>
                      {cadCountdown > 0 ? cadCountdown : '✅'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Lista de mensagens */}
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
              {Object.entries(blitzResults).map(([name, msg]) => (
                <div key={name} className="p-3 rounded-xl" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--accent)' }}>{name}</p>
                  <p className="text-sm" style={{ color: 'var(--text-main)' }}>{msg}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(msg)}
                    className="mt-1.5 text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <Copy size={10} /> Copiar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  )
}
