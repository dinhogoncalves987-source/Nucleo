import { useState } from 'react'
import { ShieldCheck, Plus, Layers, Trash2, Users, RefreshCw } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useTenant } from '../contexts/tenant-context'
import { tenantScope, tenantScopeKey, TENANT_POLICY_NOTICE, TENANT_PROVISIONING_NOTICE } from '../lib/tenant-directory'
import type { TenantDirectoryRow } from '../lib/tenant-directory'
import { TenantMutationFailure } from '../lib/tenant-operations'
import { useTenantAdministration } from '../lib/use-tenant-administration'

export default function AdminProjects() {
  const identity = useTenant()
  return <ScopedAdminProjects key={tenantScopeKey(tenantScope(identity))} />
}

function ScopedAdminProjects() {
  const { items: tenants, loading, confirmed, loadError, loadNotice, mutationError, mutating, blocked, hasIdentity, refresh, mutate } = useTenantAdministration(false)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const cannotWrite = mutating || blocked || !hasIdentity

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    if (await mutate('create', undefined, { name: newName.trim() })) {
      setNewName('')
      setShowForm(false)
    }
  }

  const handleDelete = async (tenant: TenantDirectoryRow) => {
    if (cannotWrite || !window.confirm(`Excluir o projeto "${tenant.name.trim() ? tenant.name : 'Projeto sem nome'}" (ID: ${tenant.id})? Esta operação pode afetar dados vinculados e depende das regras do servidor.`)) return
    await mutate('delete', tenant)
  }

  return (
    <AppLayout title="SuperAdmin - Projetos" subtitle="Projetos visíveis para a sua conta; permissões verificadas pelo servidor">
      <div className="card mb-4 text-xs" role="note">
        <p>{TENANT_POLICY_NOTICE}</p>
        <p className="mt-2">{TENANT_PROVISIONING_NOTICE}</p>
      </div>
      {!hasIdentity && <p role="alert" className="mb-4">Entre com uma conta vinculada a uma empresa para consultar e solicitar alterações.</p>}
      {loadError && <p role="alert" className="mb-4 text-sm text-red-600">{loadError}</p>}
      {loadNotice && <p role="status" className="mb-4 text-sm">{loadNotice}</p>}
      {mutationError && <p role="alert" className="mb-4 text-sm text-red-600">{mutationError}</p>}
      {blocked && hasIdentity && <p role="status" className="mb-4 text-xs">{new TenantMutationFailure('busy').message} A reserva segura entre abas também precisa estar disponível.</p>}

      <div className="flex items-center justify-between mb-5 gap-3">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {loading ? 'Consultando...' : confirmed ? `${tenants.length} projetos na última leitura confirmada` : 'Lista indisponível'}
        </p>
        <div className="flex gap-2">
          <button onClick={() => void refresh()} disabled={loading || mutating || !hasIdentity} aria-label="Atualizar projetos" className="btn-secondary gap-2"><RefreshCw size={15} /> Atualizar</button>
          <button onClick={() => setShowForm(!showForm)} disabled={mutating} className="btn-primary gap-2">
            <Plus size={15} /> Novo Projeto (Tenant)
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card mb-4 animate-fade-in" style={{ borderColor: 'var(--accent)' }}>
          <p className="section-title">Criar novo projeto</p>
          <p className="section-subtitle">Somente o cadastro da empresa. Não provisiona acesso de usuários.</p>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <div className="flex gap-3">
              <input className="input-field flex-1" placeholder="Nome do projeto"
                value={newName} onChange={e => setNewName(e.target.value)} disabled={mutating} autoFocus required />
              <button type="submit" disabled={cannotWrite} className="btn-primary gap-2 whitespace-nowrap">
                {mutating ? 'Confirmando...' : <><Layers size={15} /> Criar</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading && !confirmed ? (
        <div className="flex items-center justify-center py-24" role="status">Carregando projetos...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tenants.map(tenant => (
            <div key={tenant.id} className="card group animate-fade-in">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-accent)' }}>
                  <span className="text-white font-bold text-lg">{tenant.name.trim().charAt(0) || '?'}</span>
                </div>
                <button onClick={() => void handleDelete(tenant)} disabled={cannotWrite}
                  aria-label={`Excluir projeto ${tenant.name}`} title="Excluir projeto"
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                  style={{ color: 'var(--text-muted)' }}>
                  <Trash2 size={13} />
                </button>
              </div>
              <h3 className="font-bold mb-1" style={{ fontFamily: "'Playfair Display', serif", color: 'var(--text-main)' }}>{tenant.name.trim() ? tenant.name : 'Projeto sem nome'}</h3>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{tenant.created_at === null ? 'Data de criação não informada' : `Criado em ${new Date(tenant.created_at).toLocaleDateString('pt-BR')}`}</p>
              <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}><Users size={13} /> Projeto cadastrado</span>
                <span className="badge-muted">Status não consultado</span>
              </div>
            </div>
          ))}
          {confirmed && tenants.length === 0 && <p role="status">Nenhum projeto carregado nesta consulta.</p>}
        </div>
      )}

      <div className="card mt-5">
        <p className="section-title flex items-center gap-2"><ShieldCheck size={17} style={{ color: '#7c3aed' }} /> Visão do Sistema</p>
        <p className="section-subtitle">A lista respeita o acesso da conta. Não há fonte de telemetria conectada nesta tela.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3">
          {[
            { v: confirmed ? tenants.length : 'Indisponível', l: 'Projetos carregados', c: 'var(--accent)' },
            { v: 'Indisponível', l: 'Usuários', c: 'var(--gold)' },
            { v: 'Indisponível', l: 'Uptime', c: '#10b981' },
            { v: 'Indisponível', l: 'CPU média', c: '#7c3aed' },
          ].map(s => <div key={s.l} className="text-center">
            <p className="font-bold text-lg" style={{ fontFamily: "'Playfair Display', serif", color: s.c }}>{s.v}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{s.l}</p>
          </div>)}
        </div>
      </div>
    </AppLayout>
  )
}
