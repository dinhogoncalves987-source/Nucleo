import { useState, useEffect } from 'react'
import { Store, Plus, Search, Phone, MapPin, CheckCircle2, Clock, XCircle, Pencil, X, Save } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { supabase } from '../lib/supabase'

interface Estabelecimento {
  id: string
  name: string
  phone: string | null
  address: string | null
  segment: string
  status: string
  created_at: string
}

const SEGMENT_LABELS: Record<string, string> = {
  salao: 'Salão', clinica: 'Clínica', barbearia: 'Barbearia', estetica: 'Estética', outro: 'Outro',
}
const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string; icon: typeof CheckCircle2 }> = {
  pendente: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', label: 'Pendente', icon: Clock },
  ativo:    { color: '#10b981', bg: 'rgba(16,185,129,0.08)', label: 'Ativo',    icon: CheckCircle2 },
  inativo:  { color: '#6b7280', bg: 'rgba(107,114,128,0.08)', label: 'Inativo', icon: XCircle },
}

const inputStyle = {
  background: 'var(--surface-main)', border: '1px solid var(--border)', color: 'var(--text-main)',
}

export default function Estabelecimentos() {
  const [items, setItems] = useState<Estabelecimento[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', address: '', segment: 'salao' })
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '', address: '', segment: '' })

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('tenants')
      .select('id, name, phone, address, segment, status, created_at')
      .order('created_at', { ascending: false })
    setItems((data as Estabelecimento[]) ?? [])
    setLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    await supabase.from('tenants').insert({
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      segment: form.segment,
      status: 'pendente',
    })
    setForm({ name: '', phone: '', address: '', segment: 'salao' })
    setShowForm(false)
    setSaving(false)
    fetchData()
  }

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('tenants').update({ status }).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i))
  }

  const startEdit = (item: Estabelecimento) => {
    setEditId(item.id)
    setEditForm({ name: item.name, phone: item.phone ?? '', address: item.address ?? '', segment: item.segment ?? 'salao' })
  }

  const saveEdit = async () => {
    if (!editId || !editForm.name.trim()) return
    await supabase.from('tenants').update({
      name: editForm.name.trim(),
      phone: editForm.phone.trim() || null,
      address: editForm.address.trim() || null,
      segment: editForm.segment,
    }).eq('id', editId)
    setEditId(null)
    fetchData()
  }

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.phone?.includes(search) ||
    i.address?.toLowerCase().includes(search.toLowerCase())
  )

  const total = items.length
  const ativos = items.filter(i => i.status === 'ativo').length
  const pendentes = items.filter(i => i.status === 'pendente').length
  const taxaAtivacao = total > 0 ? ((ativos / total) * 100).toFixed(0) : '0'

  return (
    <AppLayout title="Estabelecimentos" subtitle="Salões, clínicas e parceiros da plataforma">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Total', value: String(total), color: 'var(--accent)' },
          { label: 'Ativos', value: String(ativos), color: '#10b981' },
          { label: 'Pendentes', value: String(pendentes), color: '#f59e0b' },
          { label: 'Taxa de Ativação', value: `${taxaAtivacao}%`, color: '#7c3aed' },
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
          <input
            type="text" placeholder="Buscar por nome, telefone ou endereço..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm" style={inputStyle}
          />
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditId(null) }}
          className="btn-primary flex items-center gap-2 px-4 py-2.5 text-sm whitespace-nowrap">
          <Plus size={15} /> Novo Estabelecimento
        </button>
      </div>

      {/* Form de cadastro */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card mb-4 animate-fade-in">
          <p className="section-title mb-3">Cadastro Rápido</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input type="text" placeholder="Nome *" required value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            <input type="tel" placeholder="Telefone" value={form.phone}
              onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            <input type="text" placeholder="Endereço" value={form.address}
              onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            <select value={form.segment} onChange={e => setForm(p => ({ ...p, segment: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle}>
              {Object.entries(SEGMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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

      {/* Lista */}
      <div className="card overflow-hidden" style={{ padding: 0 }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface-hover)', borderBottom: '1px solid var(--border)' }}>
                {['Nome', 'Segmento', 'Telefone', 'Endereço', 'Status', 'Ações'].map(h => (
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
                  <Store size={32} className="mx-auto mb-2 opacity-30" />
                  Nenhum estabelecimento encontrado
                </td></tr>
              ) : filtered.map(item => {
                const isEditing = editId === item.id
                const st = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pendente
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
                        <select value={editForm.segment}
                          onChange={e => setEditForm(p => ({ ...p, segment: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg text-xs w-full" style={inputStyle}>
                          {Object.entries(SEGMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input type="tel" value={editForm.phone}
                          onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg text-sm w-full" style={inputStyle} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" value={editForm.address}
                          onChange={e => setEditForm(p => ({ ...p, address: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg text-sm w-full" style={inputStyle} />
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

                return (
                  <tr key={item.id} className="transition-colors" style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-main)' }}>{item.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-lg text-xs" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                        {SEGMENT_LABELS[item.segment] ?? item.segment ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                      {item.phone ? <span className="flex items-center gap-1"><Phone size={12} />{item.phone}</span> : '—'}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                      {item.address ? <span className="flex items-center gap-1"><MapPin size={12} />{item.address}</span> : '—'}
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
                        {item.status === 'pendente' && (
                          <button onClick={() => updateStatus(item.id, 'ativo')}
                            className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                            Ativar
                          </button>
                        )}
                        {item.status === 'ativo' && (
                          <button onClick={() => updateStatus(item.id, 'inativo')}
                            className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                            style={{ background: 'rgba(107,114,128,0.1)', color: '#6b7280', border: '1px solid rgba(107,114,128,0.2)' }}>
                            Desativar
                          </button>
                        )}
                        {item.status === 'inativo' && (
                          <button onClick={() => updateStatus(item.id, 'ativo')}
                            className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                            Reativar
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
