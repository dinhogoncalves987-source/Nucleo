import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { prepareLeadFile, type PreparedLeadFile } from '../lib/lead-source-file'
import { submitLeadImport, getLeadImportReceipt, pendingImportKey, readPendingImport, savePendingImport, clearPendingImport, withPendingImportLock, ImportFailure, type PendingImport, type Rpc, type ImportReceipt } from '../lib/lead-import-client'

const rpc: Rpc = (name, parameters) => supabase.rpc(name, parameters)
const issueText: Record<string, string> = {
  missing_name: 'nome ausente', missing_phone: 'telefone ausente', invalid_phone: 'telefone invalido',
  invalid_name: 'nome invalido', conflicting_names: 'nomes diferentes para o mesmo telefone; revise antes de importar', column_count_mismatch: 'quantidade de colunas diferente do cabecalho',
}
export default function LeadFileImportPanel({ tenantId, userId, tenantName, onImported }: {
  tenantId?: string; userId?: string; tenantName?: string; onImported: () => Promise<void> | void;
}) {
  const [preview, setPreview] = useState<PreparedLeadFile | null>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [rechecked, setRechecked] = useState(false)
  const [storageReady, setStorageReady] = useState(false)
  const mounted = useRef(false), generation = useRef(0), busy = useRef(false)
  const isCurrent = (version: number) => mounted.current && generation.current === version
  const invalidateGeneration = useCallback(() => { generation.current++ }, [])
  useEffect(() => {
    mounted.current = true
    let removeListener = () => {}
    try {
      if (!tenantId || !userId) throw new Error('Entre com uma identidade vinculada a empresa para importar.')
      if (!navigator.locks) throw new Error('Este navegador nao oferece reserva segura entre abas. Use um navegador atualizado para importar.')
      const key = pendingImportKey(tenantId, userId)
      const saved = readPendingImport(window.localStorage, key, tenantId)
      setPending(saved); setStorageReady(true)
      if (saved) setMessage('Existe uma importacao sem confirmacao neste navegador. Consulte o recibo antes de repetir.')
      const synchronize = (event: StorageEvent) => {
        if (event.storageArea !== window.localStorage || (event.key !== null && event.key !== key) || busy.current) return
        try {
          const current = readPendingImport(window.localStorage, key, tenantId)
          invalidateGeneration(); setPending(current); setPreview(null); setConfirmed(false); setRechecked(false)
          setMessage(current ? 'Outra aba registrou uma importacao pendente. Consulte o recibo antes de repetir.' : 'A referencia foi resolvida em outra aba. Confira a lista antes de preparar outro lote.')
        } catch (error) { setStorageReady(false); setMessage(error instanceof Error ? error.message : 'Referencia local indisponivel.') }
      }
      window.addEventListener('storage', synchronize)
      removeListener = () => window.removeEventListener('storage', synchronize)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Importacao indisponivel.'); setStorageReady(false) }
    return () => { mounted.current = false; invalidateGeneration(); removeListener() }
  }, [tenantId, userId, invalidateGeneration])

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file || busy.current || !storageReady || !tenantId || !userId || (pending && !rechecked)) return
    const version = ++generation.current
    busy.current = true; setLoading(true); setMessage(''); setPreview(null); setConfirmed(false)
    try {
      if (file.size > 1024 * 1024) throw new Error('Arquivo excede 1 MiB. Divida a lista antes de importar.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const prepared = await prepareLeadFile({ bytes, fileName: file.name, tenantId, requestId: pending?.requestId ?? crypto.randomUUID() })
      if (pending) {
        if (prepared.source.sha256 !== pending.sha256) throw new Error('Selecione exatamente o arquivo da importacao pendente. Nenhum novo lote foi enviado.')
        prepared.source.file_name = pending.fileName
      }
      if (!isCurrent(version)) return
      setPreview(prepared)
      setMessage(prepared.canImport ? 'Previa pronta. Nada foi gravado. Confirme a origem e a empresa abaixo.' : 'Corrija os registros indicados e selecione o arquivo novamente. Nenhum contato deste lote sera gravado.')
    } catch (error) { if (isCurrent(version)) setMessage(error instanceof Error ? error.message : 'Nao foi possivel ler o arquivo.') }
    finally { if (isCurrent(version)) { busy.current = false; setLoading(false) } }
  }
  const showReceipt = async (result: ImportReceipt, saved: PendingImport, version: number) => {
    let cleanupFailed = false
    try { clearPendingImport(window.localStorage, pendingImportKey(saved.tenantId, userId!), saved.requestId, saved.tenantId) }
    catch { cleanupFailed = true }
    if (!isCurrent(version)) return
    setPending(cleanupFailed ? saved : null); setPreview(null); setConfirmed(false); setRechecked(false)
    setMessage(result.imported + ' contatos cadastrados; ' + result.existing + ' ja existiam. Recibo confirmado. WhatsApp, atividade e permissao de contato continuam nao verificados.' + (cleanupFailed ? ' A referencia local nao foi removida; consultar novamente nao reenviara o lote.' : ''))
    try { await onImported() } catch { if (isCurrent(version)) setMessage('Cadastro confirmado pelo recibo. Atualize a lista para conferir os registros.') }
  }
  const submit = async () => {
    if (busy.current || !preview || !tenantId || !userId || !confirmed || !storageReady || (pending && !rechecked)) return
    const version = ++generation.current
    busy.current = true; setLoading(true); setMessage('Confirmando importacao...')
    const saved: PendingImport = { requestId: preview.requestId, tenantId, sha256: preview.source.sha256, fileName: preview.source.file_name }
    let freshReservation = false
    try {
      await withPendingImportLock(navigator.locks, pendingImportKey(tenantId, userId), async () => {
        if (!isCurrent(version)) throw new ImportFailure('Empresa ou identidade mudou. Nenhum novo lote foi enviado.', 'rejected')
        const previous = readPendingImport(window.localStorage, pendingImportKey(tenantId, userId), tenantId)
        savePendingImport(window.localStorage, pendingImportKey(tenantId, userId), saved)
        freshReservation = previous === null
        if (isCurrent(version)) { setPending(saved); setRechecked(false) }
        const result = await submitLeadImport({ preview, confirmed, tenantId, isCurrent: () => isCurrent(version), rpc })
        await showReceipt(result, saved, version)
      })
    } catch (error) {
      if (error instanceof ImportFailure && error.outcome === 'rejected') {
        try { if (freshReservation) clearPendingImport(window.localStorage, pendingImportKey(tenantId, userId), saved.requestId, tenantId) }
        catch { /* Preserve the pointer if local storage is unavailable. */ }
        if (isCurrent(version)) { try { setPending(readPendingImport(window.localStorage, pendingImportKey(tenantId, userId), tenantId)) } catch { setPending(saved); setStorageReady(false) } setRechecked(false) }
      }
      if (isCurrent(version)) setMessage(error instanceof Error ? error.message : 'Resultado incerto. Consulte o recibo antes de repetir.')
    } finally { if (isCurrent(version)) { busy.current = false; setLoading(false) } }
  }
  const checkReceipt = async () => {
    if (busy.current || !pending || !tenantId || !userId) return
    const version = ++generation.current
    busy.current = true; setLoading(true)
    try {
      const result = await getLeadImportReceipt({ requestId: pending.requestId, tenantId, rpc })
      if (!isCurrent(version)) return
      if (result) await showReceipt(result, pending, version)
      else { setRechecked(true); setMessage('Recibo ainda nao encontrado. Isso nao prova falha. Para repetir, use o mesmo arquivo e a mesma referencia; nao sera criado outro pedido.') }
    } catch (error) { if (isCurrent(version)) setMessage(error instanceof Error ? error.message : 'Nao foi possivel consultar o recibo.') }
    finally { if (isCurrent(version)) { busy.current = false; setLoading(false) } }
  }
  return <section aria-label="Importacao autorizada de contatos">
    <p className="section-title">Importar CSV ou vCard</p>
    <p className="section-subtitle mb-3">Fonte: arquivo fornecido por voce. O lote sera revisado antes de qualquer cadastro em {tenantName ?? 'sua empresa'}. Importar nao autoriza mensagens.</p>
    <label className="btn-secondary inline-flex cursor-pointer">
      Selecionar arquivo CSV ou vCard
      <input aria-label="Arquivo de contatos" type="file" accept=".csv,.vcf,.vcard" onChange={chooseFile} disabled={loading || !storageReady || Boolean(pending && !rechecked)} className="ml-2 max-w-full" />
    </label>
    <p className="text-xs mt-2">CSV UTF-8: colunas nome e telefone, separadas por virgula ou ponto-e-virgula. vCard: .vcf ou .vcard. Limites: 1 MiB e 1000 registros. Excel nao e aceito.</p>
    {message && <p role="status" className="text-sm mt-3">{message}</p>}
    {pending && <div className="mt-3">
      <p className="text-xs">Referencia pendente: {pending.requestId}</p>
      <button type="button" onClick={() => void checkReceipt()} disabled={loading} className="btn-secondary mt-2">Consultar resultado</button>
    </div>}
    {preview && <div className="mt-4">
      <p className="font-semibold">Previa: {preview.source.file_name}</p>
      <p className="text-sm">{preview.summary.records} registros; {preview.contacts.length} telefones unicos; {preview.summary.duplicates} repeticoes; {preview.summary.invalid} registros invalidos.</p>
      <p className="text-xs">Origem SHA-256: {preview.source.sha256}</p>
      <p className="text-sm mt-2">A normalizacao verifica somente formato. Presenca no WhatsApp: desconhecida. Atividade do numero: desconhecida. Permissao de contato: nao estabelecida.</p>
      {preview.issues.length > 0 && <ul className="text-sm mt-2">{preview.issues.slice(0, 20).map((issue, index) => <li key={index}>Registro {issue.record_number}: {issueText[issue.code] ?? issue.code}</li>)}</ul>}
      {preview.contacts.length > 0 && <div className="overflow-x-auto mt-3"><table className="w-full text-sm"><thead><tr><th>Nome</th><th>Telefone</th><th>Registros de origem</th></tr></thead><tbody>{preview.contacts.slice(0, 20).map(contact => <tr key={contact.phone}><td>{contact.name}</td><td>{contact.phone}</td><td>{contact.record_numbers.join(', ')}</td></tr>)}</tbody></table></div>}
      {preview.contacts.length > 20 && <p className="text-xs">Mostrando 20 de {preview.contacts.length} contatos.</p>}
      <label className="flex gap-2 items-start text-sm mt-4"><input type="checkbox" checked={confirmed} disabled={loading || !preview.canImport} onChange={event => setConfirmed(event.target.checked)} />Tenho autorizacao para cadastrar estes contatos em {tenantName ?? 'minha empresa'} para qualificacao. Isso nao concede permissao para mensagens.</label>
      <div className="flex gap-2 mt-3">
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={loading || !confirmed || !preview.canImport || Boolean(pending && !rechecked)}>{pending ? 'Repetir o mesmo lote' : 'Confirmar importacao'}</button>
        <button type="button" className="btn-secondary" disabled={loading || Boolean(pending)} onClick={() => { generation.current++; setPreview(null); setConfirmed(false); setMessage('Previa descartada. Nada foi enviado ao banco.') }}>Descartar previa</button>
      </div>
    </div>}
  </section>
}
