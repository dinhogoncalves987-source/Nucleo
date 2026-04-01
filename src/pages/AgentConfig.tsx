import { useState, useEffect, useRef } from 'react'
import { Bot, Upload, FileText, Trash2, Brain, AlertCircle, CheckCircle2, Plus } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/TenantContext'
import { supabase } from '../lib/supabase'
import type { KnowledgeBase } from '../types'

interface KBRow extends KnowledgeBase { uploading?: boolean }

export default function AgentConfig() {
  const { tenant } = useTenant()
  const [docs, setDocs] = useState<KBRow[]>([])
  const [loading, setLoading] = useState(true)
  const [agentName, setAgentName] = useState('James')
  const [agentRole, setAgentRole] = useState('Assistente de qualificação de leads para salões de beleza')
  const [agentTone, setAgentTone] = useState<string>('profissional')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (tenant?.id) fetchDocs() }, [tenant])

  const fetchDocs = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('knowledge_bases')
      .select('*')
      .eq('tenant_id', tenant!.id)
      .order('created_at', { ascending: false })
    if (!error && data) setDocs(data as KBRow[])
    setLoading(false)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const tempId = `temp-${Date.now()}`
    const tempDoc: KBRow = {
      id: tempId, tenant_id: tenant!.id,
      file_url: URL.createObjectURL(file),
      description: file.name, created_at: new Date().toISOString(),
      uploading: true,
    }
    setDocs(prev => [tempDoc, ...prev])

    try {
      // Insert knowledge base record
      const { data, error } = await supabase
        .from('knowledge_bases')
        .insert({
          tenant_id: tenant!.id,
          file_url: `uploads/${tenant!.id}/${file.name}`,
          description: file.name,
        })
        .select()
        .single()

      if (!error && data) {
        setDocs(prev => prev.map(d => d.id === tempId ? { ...data as KBRow, uploading: false } : d))
      } else {
        setDocs(prev => prev.filter(d => d.id !== tempId))
      }
    } catch (err) {
      setDocs(prev => prev.filter(d => d.id !== tempId))
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDeleteDoc = async (id: string) => {
    await supabase.from('knowledge_bases').delete().eq('id', id)
    setDocs(prev => prev.filter(d => d.id !== id))
  }

  const handleSaveAgent = async () => {
    setSaving(true)
    // Upsert agent config as a special api_key record
    await supabase.from('api_keys').upsert({
      tenant_id: tenant!.id,
      service_name: 'agent_config',
      api_key: JSON.stringify({ name: agentName, role: agentRole, tone: agentTone }),
    }, { onConflict: 'tenant_id,service_name' })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <AppLayout title="Ag. James" subtitle="Configuração do Agente de IA">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Agent config */}
        <div className="card">
          <p className="section-title flex items-center gap-2">
            <Bot size={16} style={{ color: 'var(--accent)' }} /> Personalidade do Agente
          </p>
          <p className="section-subtitle">Configurações salvas no banco de dados</p>

          <div className="flex flex-col gap-4">
            <div>
              <label className="label">Nome do Agente</label>
              <input className="input-field" value={agentName} onChange={e => setAgentName(e.target.value)} />
            </div>
            <div>
              <label className="label">Função / Papel</label>
              <textarea className="input-field" rows={3} value={agentRole} onChange={e => setAgentRole(e.target.value)} />
            </div>
            <div>
              <label className="label">Tom de Comunicação</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {['profissional', 'descontraído', 'direto', 'empático'].map(tone => (
                  <button key={tone} onClick={() => setAgentTone(tone)}
                    className={`py-2 px-3 rounded-xl text-xs font-medium capitalize transition-all ${agentTone === tone ? 'btn-primary' : 'btn-secondary'}`}
                    style={agentTone !== tone ? {} : {}}>
                    {tone}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={handleSaveAgent} disabled={saving}
              className={saved ? '' : 'btn-primary gap-2'}
              style={saved ? {
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'rgba(16,185,129,0.1)', color: '#059669',
                border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10,
                padding: '10px', fontWeight: 600, fontSize: 14, cursor: 'default', width: '100%', justifyContent: 'center',
              } : {}}>
              {saved
                ? <><CheckCircle2 size={15} /> Salvo no banco!</>
                : saving
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><Brain size={15} /> Salvar Configuração</>}
            </button>
          </div>
        </div>

        {/* Knowledge Base */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="section-title flex items-center gap-2">
                <FileText size={16} style={{ color: 'var(--gold)' }} /> Base de Conhecimento (RAG)
              </p>
              <p className="section-subtitle">Documentos para alimentar o agente James</p>
            </div>
            <button onClick={() => fileInputRef.current?.click()} className="btn-gold gap-2">
              <Plus size={14} /> Adicionar
            </button>
          </div>

          <label
            className="flex flex-col items-center justify-center border-2 border-dashed rounded-xl py-8 cursor-pointer transition-colors mb-4"
            style={{ borderColor: 'var(--border)' }}
            onDragOver={e => e.preventDefault()}
          >
            <Upload size={24} style={{ color: 'var(--text-muted)' }} className="mb-2" />
            <span className="text-sm font-medium" style={{ color: 'var(--text-main)' }}>Arraste arquivos ou clique</span>
            <span className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>PDF, DOCX, TXT — máx. 10MB</span>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.csv" className="hidden" onChange={handleFileUpload} />
          </label>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : docs.length === 0 ? (
            <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'var(--surface-hover)' }}>
              <AlertCircle size={16} style={{ color: 'var(--text-muted)' }} />
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Nenhum documento adicionado ainda.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {docs.map(doc => (
                <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl transition-colors"
                  style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--gold-muted)', color: 'var(--gold)' }}>
                    <FileText size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-main)' }}>{doc.description}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {doc.uploading ? 'Enviando...' : new Date(doc.created_at!).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  {doc.uploading
                    ? <div className="w-4 h-4 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
                    : <button onClick={() => handleDeleteDoc(doc.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#dc2626'; (e.currentTarget as HTMLElement).style.background = 'rgba(220,38,38,0.08)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                        <Trash2 size={13} />
                      </button>
                  }
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
