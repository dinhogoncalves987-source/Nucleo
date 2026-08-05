import { useState, useEffect, useCallback, useRef } from 'react'
import { UserCheck, Plus, Search, Phone, Mail, CheckCircle2, Clock, Star, Pencil, X, Save, Store } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/tenant-context'
import { supabase } from '../lib/supabase'

interface Cliente {
  id: string
  name: string | null
  phone: string
  email: string | null
  status: string
  source: string
  tenant_origin: string | null
  created_at: string
}

interface TenantOption { id: string; name: string }

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string; icon: typeof CheckCircle2 }> = {
  novo:       { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  label: 'Novo',       icon: Clock },
  ativo:      { color: '#10b981', bg: 'rgba(16,185,129,0.08)',  label: 'Ativo',      icon: CheckCircle2 },
  recorrente: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  label: 'Recorrente', icon: Star },
  inativo:    { color: '#6b7280', bg: 'rgba(107,114,128,0.08)', label: 'Inativo',    icon: Clock },
}

const inputStyle = {
  background: 'var(--surface-main)', border: '1px solid var(--border)', color: 'var(--text-main)',
}

export default function Clientes() {
  const { tenant } = useTenant()
  const [items, setItems] = useState<Cliente[]>([])
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', tenant_origin: '' })
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '', tenant_origin: '' })
  const tenantIdRef = useRef(tenant?.id)
  const contactsRequestRef = useRef(0)
  tenantIdRef.current = tenant?.id

  const fetchData = useCallback(async () => {
    const tenantId = tenantIdRef.current
    if (!tenantId) return
    const requestId = ++contactsRequestRef.current
    setLoading(true)
    const { data } = await supabase
      .from('contacts')
      .select('id, name, phone, email, status, source, tenant_origin, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    if (
      contactsRequestRef.current !== requestId ||
      tenantIdRef.current !== tenantId
    ) return
    setItems((data as Cliente[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchData()
    return () => { contactsRequestRef.current += 1 }
  }, [fetchData, tenant?.id])

  useEffect(() => {
    let cancelled = false
    const fetchTenants = async () => {
      const { data } = await supabase.from('tenants').select('id, name').order('name')
      if (!cancelled) setTenants((data as TenantOption[]) ?? [])
    }

    void fetchTenants()
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.phone.trim()) return
    setSaving(true)
    await supabase.from('contacts').insert({
      tenant_id: tenant!.id,
      name: form.name.trim() || null,
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      source: 'manual',
      status: 'novo',
      tenant_origin: form.tenant_origin || null,
    })
    setForm({ name: '', phone: '', email: '', tenant_origin: '' })
    setShowForm(false)
    setSaving(false)
    fetchData()
  }

  const startEdit = (item: Cliente) => {
    setEditId(item.id)
    setEditForm({
      name: item.name ?? '', phone: item.phone,
      email: item.email ?? '', tenant_origin: item.tenant_origin ?? '',
    })
  }

  const saveEdit = async () => {
    if (!editId) return
    await supabase.from('contacts').update({
      name: editForm.name.trim() || null,
      phone: editForm.phone.trim(),
      email: editForm.email.trim() || null,
      tenant_origin: editForm.tenant_origin || null,
    }).eq('id', editId)
    setEditId(null)
    fetchData()
  }

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('contacts').update({ status }).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i))
  }

  const tenantName = (id: string | null) => {
    if (!id) return null
    return tenants.find(t => t.id === id)?.name ?? null
  }

  const filtered = items.filter(i =>
    (i.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    i.phone.includes(search) ||
    (i.email ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const total = items.length
  const ativos = items.filter(i => i.status === 'ativo').length
  const recorrentes = items.filter(i => i.status === 'recorrente').length
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const novosSemana = items.filter(i => i.created_at > weekAgo).length

  return (
    <AppLayout title="Clientes" subtitle={`Base de clientes — ${tenant?.name}`}>
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Total de Clientes', value: String(total), color: 'var(--accent)' },
          { label: 'Novos esta semana', value: String(novosSemana), color: '#3b82f6' },
          { label: 'Ativos', value: String(ativos), color: '#10b981' },
          { label: 'Recorrentes', value: String(recorrentes), color: '#f59e0b' },
        ].map(k => (
          <div key={k.label} className="card">
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
            <p className="text-2xl font-bold" style={{ color: k.color }}>{loading ? '—' : k.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input type="text" placeholder="Buscar por nome, telefone ou email..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm" style={inputStyle} />
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditId(null) }}
          className="btn-primary flex items-center gap-2 px-4 py-2.5 text-sm whitespace-nowrap">
          <Plus size={15} /> Novo Cliente
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card mb-4 animate-fade-in">
          <p className="section-title mb-3">Cadastro Rápido</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input type="text" placeholder="Nome" value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            <input type="tel" placeholder="Telefone *" required value={form.phone}
              onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            <input type="email" placeholder="Email" value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            <select value={form.tenant_origin}
              onChange={e => setForm(p => ({ ...p, tenant_origin: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle}>
              <option value="">Estabelecimento de origem</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary px-4 py-2 text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">
              {saving ? 'Salvando...' : 'Cadastrar'}
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="card overflow-hidden" style={{ padding: 0 }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface-hover)', borderBottom: '1px solid var(--border)' }}>
                {['Nome', 'Telefone', 'Email', 'Estabelecimento', 'Status', 'Ações'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>Carregando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                  <UserCheck size={32} className="mx-auto mb-2 opacity-30" />
                  Nenhum cliente encontrado
                </td></tr>
              ) : filtered.map(item => {
                const isEditing = editId === item.id
                const st = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.novo
                const StIcon = st.icon

                if (isEditing) {
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', background: 'var(--accent-muted)' }}>
                      <td className="px-3 py-2">
                        <input type="text" value={editForm.name}
                          onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg text-sm w-full" style={inputStyle} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="tel" value={editForm.phone}
                          onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg text-sm w-full" style={inputStyle} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="email" value={editForm.email}
                          onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg text-sm w-full" style={inputStyle} />
                      </td>
                      <td className="px-3 py-2">
                        <select value={editForm.tenant_origin}
                          onChange={e => setEditForm(p => ({ ...p, tenant_origin: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg text-xs w-full" style={inputStyle}>
                          <option value="">—</option>
                          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium w-fit"
                          style={{ background: st.bg, color: st.color }}>
                          <StIcon size={12} />{st.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button onClick={saveEdit} className="text-xs px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                            <Save size={11} />Salvar
                          </button>
                          <button onClick={() => setEditId(null)} className="text-xs px-2 py-1.5 rounded-lg"
                            style={{ color: 'var(--text-muted)' }}>
                            <X size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                const origin = tenantName(item.tenant_origin)
                return (
                  <tr key={item.id} className="transition-colors" style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-main)' }}>{item.name ?? '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                      <span className="flex items-center gap-1"><Phone size={12} />{item.phone}</span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                      {item.email ? <span className="flex items-center gap-1"><Mail size={12} />{item.email}</span> : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {origin ? (
                        <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs"
                          style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                          <Store size={11} />{origin}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium w-fit"
                        style={{ background: st.bg, color: st.color }}>
                        <StIcon size={12} />{st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <button onClick={() => startEdit(item)}
                          className="text-xs px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-colors"
                          style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                          <Pencil size={11} />Editar
                        </button>
                        {item.status === 'novo' && (
                          <button onClick={() => updateStatus(item.id, 'ativo')}
                            className="text-xs px-2.5 py-1.5 rounded-lg font-medium"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                            Ativar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  )
}
