import { useState } from 'react'
import { Store, Plus, Search, Phone, MapPin, CheckCircle2, Clock, XCircle, Pencil, X, Save, RefreshCw } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/tenant-context'
import { tenantScope, tenantScopeKey, TENANT_POLICY_NOTICE, TENANT_PROVISIONING_NOTICE } from '../lib/tenant-directory'
import type { TenantDirectoryRow } from '../lib/tenant-directory'
import { TenantMutationFailure } from '../lib/tenant-operations'
import { useTenantAdministration } from '../lib/use-tenant-administration'

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
  const identity = useTenant()
  return <ScopedEstabelecimentos key={tenantScopeKey(tenantScope(identity))} />
}

function ScopedEstabelecimentos() {
  const { items, loading, confirmed, loadError, loadNotice, mutationError, mutating, blocked, hasIdentity, refresh, mutate } = useTenantAdministration(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', address: '', segment: 'salao' })
  const [editId, setEditId] = useState<string | null>(null)
  const [editBefore, setEditBefore] = useState<TenantDirectoryRow | null>(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '', address: '', segment: '' })
  const cannotWrite = mutating || blocked || !hasIdentity

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    if (await mutate('create', undefined, {
      name: form.name.trim(), phone: form.phone.trim() || null,
      address: form.address.trim() || null, segment: form.segment, status: 'pendente',
    })) {
      setForm({ name: '', phone: '', address: '', segment: 'salao' })
      setShowForm(false)
    }
  }

  const updateStatus = async (item: TenantDirectoryRow, status: string) => {
    await mutate('update', item, { status })
  }

  const startEdit = (item: TenantDirectoryRow) => {
    setShowForm(false)
    setEditId(item.id)
    setEditBefore({ ...item })
    setEditForm({ name: item.name, phone: item.phone ?? '', address: item.address ?? '', segment: item.segment ?? 'salao' })
  }

  const saveEdit = async () => {
    if (!editId || !editBefore || !editForm.name.trim()) return
    if (await mutate('update', editBefore, {
      name: editForm.name.trim(), phone: editForm.phone.trim() || null,
      address: editForm.address.trim() || null, segment: editForm.segment,
    })) {
      setEditId(null)
      setEditBefore(null)
    }
  }

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.phone?.includes(search) ||
    i.address?.toLowerCase().includes(search.toLowerCase())
  )

  const total = items.length
  const ativos = items.filter(i => i.status === 'ativo').length
  const pendentes = items.filter(i => i.status === 'pendente').length
  const taxaAtivacao = total > 0 ? ((ativos / total) * 100).toFixed(0) + '%' : 'Sem base'

  return (
    <AppLayout title="Estabelecimentos" subtitle="Salões, clínicas e parceiros da plataforma">
      <div className="card mb-4 text-xs" role="note">
        <p>{TENANT_POLICY_NOTICE}</p>
        <p className="mt-2">{TENANT_PROVISIONING_NOTICE}</p>
        <p className="mt-2">Indicadores apenas dos estabelecimentos visíveis para esta conta, na última leitura confirmada.</p>
      </div>
      {!hasIdentity && <p role="alert" className="mb-4">Entre com uma conta vinculada a uma empresa para consultar e solicitar alterações.</p>}
      {loadError && <p role="alert" className="mb-4 text-sm text-red-600">{loadError}</p>}
      {loadNotice && <p role="status" className="mb-4 text-sm">{loadNotice}</p>}
      {mutationError && <p role="alert" className="mb-4 text-sm text-red-600">{mutationError}</p>}
      {blocked && hasIdentity && <p role="status" className="mb-4 text-xs">{new TenantMutationFailure('busy').message} A reserva segura entre abas também precisa estar disponível.</p>}
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Total', value: String(total), color: 'var(--accent)' },
          { label: 'Ativos', value: String(ativos), color: '#10b981' },
          { label: 'Pendentes', value: String(pendentes), color: '#f59e0b' },
          { label: 'Taxa de Ativação', value: taxaAtivacao, color: '#7c3aed' },
        ].map(k => (
          <div key={k.label} className="card">
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
            <p className="text-2xl font-bold" style={{ color: k.color }}>{loading ? '-' : confirmed ? k.value : 'Indisponível'}</p>
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
        <button onClick={() => void refresh()} disabled={loading || mutating || !hasIdentity} className="btn-secondary gap-2" aria-label="Atualizar estabelecimentos"><RefreshCw size={15} /> Atualizar</button>
        <button disabled={mutating} onClick={() => { setShowForm(!showForm); setEditId(null) }}
          className="btn-primary flex items-center gap-2 px-4 py-2.5 text-sm whitespace-nowrap">
          <Plus size={15} /> Novo Estabelecimento
        </button>
      </div>

      {/* Form de cadastro */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card mb-4 animate-fade-in">
          <p className="section-title mb-3">Cadastro Rápido</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input type="text" placeholder="Nome *" required disabled={mutating} value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            <input type="tel" placeholder="Telefone" disabled={mutating} value={form.phone}
              onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            <input type="text" placeholder="Endereço" disabled={mutating} value={form.address}
              onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            <select disabled={mutating} value={form.segment} onChange={e => setForm(p => ({ ...p, segment: e.target.value }))}
              className="px-3 py-2.5 rounded-xl text-sm" style={inputStyle}>
              {Object.entries(SEGMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" disabled={mutating} onClick={() => setShowForm(false)} className="btn-secondary px-4 py-2 text-sm">Cancelar</button>
            <button type="submit" disabled={cannotWrite} className="btn-primary px-4 py-2 text-sm">
              {mutating ? 'Salvando...' : 'Cadastrar'}
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
              {loading && !confirmed ? (
                <tr><td colSpan={6} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>Carregando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                  <Store size={32} className="mx-auto mb-2 opacity-30" />
                  {confirmed ? 'Nenhum estabelecimento encontrado' : 'Consulta indisponível'}
                </td></tr>
              ) : filtered.map(item => {
                const isEditing = editId === item.id
                const st = STATUS_CONFIG[item.status ?? ''] ?? { color: '#6b7280', bg: 'var(--surface-hover)', label: 'Não informado', icon: Clock }
                const StIcon = st.icon

                if (isEditing) {
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', background: 'var(--accent-muted)' }}>
                      <td className="px-3 py-2">
                        <input type="text" disabled={mutating} value={editForm.name}
                          onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg text-sm w-full" style={inputStyle} />
                      </td>
                      <td className="px-3 py-2">
                        <select disabled={mutating} value={editForm.segment}
                          onChange={e => setEditForm(p => ({ ...p, segment: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg text-xs w-full" style={inputStyle}>
                          {Object.entries(SEGMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input type="tel" disabled={mutating} value={editForm.phone}
                          onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg text-sm w-full" style={inputStyle} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" disabled={mutating} value={editForm.address}
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
                          <button disabled={cannotWrite} onClick={saveEdit} className="text-xs px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                            <Save size={11} />Salvar
                          </button>
                          <button disabled={mutating} aria-label="Cancelar edição" onClick={() => setEditId(null)} className="text-xs px-2 py-1.5 rounded-lg"
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
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-main)' }}>{item.name.trim() ? item.name : 'Estabelecimento sem nome'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-lg text-xs" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                        {SEGMENT_LABELS[item.segment ?? ''] ?? item.segment ?? '—'}
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
                        <button disabled={mutating} onClick={() => startEdit(item)}
                          className="text-xs px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-colors"
                          style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                          <Pencil size={11} />Editar
                        </button>
                        {item.status === 'pendente' && (
                          <button disabled={cannotWrite} onClick={() => updateStatus(item, 'ativo')}
                            className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                            Ativar
                          </button>
                        )}
                        {item.status === 'ativo' && (
                          <button disabled={cannotWrite} onClick={() => updateStatus(item, 'inativo')}
                            className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                            style={{ background: 'rgba(107,114,128,0.1)', color: '#6b7280', border: '1px solid rgba(107,114,128,0.2)' }}>
                            Desativar
                          </button>
                        )}
                        {item.status === 'inativo' && (
                          <button disabled={cannotWrite} onClick={() => updateStatus(item, 'ativo')}
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
