import { useState, useEffect } from 'react'
import { Plug, Eye, EyeOff, Save, CheckCircle2, RefreshCw, Users, Calendar, Bot } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/tenant-context'
import { supabase } from '../lib/supabase'
import { bubbleHealthCheck, BubbleClientes, BubbleAgendamentos } from '../lib/bubble'
import { checkOpenAIKey } from '../lib/openai'

interface IntegrationState {
  service: string; label: string; description: string
  apiKey: string; webhookUrl: string; colorHex: string
}

const SERVICE_META = [
  { service: 'whatsapp', label: 'Evolution API — WhatsApp', description: 'Chave para envio de mensagens via Evolution API', colorHex: '#10b981' },
  { service: 'bubble',   label: 'Bubble.io — The Beauty Hub', description: 'Token da API do Bubble (thebeautyhub.com.br)', colorHex: '#3b82f6' },
  { service: 'openai',   label: 'OpenAI — GPT-4o', description: 'Chave para o agente James e processamento de linguagem', colorHex: '#7c3aed' },
]

export default function Integrations() {
  const { tenant } = useTenant()
  const [integrations, setIntegrations] = useState<IntegrationState[]>(
    SERVICE_META.map(m => ({ ...m, apiKey: '', webhookUrl: '' }))
  )
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [savedService, setSavedService] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [bubbleStatus, setBubbleStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [bubbleStats, setBubbleStats] = useState<{ clientes: number; agendamentos: number } | null>(null)
  const [openaiStatus, setOpenaiStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  useEffect(() => {
    if (tenant?.id) fetchKeys()
    checkBubble()
    checkOpenAI()
  }, [tenant])

  const fetchKeys = async () => {
    setLoading(true)
    const { data } = await supabase.from('api_keys').select('*').eq('tenant_id', tenant!.id)
    if (data?.length) {
      setIntegrations(prev => prev.map(integ => {
        const found = data.find(d => d.service_name === integ.service)
        return found ? { ...integ, apiKey: found.api_key, webhookUrl: found.webhook_url ?? '' } : integ
      }))
    }
    // Pre-fill Bubble token from env
    setIntegrations(prev => prev.map(i =>
      i.service === 'bubble' && !i.apiKey
        ? { ...i, apiKey: import.meta.env.VITE_BUBBLE_API_TOKEN ?? '' }
        : i
    ))
    setLoading(false)
  }

  const checkBubble = async () => {
    setBubbleStatus('checking')
    const ok = await bubbleHealthCheck()
    setBubbleStatus(ok ? 'online' : 'offline')
    if (ok) {
      try {
        const [clientes, agendamentos] = await Promise.all([
          BubbleClientes.list(1),
          BubbleAgendamentos.list(1),
        ])
        setBubbleStats({ clientes: clientes.length, agendamentos: agendamentos.length })
        const [allC, allA] = await Promise.all([BubbleClientes.list(200), BubbleAgendamentos.list(200)])
        setBubbleStats({ clientes: allC.length, agendamentos: allA.length })
      } catch { /* silently ignore */ }
    }
  }

  const checkOpenAI = async () => {
    setOpenaiStatus('checking')
    const ok = await checkOpenAIKey()
    setOpenaiStatus(ok ? 'online' : 'offline')
    // If backend has a working key, show masked indicator in the UI
    if (ok) {
      setIntegrations(prev => prev.map(i =>
        i.service === 'openai' && !i.apiKey
          ? { ...i, apiKey: 'sk-●●●●●●●●●●●●●●●● (configurada no backend)' }
          : i
      ))
    }
  }

  const updateField = (service: string, field: 'apiKey' | 'webhookUrl', value: string) =>
    setIntegrations(prev => prev.map(i => i.service === service ? { ...i, [field]: value } : i))

  const handleSave = async (integ: IntegrationState) => {
    // Don't save the masked placeholder to Supabase
    const keyToSave = integ.apiKey.includes('●●●') ? '' : integ.apiKey
    await supabase.from('api_keys').upsert({
      tenant_id: tenant!.id,
      service_name: integ.service,
      api_key: keyToSave,
      webhook_url: integ.webhookUrl || null,
    }, { onConflict: 'tenant_id,service_name' })

    setSavedService(integ.service)
    setTimeout(() => setSavedService(null), 2500)
    if (integ.service === 'bubble') checkBubble()
    if (integ.service === 'openai') checkOpenAI()
  }

  return (
    <AppLayout title="Conexões & APIs" subtitle="Credenciais e status das integrações">
      {/* Status Cards Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Bubble Status Card */}
        <div className="card animate-fade-in" style={{
          borderColor: bubbleStatus === 'online' ? '#10b981' : bubbleStatus === 'offline' ? '#ef4444' : 'var(--border)',
        }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#3b82f618', color: '#3b82f6' }}>
                <Plug size={18} />
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-main)' }}>Bubble.io — The Beauty Hub</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>thebeautyhub.com.br</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{
                  background: bubbleStatus === 'online' ? '#10b981' : bubbleStatus === 'offline' ? '#ef4444' : '#f59e0b',
                  boxShadow: bubbleStatus === 'online' ? '0 0 6px #10b981' : 'none',
                }} />
                <span className="text-xs font-medium" style={{
                  color: bubbleStatus === 'online' ? '#10b981' : bubbleStatus === 'offline' ? '#ef4444' : '#f59e0b',
                }}>
                  {bubbleStatus === 'checking' ? 'Verificando...' : bubbleStatus === 'online' ? 'Conectado' : 'Desconectado'}
                </span>
              </div>
              <button onClick={checkBubble} className="btn-secondary py-1 px-2 gap-1 text-xs">
                <RefreshCw size={11} /> Testar
              </button>
            </div>
          </div>
          {bubbleStatus === 'online' && bubbleStats && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--surface-hover)' }}>
                <Users size={15} style={{ color: '#3b82f6' }} />
                <div>
                  <p className="text-lg font-bold" style={{ color: 'var(--text-main)' }}>{bubbleStats.clientes}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Clientes no Bubble</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--surface-hover)' }}>
                <Calendar size={15} style={{ color: 'var(--accent)' }} />
                <div>
                  <p className="text-lg font-bold" style={{ color: 'var(--text-main)' }}>{bubbleStats.agendamentos}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Agendamentos</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* OpenAI Status Card */}
        <div className="card animate-fade-in" style={{
          borderColor: openaiStatus === 'online' ? '#10b981' : openaiStatus === 'offline' ? '#ef4444' : 'var(--border)',
        }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#7c3aed18', color: '#7c3aed' }}>
                <Bot size={18} />
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-main)' }}>OpenAI — James Engine</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>GPT-4o-mini + Whisper + TTS (via backend)</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{
                  background: openaiStatus === 'online' ? '#10b981' : openaiStatus === 'offline' ? '#ef4444' : '#f59e0b',
                  boxShadow: openaiStatus === 'online' ? '0 0 6px #10b981' : 'none',
                }} />
                <span className="text-xs font-medium" style={{
                  color: openaiStatus === 'online' ? '#10b981' : openaiStatus === 'offline' ? '#ef4444' : '#f59e0b',
                }}>
                  {openaiStatus === 'checking' ? 'Verificando...' : openaiStatus === 'online' ? 'Conectado' : 'Desconectado'}
                </span>
              </div>
              <button onClick={checkOpenAI} className="btn-secondary py-1 px-2 gap-1 text-xs">
                <RefreshCw size={11} /> Testar
              </button>
            </div>
          </div>
          {openaiStatus === 'online' && (
            <div className="grid grid-cols-3 gap-3 mt-2">
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--surface-hover)' }}>
                <span className="text-xs" style={{ color: '#7c3aed' }}>🧠</span>
                <div>
                  <p className="text-xs font-bold" style={{ color: 'var(--text-main)' }}>GPT-4o-mini</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Raciocínio</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--surface-hover)' }}>
                <span className="text-xs" style={{ color: '#7c3aed' }}>🎤</span>
                <div>
                  <p className="text-xs font-bold" style={{ color: 'var(--text-main)' }}>Whisper</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Transcrição</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--surface-hover)' }}>
                <span className="text-xs" style={{ color: '#7c3aed' }}>🔊</span>
                <div>
                  <p className="text-xs font-bold" style={{ color: 'var(--text-main)' }}>TTS Onyx</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Voz James</p>
                </div>
              </div>
            </div>
          )}
          {openaiStatus === 'offline' && (
            <div className="mt-2 p-3 rounded-xl text-xs" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', color: '#ef4444' }}>
              ⚠️ Backend offline ou chave OpenAI não configurada em <code style={{ background: 'rgba(239,68,68,0.1)', padding: '1px 4px', borderRadius: 4 }}>backend/.env</code>
            </div>
          )}
        </div>
      </div>

      {/* API Keys */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {integrations.map(integ => (
            <div key={integ.service} className="card">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ background: `${integ.colorHex}18`, color: integ.colorHex, border: `1px solid ${integ.colorHex}33` }}>
                    {integ.label.split('—')[0].trim()}
                  </span>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>{integ.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{integ.description}</p>
                  </div>
                </div>
                <div className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
                  style={{
                    background: integ.apiKey ? '#10b981' : 'var(--border)',
                    boxShadow: integ.apiKey ? '0 0 6px #10b981' : 'none',
                  }} />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className="label">API Key / Token</label>
                  <div className="relative">
                    <input
                      type={showKeys[integ.service] ? 'text' : 'password'}
                      className="input-field pr-10"
                      placeholder="Cole aqui a chave..."
                      value={integ.apiKey}
                      onChange={e => updateField(integ.service, 'apiKey', e.target.value)}
                    />
                    <button type="button"
                      onClick={() => setShowKeys(prev => ({ ...prev, [integ.service]: !prev[integ.service] }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: 'var(--text-muted)' }}>
                      {showKeys[integ.service] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                {integ.service !== 'openai' && (
                  <div className="flex-1">
                    <label className="label">Webhook / URL</label>
                    <input className="input-field" placeholder="https://..."
                      value={integ.webhookUrl} onChange={e => updateField(integ.service, 'webhookUrl', e.target.value)} />
                  </div>
                )}
                <div className="flex items-end">
                  <button onClick={() => handleSave(integ)}
                    className={savedService === integ.service ? '' : 'btn-primary gap-2'}
                    style={savedService === integ.service ? {
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      background: 'rgba(16,185,129,0.1)', color: '#059669',
                      border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10,
                      padding: '10px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                    } : {}}>
                    {savedService === integ.service
                      ? <><CheckCircle2 size={14} /> Salvo!</>
                      : <><Save size={14} /> Salvar</>}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  )
}
