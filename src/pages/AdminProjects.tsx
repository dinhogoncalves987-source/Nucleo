import { useState, useEffect } from 'react'
import { ShieldCheck, Plus, Layers, Trash2, Users, ExternalLink } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { supabase } from '../lib/supabase'
import type { Tenant } from '../types'

export default function AdminProjects() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => { fetchTenants() }, [])

  const fetchTenants = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: true })
    if (!error && data) setTenants(data as Tenant[])
    setLoading(false)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setFormError(null)
    const { data, error } = await supabase
      .from('tenants')
      .insert({ name: newName.trim() })
      .select()
      .single()
    if (error) {
      if (error.code === '42501' || error.message?.includes('row-level security')) {
        setFormError('Permissão negada. Execute o arquivo supabase/fix_rls.sql no Supabase SQL Editor.')
      } else {
        setFormError(error.message)
      }
    } else if (data) {
      setTenants(prev => [...prev, data as Tenant])
      setNewName(''); setShowForm(false)
    }
    setCreating(false)
  }

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('tenants').delete().eq('id', id)
    if (!error) setTenants(prev => prev.filter(t => t.id !== id))
  }

  return (
    <AppLayout title="SuperAdmin — Projetos" subtitle="Gestão de tenants e isolamento de banco de dados">
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {loading ? '...' : `${tenants.length} tenants ativos`}
        </p>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary gap-2">
          <Plus size={15} /> Novo Projeto (Tenant)
        </button>
      </div>

      {showForm && (
        <div className="card mb-4 animate-fade-in" style={{ borderColor: 'var(--accent)' }}>
          <p className="section-title">Criar novo ambiente isolado</p>
          <p className="section-subtitle">Cada projeto tem seu próprio banco isolado por RLS</p>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <div className="flex gap-3">
              <input className="input-field flex-1" placeholder="Nome do projeto"
                value={newName} onChange={e => { setNewName(e.target.value); setFormError(null) }} autoFocus required />
              <button type="submit" disabled={creating} className="btn-primary gap-2 whitespace-nowrap">
                {creating
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><Layers size={15} /> Criar</>}
              </button>
            </div>
            {formError && (
              <div className="px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626' }}>
                ⚠️ {formError}
              </div>
            )}
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tenants.map(tenant => (
            <div key={tenant.id} className="card group animate-fade-in"
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-accent)' }}>
                  <span className="text-white font-bold text-lg">{tenant.name.charAt(0)}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)' }}>
                    <ExternalLink size={13} />
                  </button>
                  <button onClick={() => handleDelete(tenant.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#dc2626'; (e.currentTarget as HTMLElement).style.background = 'rgba(220,38,38,0.08)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <h3 className="font-bold mb-1" style={{ fontFamily: "'Playfair Display', serif", color: 'var(--text-main)' }}>
                {tenant.name}
              </h3>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Criado em {new Date(tenant.created_at!).toLocaleDateString('pt-BR')}
              </p>
              <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <Users size={13} /> Banco isolado
                </span>
                <span className="badge-success">Ativo</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* System overview */}
      <div className="card mt-5">
        <p className="section-title flex items-center gap-2">
          <ShieldCheck size={17} style={{ color: '#7c3aed' }} /> Visão do Sistema
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3">
          {[
            { v: tenants.length, l: 'Tenants Ativos', c: 'var(--accent)' },
            { v: tenants.length * 2, l: 'Usuários Est.', c: 'var(--gold)' },
            { v: '99,8%', l: 'Uptime', c: '#10b981' },
            { v: '42%', l: 'CPU Média', c: '#7c3aed' },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <p className="font-bold text-2xl" style={{ fontFamily: "'Playfair Display', serif", color: s.c }}>{s.v}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{s.l}</p>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
