import { useState, useEffect } from 'react'
import { Megaphone, Rocket, UserPlus, ArrowRightLeft, Clock, CheckCircle2, Pause, Play, Eye } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/tenant-context'
import { supabase } from '../lib/supabase'

interface Campanha {
  id: string
  name: string
  type: 'lancamento' | 'boas_vindas' | 'circulacao'
  status: 'rascunho' | 'ativa' | 'pausada' | 'concluida'
  message: string
  target: string
  reach: number
}

const TYPE_CONFIG = {
  lancamento:  { icon: Rocket,          color: '#C2185B', bg: 'rgba(194,24,91,0.08)',  label: 'Lançamento' },
  boas_vindas: { icon: UserPlus,        color: '#10b981', bg: 'rgba(16,185,129,0.08)', label: 'Boas-vindas' },
  circulacao:  { icon: ArrowRightLeft,  color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', label: 'Circulação' },
}
const STATUS_CONFIG = {
  rascunho:  { icon: Clock,        color: '#6b7280', label: 'Rascunho' },
  ativa:     { icon: CheckCircle2, color: '#10b981', label: 'Ativa' },
  pausada:   { icon: Pause,        color: '#f59e0b', label: 'Pausada' },
  concluida: { icon: CheckCircle2, color: '#3b82f6', label: 'Concluída' },
}

export default function Campanhas() {
  const { tenant } = useTenant()
  const [campanhas, setCampanhas] = useState<Campanha[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [editMessage, setEditMessage] = useState('')
  const [totalEstabelecimentos, setTotalEstabelecimentos] = useState(0)
  const [totalClientes, setTotalClientes] = useState(0)

  useEffect(() => {
    // Carrega contadores reais para estimar alcance
    if (tenant?.id) {
      supabase.from('tenants').select('id', { count: 'exact', head: true }).then(r => setTotalEstabelecimentos(r.count ?? 0))
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).then(r => setTotalClientes(r.count ?? 0))
    }

    // Templates de campanha pré-definidos
    setCampanhas([
      {
        id: '1', name: 'Lançamento — Convite Estabelecimentos',
        type: 'lancamento', status: 'rascunho',
        message: 'Olá! Somos a plataforma O Núcleo e estamos selecionando os melhores salões da região para fazer parte da nossa rede. Gostaria de saber mais?',
        target: 'Estabelecimentos novos na região',
        reach: 0,
      },
      {
        id: '2', name: 'Boas-vindas — Primeiro Agendamento',
        type: 'boas_vindas', status: 'rascunho',
        message: 'Bem-vinda ao Núcleo! 🎉 Você já conhece nossos parceiros? Temos salões, clínicas e barbearias incríveis perto de você. Quer ver os serviços disponíveis?',
        target: 'Clientes que acabaram de se cadastrar',
        reach: 0,
      },
      {
        id: '3', name: 'Circulação — Descubra Novos Serviços',
        type: 'circulacao', status: 'rascunho',
        message: 'Oi! Vi que você costuma ir ao salão. Sabia que temos parceiros com serviços de estética e barbearia com condições especiais? Quer conhecer?',
        target: 'Clientes ativos → outros serviços',
        reach: 0,
      },
    ])
  }, [tenant])

  const toggleStatus = (id: string) => {
    setCampanhas(prev => prev.map(c => {
      if (c.id !== id) return c
      const next = c.status === 'rascunho' ? 'ativa'
        : c.status === 'ativa' ? 'pausada'
        : c.status === 'pausada' ? 'ativa'
        : c.status
      return { ...c, status: next as Campanha['status'] }
    }))
  }

  const saveMessage = (id: string) => {
    setCampanhas(prev => prev.map(c => c.id === id ? { ...c, message: editMessage } : c))
    setEditId(null)
  }

  const getEstimatedReach = (type: string) => {
    if (type === 'lancamento') return totalEstabelecimentos
    return totalClientes
  }

  return (
    <AppLayout title="Campanhas" subtitle="Ativação e crescimento da base">
      {/* Info */}
      <div className="card mb-5 animate-fade-in" style={{ borderLeft: '3px solid var(--accent)' }}>
        <div className="flex items-start gap-3">
          <Megaphone size={20} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-main)' }}>
              Campanhas de Lançamento
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Configure a mensagem de cada campanha, ative quando estiver pronto.
              O James usará estas mensagens como base para abordar os contatos pelo WhatsApp.
            </p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Campanhas Ativas', value: String(campanhas.filter(c => c.status === 'ativa').length), color: '#10b981' },
          { label: 'Estabelecimentos', value: String(totalEstabelecimentos), color: 'var(--accent)' },
          { label: 'Clientes na Base', value: String(totalClientes), color: '#3b82f6' },
        ].map(k => (
          <div key={k.label} className="card">
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
            <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Campaign Cards */}
      <div className="flex flex-col gap-4">
        {campanhas.map(camp => {
          const typeConf = TYPE_CONFIG[camp.type]
          const statusConf = STATUS_CONFIG[camp.status]
          const TypeIcon = typeConf.icon
          const StatusIcon = statusConf.icon
          const isEditing = editId === camp.id
          const reach = getEstimatedReach(camp.type)

          return (
            <div key={camp.id} className="card animate-fade-in" style={{ borderLeft: `3px solid ${typeConf.color}` }}>
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
                    style={{ background: typeConf.bg, color: typeConf.color }}>
                    <TypeIcon size={13} />{typeConf.label}
                  </span>
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-main)' }}>{camp.name}</h3>
                </div>
                <span className="flex items-center gap-1 text-xs" style={{ color: statusConf.color }}>
                  <StatusIcon size={12} />{statusConf.label}
                </span>
              </div>

              {/* Target + Reach */}
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                🎯 {camp.target} · Alcance estimado: <strong>{reach}</strong> contatos
              </p>

              {/* Message */}
              <div className="mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Mensagem do James
                </p>
                {isEditing ? (
                  <div>
                    <textarea value={editMessage}
                      onChange={e => setEditMessage(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 rounded-xl text-sm resize-none"
                      style={{ background: 'var(--surface-main)', border: '1px solid var(--border)', color: 'var(--text-main)' }}
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <button onClick={() => setEditId(null)}
                        className="btn-secondary px-3 py-1.5 text-xs">Cancelar</button>
                      <button onClick={() => saveMessage(camp.id)}
                        className="btn-primary px-3 py-1.5 text-xs">Salvar</button>
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-2.5 rounded-xl text-sm cursor-pointer transition-colors"
                    style={{ background: 'var(--surface-main)', border: '1px solid var(--border)', color: 'var(--text-main)' }}
                    onClick={() => { setEditId(camp.id); setEditMessage(camp.message) }}>
                    <p className="text-xs" style={{ color: 'var(--text-main)' }}>"{camp.message}"</p>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Clique para editar</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                {camp.status === 'rascunho' && (
                  <button onClick={() => toggleStatus(camp.id)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
                    style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <Play size={12} />Ativar Campanha
                  </button>
                )}
                {camp.status === 'ativa' && (
                  <button onClick={() => toggleStatus(camp.id)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
                    style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <Pause size={12} />Pausar
                  </button>
                )}
                {camp.status === 'pausada' && (
                  <button onClick={() => toggleStatus(camp.id)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
                    style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <Play size={12} />Retomar
                  </button>
                )}
                {!isEditing && (
                  <button onClick={() => { setEditId(camp.id); setEditMessage(camp.message) }}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
                    style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                    <Eye size={12} />Editar Mensagem
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </AppLayout>
  )
}
