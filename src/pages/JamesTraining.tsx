import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import AppLayout from '../components/AppLayout'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/tenant-context'
import { backendFetch } from '../lib/backend'
import {
  ChevronRight, ChevronLeft, Check, Plus, X, Send,
  Building2, ShoppingBag, GraduationCap, Users, Calendar,
  Star, Target, TrendingUp, RefreshCcw,
  MapPin, Zap, Brain, Sparkles, Loader2
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
interface BusinessContext {
  segments: string[]
  customSegments: string[]
  hasServices: boolean
  servicesList: string[]
  hasProductMarketplace: boolean
  productCategories: string[]
  hasKnowledgeMarketplace: boolean
  knowledgeTopics: string[]
  hasProfessionals: boolean
  professionalRoles: string[]
  hasAgenda: boolean
  agendaType: 'manual' | 'online' | 'both'
  serviceTypes: string[]
  hasReviews: boolean
  hasComments: boolean
  detectEmptyAgenda: boolean
  suggestCampaign: boolean
  validateWithOwner: boolean
  autoCampaign: boolean
  operationalNotes: string
  strategies: string[]
  ticketApproach: string
  reactivationWindow: string
  occupancyTarget: string
  multipleLocations: boolean
  estimatedLocations: string
  lowDigitalization: boolean
  expansionNotes: string
  completedSteps: number[]
}

interface StepProps {
  ctx: BusinessContext
  update: (partial: Partial<BusinessContext>) => void
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const SEGMENT_OPTIONS = [
  { id: 'barbearia', label: 'Barbearia', emoji: '💈' },
  { id: 'salao', label: 'Salão de Beleza', emoji: '💇' },
  { id: 'spa', label: 'Spa & Bem-estar', emoji: '🧖' },
  { id: 'tatuagem', label: 'Estúdio de Tatuagem', emoji: '🎨' },
  { id: 'estetica', label: 'Clínica Estética', emoji: '✨' },
  { id: 'nail', label: 'Nail Designer', emoji: '💅' },
  { id: 'sobrancelha', label: 'Design de Sobrancelha', emoji: '👁️' },
  { id: 'lash', label: 'Lash Designer', emoji: '👀' },
]

const STEPS = [
  { id: 1, title: 'Segmento', subtitle: 'Tipo de negócio', icon: Building2 },
  { id: 2, title: 'Estrutura', subtitle: 'Sistema e serviços', icon: ShoppingBag },
  { id: 3, title: 'Funcionamento', subtitle: 'Operação diária', icon: Users },
  { id: 4, title: 'Dinâmica', subtitle: 'Automação', icon: Zap },
  { id: 5, title: 'Inteligência', subtitle: 'Estratégia comercial', icon: TrendingUp },
  { id: 6, title: 'Escala', subtitle: 'Expansão', icon: MapPin },
  { id: 7, title: 'Simulação', subtitle: 'Testar o James', icon: Brain },
]

const BEAUTY_HUB_DEFAULTS: BusinessContext = {
  segments: ['salao', 'barbearia', 'spa', 'estetica', 'nail', 'sobrancelha', 'lash'],
  customSegments: [],
  hasServices: true,
  servicesList: ['Corte', 'Barba', 'Coloração', 'Hidratação', 'Manicure', 'Pedicure', 'Massagem', 'Limpeza de Pele', 'Design de Sobrancelha', 'Extensão de Cílios'],
  hasProductMarketplace: true,
  productCategories: ['Shampoos', 'Condicionadores', 'Pomadas', 'Óleos', 'Cremes', 'Esmaltes', 'Acessórios'],
  hasKnowledgeMarketplace: true,
  knowledgeTopics: ['Técnicas de Corte', 'Colorimetria', 'Gestão de Salão', 'Marketing Digital', 'Atendimento ao Cliente'],
  hasProfessionals: true,
  professionalRoles: ['Barbeiro', 'Cabeleireiro(a)', 'Manicure', 'Esteticista', 'Massagista', 'Designer de Sobrancelha', 'Lash Designer'],
  hasAgenda: true,
  agendaType: 'both',
  serviceTypes: ['Presencial', 'Domicílio'],
  hasReviews: true,
  hasComments: true,
  detectEmptyAgenda: true,
  suggestCampaign: true,
  validateWithOwner: true,
  autoCampaign: false,
  operationalNotes: 'Priorizar horários de baixa ocupação (terça a quinta, manhã). Campanhas focadas em reativação de clientes inativos há mais de 30 dias.',
  strategies: ['ticket', 'reativacao', 'ocupacao'],
  ticketApproach: 'Upsell de produtos premium após serviço. Combo de serviços com desconto progressivo.',
  reactivationWindow: '30',
  occupancyTarget: '85',
  multipleLocations: true,
  estimatedLocations: '50+',
  lowDigitalization: true,
  expansionNotes: 'Foco inicial em bairros de classe B/C com alta densidade de salões independentes.',
  completedSteps: [],
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE HELPERS
// ═══════════════════════════════════════════════════════════════
async function saveWizardState(tenantId: string, ctx: BusinessContext, currentStep: number) {
  await supabase.from('james_memories').delete().eq('tenant_id', tenantId).eq('category', 'training:wizard-state')
  await supabase.from('james_memories').insert([{
    tenant_id: tenantId, speaker: 'sistema', category: 'training:wizard-state',
    input: 'Estado do wizard de treinamento', response: JSON.stringify({ ...ctx, currentStep }),
    important: false, tags: ['training', 'wizard-state'],
  }])
}

function generateLearningMemories(ctx: BusinessContext) {
  const m: Array<{ category: string; input: string; response: string; tags: string[] }> = []
  const segLabels = ctx.segments.map(s => SEGMENT_OPTIONS.find(o => o.id === s)?.label ?? s)
  const allSegs = [...segLabels, ...ctx.customSegments]
  if (allSegs.length > 0) {
    m.push({ category: 'training:segmento', input: 'Quais segmentos de negócio a plataforma The Beauty Hub atende?',
      response: `O The Beauty Hub atende os seguintes segmentos do mercado de beleza e bem-estar: ${allSegs.join(', ')}. Cada segmento representa um tipo de estabelecimento que pode usar o sistema para gerenciar operações, agenda, clientes e campanhas.`,
      tags: ['training', 'segmento', 'negocio'] })
  }
  if (ctx.hasServices || ctx.hasProductMarketplace || ctx.hasKnowledgeMarketplace) {
    const parts: string[] = []
    if (ctx.hasServices) parts.push(`Serviços presenciais: ${ctx.servicesList.join(', ')}`)
    if (ctx.hasProductMarketplace) parts.push(`Marketplace de produtos: ${ctx.productCategories.join(', ')}`)
    if (ctx.hasKnowledgeMarketplace) parts.push(`Marketplace de conhecimento: ${ctx.knowledgeTopics.join(', ')}`)
    m.push({ category: 'training:estrutura', input: 'Qual é a estrutura de serviços e marketplace da plataforma?',
      response: `A plataforma oferece: ${parts.join('. ')}.`, tags: ['training', 'estrutura', 'servicos'] })
  }
  if (ctx.hasProfessionals || ctx.hasAgenda) {
    const parts: string[] = []
    if (ctx.hasProfessionals) parts.push(`Profissionais: ${ctx.professionalRoles.join(', ')}`)
    if (ctx.hasAgenda) parts.push(`Agenda: ${ctx.agendaType === 'both' ? 'online e manual' : ctx.agendaType}`)
    if (ctx.serviceTypes.length) parts.push(`Tipos de atendimento: ${ctx.serviceTypes.join(', ')}`)
    if (ctx.hasReviews) parts.push('Sistema de avaliações ativo')
    if (ctx.hasComments) parts.push('Sistema de comentários ativo')
    m.push({ category: 'training:funcionamento', input: 'Como funciona o estabelecimento dentro da plataforma?',
      response: `Cada estabelecimento opera com: ${parts.join('. ')}.`, tags: ['training', 'funcionamento', 'operacao'] })
  }
  const dynParts: string[] = []
  if (ctx.detectEmptyAgenda) dynParts.push('detecta agenda vazia automaticamente')
  if (ctx.suggestCampaign) dynParts.push('sugere campanhas de preenchimento')
  if (ctx.validateWithOwner) dynParts.push('valida com o estabelecimento antes de disparar')
  if (ctx.autoCampaign) dynParts.push('dispara campanhas automaticamente')
  if (dynParts.length) {
    m.push({ category: 'training:dinamica', input: 'Qual é a dinâmica operacional do sistema?',
      response: `O sistema ${dynParts.join(', ')}. ${ctx.operationalNotes ? `Notas: ${ctx.operationalNotes}` : ''}`.trim(),
      tags: ['training', 'dinamica', 'automacao'] })
  }
  if (ctx.strategies.length) {
    const strats: string[] = []
    if (ctx.strategies.includes('ticket')) strats.push(`Aumento de ticket: ${ctx.ticketApproach || 'upsell e combos'}`)
    if (ctx.strategies.includes('reativacao')) strats.push(`Reativação de clientes inativos há ${ctx.reactivationWindow || '30'} dias`)
    if (ctx.strategies.includes('ocupacao')) strats.push(`Ocupação de agenda com meta de ${ctx.occupancyTarget || '85'}%`)
    m.push({ category: 'training:inteligencia', input: 'Quais estratégias de inteligência comercial o sistema usa?',
      response: `O sistema foca em: ${strats.join('. ')}.`, tags: ['training', 'inteligencia', 'comercial'] })
  }
  if (ctx.multipleLocations || ctx.lowDigitalization) {
    const parts: string[] = []
    if (ctx.multipleLocations) parts.push(`Opera com múltiplos estabelecimentos (estimativa: ${ctx.estimatedLocations || 'N/A'})`)
    if (ctx.lowDigitalization) parts.push('Público-alvo tem baixa digitalização — oportunidade de inclusão digital')
    m.push({ category: 'training:escala', input: 'Como funciona a escala de mercado?',
      response: `${parts.join('. ')}. ${ctx.expansionNotes || ''}`.trim(), tags: ['training', 'escala', 'expansao'] })
  }
  return m
}

async function syncLearningMemories(tenantId: string, ctx: BusinessContext) {
  const existing = await supabase.from('james_memories').select('id, category').eq('tenant_id', tenantId)
  const toDelete = (existing.data ?? []).filter(r => r.category?.startsWith('training:') && r.category !== 'training:wizard-state').map(r => r.id)
  if (toDelete.length > 0) await supabase.from('james_memories').delete().in('id', toDelete)
  const memories = generateLearningMemories(ctx)
  if (memories.length > 0) {
    await supabase.from('james_memories').insert(memories.map(m => ({
      tenant_id: tenantId, speaker: 'sistema' as const, ...m, important: true,
    })))
  }
  return memories.length
}

// Business knowledge is loaded from the authenticated tenant, never bundled as a global seed.
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════════
function Toast({ msg, type }: { msg: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border text-sm font-medium animate-fade-in
      ${type === 'success' ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-300' : 'bg-red-900/90 border-red-500/40 text-red-300'}`}>
      {type === 'success' ? <Check size={14} /> : <X size={14} />} {msg}
    </div>
  )
}

function StepHeader({ title, description, icon: Icon }: { title: string; description: string; icon: typeof Building2 }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-muted)', border: '1px solid rgba(0,180,255,0.2)' }}>
          <Icon size={20} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-main)' }}>{title}</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>
        </div>
      </div>
    </div>
  )
}

function Toggle({ value, onChange, label, description }: { value: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group py-2">
      <div className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0 mt-0.5"
        style={{ background: value ? 'var(--accent)' : 'var(--surface-hover)', border: `1px solid ${value ? 'var(--accent-dark)' : 'var(--border)'}` }}
        onClick={e => { e.preventDefault(); onChange(!value) }}>
        <div className="absolute top-0.5 w-4.5 h-4.5 rounded-full transition-all shadow"
          style={{ width: 18, height: 18, background: value ? '#fff' : 'var(--text-subtle)', transform: value ? 'translateX(22px)' : 'translateX(2px)' }} />
      </div>
      <div>
        <span className="text-sm font-medium block" style={{ color: 'var(--text-main)' }}>{label}</span>
        {description && <span className="text-xs block mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</span>}
      </div>
    </label>
  )
}

function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [val, setVal] = useState('')
  const add = () => { const v = val.trim(); if (v && !tags.includes(v)) { onChange([...tags, v]); setVal('') } }
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {tags.map(t => (
          <span key={t} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid rgba(0,180,255,0.2)' }}>
            {t}
            <button onClick={() => onChange(tags.filter(x => x !== t))} className="opacity-60 hover:opacity-100"><X size={12} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder ?? 'Adicionar...'} className="input-field flex-1" style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem' }} />
        <button onClick={add} className="px-3 rounded-lg transition-colors" style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid rgba(0,180,255,0.2)' }}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

function SelectableCard({ label, emoji, selected, onClick }: { label: string; emoji: string; selected: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} className="rounded-xl p-4 cursor-pointer transition-all"
      style={{ background: selected ? 'rgba(0,180,255,0.08)' : 'var(--surface-card)', border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: selected ? '0 0 20px rgba(0,180,255,0.12)' : 'none' }}>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xl block mb-1">{emoji}</span>
          <span className="text-xs font-medium" style={{ color: selected ? 'var(--accent)' : 'var(--text-main)' }}>{label}</span>
        </div>
        {selected && <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)' }}><Check size={12} color="#fff" /></div>}
      </div>
    </div>
  )
}

function FeatureBlock({ icon: Icon, title, enabled, onToggle, children }: { icon: typeof ShoppingBag; title: string; enabled: boolean; onToggle: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className="rounded-xl p-5 transition-all" style={{ background: enabled ? 'rgba(0,180,255,0.04)' : 'var(--surface-card)',
      border: `1px solid ${enabled ? 'rgba(0,180,255,0.2)' : 'var(--border)'}` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Icon size={18} style={{ color: enabled ? 'var(--accent)' : 'var(--text-muted)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>{title}</span>
        </div>
        <Toggle value={enabled} onChange={onToggle} label="" />
      </div>
      {enabled && children && <div className="mt-3 animate-fade-in">{children}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// STEP COMPONENTS
// ═══════════════════════════════════════════════════════════════
function Step1({ ctx, update }: StepProps) {
  return (<div>
    <StepHeader icon={Building2} title="Segmento do Negócio" description="Selecione todos os segmentos que a plataforma atende" />
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {SEGMENT_OPTIONS.map(seg => (
        <SelectableCard key={seg.id} label={seg.label} emoji={seg.emoji} selected={ctx.segments.includes(seg.id)}
          onClick={() => { const next = ctx.segments.includes(seg.id) ? ctx.segments.filter(s => s !== seg.id) : [...ctx.segments, seg.id]; update({ segments: next }) }} />
      ))}
    </div>
    <div className="mt-5">
      <label className="text-xs font-semibold uppercase tracking-wide mb-2 block" style={{ color: 'var(--text-muted)' }}>Outros segmentos</label>
      <TagInput tags={ctx.customSegments} onChange={t => update({ customSegments: t })} placeholder="Ex: Podologia, Micropigmentação..." />
    </div>
  </div>)
}

function Step2({ ctx, update }: StepProps) {
  return (<div>
    <StepHeader icon={ShoppingBag} title="Estrutura do Sistema" description="Configure os pilares da plataforma" />
    <div className="flex flex-col gap-4">
      <FeatureBlock icon={Star} title="Serviços" enabled={ctx.hasServices} onToggle={v => update({ hasServices: v })}>
        <TagInput tags={ctx.servicesList} onChange={t => update({ servicesList: t })} placeholder="Ex: Corte Masculino, Progressiva..." />
      </FeatureBlock>
      <FeatureBlock icon={ShoppingBag} title="Marketplace de Produtos" enabled={ctx.hasProductMarketplace} onToggle={v => update({ hasProductMarketplace: v })}>
        <TagInput tags={ctx.productCategories} onChange={t => update({ productCategories: t })} placeholder="Ex: Pomada, Óleo de Barba..." />
      </FeatureBlock>
      <FeatureBlock icon={GraduationCap} title="Marketplace de Conhecimento" enabled={ctx.hasKnowledgeMarketplace} onToggle={v => update({ hasKnowledgeMarketplace: v })}>
        <TagInput tags={ctx.knowledgeTopics} onChange={t => update({ knowledgeTopics: t })} placeholder="Ex: Curso de Colorimetria..." />
      </FeatureBlock>
    </div>
  </div>)
}

function Step3({ ctx, update }: StepProps) {
  return (<div>
    <StepHeader icon={Users} title="Funcionamento do Estabelecimento" description="Como cada estabelecimento opera dentro do sistema" />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FeatureBlock icon={Users} title="Profissionais" enabled={ctx.hasProfessionals} onToggle={v => update({ hasProfessionals: v })}>
        <TagInput tags={ctx.professionalRoles} onChange={t => update({ professionalRoles: t })} placeholder="Ex: Barbeiro, Cabeleireira..." />
      </FeatureBlock>
      <FeatureBlock icon={Calendar} title="Agenda" enabled={ctx.hasAgenda} onToggle={v => update({ hasAgenda: v })}>
        <div className="flex gap-2 mt-1">
          {(['manual', 'online', 'both'] as const).map(t => (
            <button key={t} onClick={() => update({ agendaType: t })}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: ctx.agendaType === t ? 'var(--accent)' : 'var(--surface-hover)', color: ctx.agendaType === t ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${ctx.agendaType === t ? 'var(--accent)' : 'var(--border)'}` }}>
              {t === 'manual' ? 'Manual' : t === 'online' ? 'Online' : 'Ambos'}
            </button>
          ))}
        </div>
      </FeatureBlock>
      <div className="rounded-xl p-5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
        <label className="text-xs font-semibold uppercase tracking-wide mb-3 block" style={{ color: 'var(--text-muted)' }}>Tipos de Atendimento</label>
        <TagInput tags={ctx.serviceTypes} onChange={t => update({ serviceTypes: t })} placeholder="Ex: Presencial, Domicílio..." />
      </div>
      <div className="flex flex-col gap-3 rounded-xl p-5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
        <Toggle value={ctx.hasReviews} onChange={v => update({ hasReviews: v })} label="Avaliações" description="Clientes podem avaliar com estrelas" />
        <Toggle value={ctx.hasComments} onChange={v => update({ hasComments: v })} label="Comentários" description="Clientes podem deixar comentários" />
      </div>
    </div>
  </div>)
}

function Step4({ ctx, update }: StepProps) {
  return (<div>
    <StepHeader icon={Zap} title="Dinâmica Operacional" description="Como o sistema deve agir automaticamente" />
    <div className="flex flex-col gap-3">
      <div className="rounded-xl p-5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
        <Toggle value={ctx.detectEmptyAgenda} onChange={v => update({ detectEmptyAgenda: v })} label="Detectar Agenda Vazia"
          description="O James monitora horários sem agendamento e alerta o sistema" />
      </div>
      <div className="rounded-xl p-5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
        <Toggle value={ctx.suggestCampaign} onChange={v => update({ suggestCampaign: v })} label="Sugerir Campanha"
          description="Quando detecta baixa ocupação, sugere uma campanha de preenchimento" />
      </div>
      <div className="rounded-xl p-5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
        <Toggle value={ctx.validateWithOwner} onChange={v => update({ validateWithOwner: v })} label="Validar com Estabelecimento"
          description="Envia a campanha sugerida para aprovação do dono antes de disparar" />
      </div>
      <div className="rounded-xl p-5" style={{ background: ctx.autoCampaign ? 'rgba(212,160,23,0.06)' : 'var(--surface-card)',
        border: `1px solid ${ctx.autoCampaign ? 'rgba(212,160,23,0.25)' : 'var(--border)'}` }}>
        <Toggle value={ctx.autoCampaign} onChange={v => update({ autoCampaign: v })} label="⚡ Disparo Automático"
          description="O James dispara campanhas sem aprovação manual (requer confiança total)" />
      </div>
    </div>
    <div className="mt-5">
      <label className="text-xs font-semibold uppercase tracking-wide mb-2 block" style={{ color: 'var(--text-muted)' }}>Notas operacionais</label>
      <textarea value={ctx.operationalNotes} onChange={e => update({ operationalNotes: e.target.value })} rows={3}
        className="input-field resize-none" placeholder="Instruções adicionais para o James sobre a dinâmica..." />
    </div>
  </div>)
}

function Step5({ ctx, update }: StepProps) {
  const toggleStrategy = (s: string) => {
    const next = ctx.strategies.includes(s) ? ctx.strategies.filter(x => x !== s) : [...ctx.strategies, s]
    update({ strategies: next })
  }
  const strats = [
    { id: 'ticket', icon: TrendingUp, title: 'Aumento de Ticket', desc: 'Elevar o valor médio por cliente', color: '#4ade80',
      field: 'ticketApproach' as const, placeholder: 'Ex: Upsell de produtos, combos...' },
    { id: 'reativacao', icon: RefreshCcw, title: 'Reativação', desc: 'Recuperar clientes inativos', color: '#fbbf24',
      field: 'reactivationWindow' as const, placeholder: 'Janela em dias (ex: 30)' },
    { id: 'ocupacao', icon: Target, title: 'Ocupação de Agenda', desc: 'Preencher horários vazios', color: '#60a5fa',
      field: 'occupancyTarget' as const, placeholder: 'Meta em % (ex: 85)' },
  ]
  return (<div>
    <StepHeader icon={TrendingUp} title="Inteligência Comercial" description="Estratégias que o James deve aplicar" />
    <div className="flex flex-col gap-4">
      {strats.map(s => {
        const active = ctx.strategies.includes(s.id)
        return (
          <div key={s.id} className="rounded-xl p-5 cursor-pointer transition-all" onClick={() => toggleStrategy(s.id)}
            style={{ background: active ? `${s.color}08` : 'var(--surface-card)', border: `1.5px solid ${active ? `${s.color}40` : 'var(--border)'}` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <s.icon size={20} style={{ color: active ? s.color : 'var(--text-muted)' }} />
                <div>
                  <span className="text-sm font-semibold block" style={{ color: 'var(--text-main)' }}>{s.title}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.desc}</span>
                </div>
              </div>
              {active && <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: s.color }}><Check size={12} color="#000" /></div>}
            </div>
            {active && (
              <div className="mt-3 animate-fade-in" onClick={e => e.stopPropagation()}>
                <input value={ctx[s.field]} onChange={e => update({ [s.field]: e.target.value })}
                  className="input-field" style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem' }} placeholder={s.placeholder} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  </div>)
}

function Step6({ ctx, update }: StepProps) {
  return (<div>
    <StepHeader icon={MapPin} title="Escala de Mercado" description="Expansão e alcance da plataforma" />
    <div className="flex flex-col gap-4">
      <div className="rounded-xl p-5" style={{ background: ctx.multipleLocations ? 'rgba(0,180,255,0.04)' : 'var(--surface-card)', border: `1px solid ${ctx.multipleLocations ? 'rgba(0,180,255,0.2)' : 'var(--border)'}` }}>
        <Toggle value={ctx.multipleLocations} onChange={v => update({ multipleLocations: v })} label="Múltiplos Estabelecimentos"
          description="A plataforma opera com rede de estabelecimentos parceiros" />
        {ctx.multipleLocations && (
          <div className="mt-3 animate-fade-in">
            <input value={ctx.estimatedLocations} onChange={e => update({ estimatedLocations: e.target.value })}
              className="input-field" style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem' }} placeholder="Estimativa de estabelecimentos (ex: 50+)" />
          </div>
        )}
      </div>
      <div className="rounded-xl p-5" style={{ background: ctx.lowDigitalization ? 'rgba(212,160,23,0.04)' : 'var(--surface-card)', border: `1px solid ${ctx.lowDigitalization ? 'rgba(212,160,23,0.2)' : 'var(--border)'}` }}>
        <Toggle value={ctx.lowDigitalization} onChange={v => update({ lowDigitalization: v })} label="Baixa Digitalização do Público"
          description="O mercado-alvo tem pouca experiência com tecnologia — oportunidade de inclusão" />
      </div>
    </div>
    <div className="mt-5">
      <label className="text-xs font-semibold uppercase tracking-wide mb-2 block" style={{ color: 'var(--text-muted)' }}>Notas de expansão</label>
      <textarea value={ctx.expansionNotes} onChange={e => update({ expansionNotes: e.target.value })} rows={3}
        className="input-field resize-none" placeholder="Estratégia de expansão, regiões-alvo, modelo de escalabilidade..." />
    </div>
  </div>)
}

function Step7({ ctx, tenantId }: StepProps & { tenantId: string }) {
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const responseRef = useRef('')
  const suggestions = [
    'Como funciona o The Beauty Hub?', 'Quais tipos de estabelecimento vocês atendem?',
    'Como o sistema detecta agenda vazia?', 'Quais estratégias comerciais são usadas?',
    'O que acontece quando um cliente fica inativo?',
  ]

  const askJames = async (q: string) => {
    if (!q.trim() || loading) return
    setLoading(true); setResponse(''); responseRef.current = ''
    try {
      const res = await backendFetch('/api/james/think-stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, tenant_id: tenantId, origin: 'training-simulation', sessionId: `training-${Date.now()}` }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok || !res.body) { setResponse('Erro ao conectar com o James. Verifique se o backend está rodando.'); return }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n'); buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.trim(); if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6)) as { type: string; text?: string; fullText?: string }
            if (evt.type === 'audio' && evt.text) { responseRef.current += (responseRef.current ? ' ' : '') + evt.text; setResponse(responseRef.current) }
            else if (evt.type === 'done' && evt.fullText) setResponse(evt.fullText)
          } catch { /* skip */ }
        }
      }
    } catch { setResponse('Não foi possível conectar. Verifique se o backend está ativo.') }
    finally { setLoading(false) }
  }

  // Summary cards
  const segLabels = ctx.segments.map(s => SEGMENT_OPTIONS.find(o => o.id === s)?.label ?? s)
  const summaryItems = [
    { label: 'Segmentos', value: [...segLabels, ...ctx.customSegments].join(', ') || '—' },
    { label: 'Serviços', value: ctx.hasServices ? ctx.servicesList.slice(0, 5).join(', ') + (ctx.servicesList.length > 5 ? '...' : '') : 'Desativado' },
    { label: 'Profissionais', value: ctx.hasProfessionals ? ctx.professionalRoles.slice(0, 4).join(', ') + (ctx.professionalRoles.length > 4 ? '...' : '') : 'Desativado' },
    { label: 'Automação', value: [ctx.detectEmptyAgenda && 'Detecção', ctx.suggestCampaign && 'Sugestão', ctx.autoCampaign && 'Auto-disparo'].filter(Boolean).join(', ') || '—' },
    { label: 'Estratégias', value: ctx.strategies.map(s => s === 'ticket' ? 'Ticket' : s === 'reativacao' ? 'Reativação' : 'Ocupação').join(', ') || '—' },
    { label: 'Escala', value: ctx.multipleLocations ? `${ctx.estimatedLocations} locais` : 'Local único' },
  ]

  return (<div>
    <StepHeader icon={Brain} title="Simulação" description="Teste se o James aprendeu o negócio" />
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      {summaryItems.map(s => (
        <div key={s.label} className="rounded-xl p-3" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
          <span className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
          <span className="text-xs" style={{ color: 'var(--text-main)' }}>{s.value}</span>
        </div>
      ))}
    </div>
    <div className="rounded-2xl p-5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={16} style={{ color: 'var(--gold)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Perguntas sugeridas</span>
      </div>
      <div className="flex flex-wrap gap-2 mb-5">
        {suggestions.map(s => (
          <button key={s} onClick={() => { setQuestion(s); askJames(s) }}
            className="text-xs px-3 py-1.5 rounded-lg transition-all hover:scale-[1.02]"
            style={{ background: 'var(--surface-hover)', color: 'var(--text-main)', border: '1px solid var(--border)' }}>{s}</button>
        ))}
      </div>
      <div className="flex gap-2 mb-4">
        <input value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && askJames(question)}
          className="input-field flex-1" placeholder="Pergunte algo ao James sobre o negócio..." />
        <button onClick={() => askJames(question)} disabled={loading || !question.trim()}
          className="btn-primary px-4 disabled:opacity-30" style={{ borderRadius: 10 }}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
      {(response || loading) && (
        <div className="rounded-xl p-4 animate-fade-in" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: 'var(--gradient-accent)' }}>
              <Brain size={12} color="#fff" />
            </div>
            <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>James</span>
            {loading && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />}
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-main)' }}>{response || 'Pensando...'}</p>
        </div>
      )}
    </div>
  </div>)
}

// ═══════════════════════════════════════════════════════════════
// PROGRESS BAR
// ═══════════════════════════════════════════════════════════════
function ProgressBar({ step, completed, onGoTo }: { step: number; completed: number[]; onGoTo: (s: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-1 mb-8 overflow-x-auto pb-2">
      {STEPS.map((s, i) => {
        const isActive = s.id === step
        const isDone = completed.includes(s.id)
        const isPast = s.id < step
        return (
          <div key={s.id} className="flex items-center">
            <button onClick={() => onGoTo(s.id)} className="flex flex-col items-center gap-1.5 px-2 py-1 rounded-xl transition-all group"
              style={{ minWidth: 70, background: isActive ? 'var(--accent-muted)' : 'transparent' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center transition-all text-xs font-bold"
                style={{
                  background: isActive ? 'var(--accent)' : isDone || isPast ? 'rgba(0,180,255,0.15)' : 'var(--surface-hover)',
                  color: isActive ? '#fff' : isDone || isPast ? 'var(--accent)' : 'var(--text-subtle)',
                  border: `2px solid ${isActive ? 'var(--accent)' : isDone || isPast ? 'rgba(0,180,255,0.3)' : 'var(--border)'}`,
                  boxShadow: isActive ? '0 0 16px rgba(0,180,255,0.4)' : 'none',
                }}>
                {isDone || isPast ? <Check size={14} /> : s.id}
              </div>
              <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>{s.title}</span>
            </button>
            {i < STEPS.length - 1 && (
              <div className="w-6 h-px mx-0.5" style={{ background: isPast || isDone ? 'var(--accent)' : 'var(--border)', opacity: isPast || isDone ? 0.5 : 0.3 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function JamesTraining() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id ?? ''
  const [step, setStep] = useState(1)
  const [ctx, setCtx] = useState<BusinessContext>(BEAUTY_HUB_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [finalized, setFinalized] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500) }
  const update = useCallback((partial: Partial<BusinessContext>) => setCtx(prev => ({ ...prev, ...partial })), [])

  // Load saved state
  useEffect(() => {
    if (!tenantId) return
    const load = async () => {
      const { data } = await supabase.from('james_memories').select('response').eq('tenant_id', tenantId).eq('category', 'training:wizard-state').limit(1)
      if (data?.[0]?.response) {
        try { const { currentStep, ...saved } = JSON.parse(data[0].response); setCtx(prev => ({ ...prev, ...saved })); setStep(currentStep ?? 1) } catch { /* use defaults */ }
      }
      // Opening this page only reads saved state. Writes require an explicit user action.
      setLoading(false)
    }
    void load()
  }, [tenantId])

  // Navigate
  const goTo = async (nextStep: number) => {
    if (nextStep < 1 || nextStep > 7 || !tenantId || saving) return
    setSaving(true)
    try {
      await saveWizardState(tenantId, ctx, nextStep)
      if (nextStep > step) {
        await syncLearningMemories(tenantId, ctx)
        setCtx(prev => ({ ...prev, completedSteps: [...new Set([...prev.completedSteps, step])] }))
      }
      showToast('Progresso salvo')
    } catch { showToast('Erro ao salvar', 'error') }
    finally { setSaving(false) }
    setStep(nextStep)
  }

  const handleFinalize = async () => {
    if (!tenantId) return
    setSaving(true)
    try {
      const count = await syncLearningMemories(tenantId, ctx)
      await saveWizardState(tenantId, { ...ctx, completedSteps: [1, 2, 3, 4, 5, 6, 7] }, 7)
      setFinalized(true)
      showToast(`Treinamento finalizado — ${count} memórias salvas`)
    } catch { showToast('Erro ao finalizar', 'error') }
    finally { setSaving(false) }
  }

  if (loading) {
    return (
      <AppLayout title="James Training" subtitle="Carregando progresso...">
        <div className="flex items-center justify-center py-32"><Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
      </AppLayout>
    )
  }

  const stepProps: StepProps = { ctx, update }

  return (
    <AppLayout title="James Training" subtitle="Ensine o James a compreender seu negócio">
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      <ProgressBar step={step} completed={ctx.completedSteps} onGoTo={goTo} />

      <div className="max-w-4xl mx-auto">
        <div className="rounded-2xl p-6 md:p-8 animate-fade-in" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
          key={step}>
          {step === 1 && <Step1 {...stepProps} />}
          {step === 2 && <Step2 {...stepProps} />}
          {step === 3 && <Step3 {...stepProps} />}
          {step === 4 && <Step4 {...stepProps} />}
          {step === 5 && <Step5 {...stepProps} />}
          {step === 6 && <Step6 {...stepProps} />}
          {step === 7 && <Step7 {...stepProps} tenantId={tenantId} />}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 mb-12">
          <button onClick={() => goTo(step - 1)} disabled={step === 1 || saving}
            className="btn-secondary flex items-center gap-2 disabled:opacity-20">
            <ChevronLeft size={16} /> Voltar
          </button>

          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            <span>{step} de {STEPS.length}</span>
          </div>

          {step < 7 ? (
            <button onClick={() => goTo(step + 1)} disabled={saving}
              className="btn-primary flex items-center gap-2">
              Próximo <ChevronRight size={16} />
            </button>
          ) : (
            <button onClick={handleFinalize} disabled={saving || finalized}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-black transition-all disabled:opacity-40"
              style={{ background: 'var(--gradient-gold)', boxShadow: finalized ? 'none' : 'var(--shadow-gold)' }}>
              {finalized ? <><Check size={16} /> James Aprendeu</> : saving ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : <><Brain size={16} /> Finalizar Aprendizado</>}
            </button>
          )}
        </div>

        {/* Finalized success card */}
        {finalized && (
          <div className="rounded-2xl p-6 mb-8 text-center animate-fade-in" style={{ background: 'rgba(0,180,255,0.06)', border: '1px solid rgba(0,180,255,0.2)' }}>
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-accent)' }}>
              <Brain size={28} color="#fff" />
            </div>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--accent)' }}>James compreendeu o negócio</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Todo o contexto foi salvo. O James agora responde com base no que aprendeu sobre o The Beauty Hub.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => { setFinalized(false); goTo(1) }} className="btn-secondary text-sm">← Editar contexto</button>
              <button onClick={() => { setFinalized(false) }} className="btn-primary text-sm">Testar mais →</button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
