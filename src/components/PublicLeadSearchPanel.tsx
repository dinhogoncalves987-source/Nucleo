import { useCallback, useEffect, useRef, useState } from 'react'
import { backendFetch } from '../lib/backend'
import { getPublicSearchCapabilities, submitPublicSearch, PublicSearchFailure, unavailableMessages } from '../lib/public-search-client'
import type { Capabilities, SearchResponse } from '../lib/public-search-client'

const providerNames = { duckduckgo_instant_answer: 'DuckDuckGo Instant Answer', google_cse: 'Google Custom Search' }

// The keyed child discards every query/result when tenant or user changes, even without a caller key.
export default function PublicLeadSearchPanel(props: { tenantId?: string; userId?: string }) {
  return <PublicSearchSession key={JSON.stringify([props.tenantId, props.userId])} {...props} />
}

function PublicSearchSession({ tenantId, userId }: { tenantId?: string; userId?: string }) {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [query, setQuery] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('Verificando disponibilidade do servidor…')
  const mounted = useRef(false), busy = useRef(false), generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const current = useCallback((version: number) => mounted.current && generation.current === version, [])
  const refresh = useCallback(async () => {
    if (!mounted.current || busy.current) return
    if (!tenantId || !userId) { setMessage('Busca indisponível: entre com uma identidade vinculada à empresa.'); return }
    const version = ++generation.current
    const abort = new AbortController(); controller.current = abort
    busy.current = true; setLoading(true); setCaps(null); setResult(null); setAuthorized(false)
    setMessage('Verificando disponibilidade do servidor…')
    try {
      const next = await getPublicSearchCapabilities({ transport: backendFetch, identity: { tenantId, userId }, isCurrent: () => current(version), signal: abort.signal })
      if (!current(version)) return
      setCaps(next)
      setMessage(next.reason ? 'Busca indisponível: ' + unavailableMessages[next.reason] : '')
    } catch (error) {
      if (current(version)) setMessage(error instanceof PublicSearchFailure ? error.message : 'Busca indisponível.')
    } finally {
      if (current(version)) { busy.current = false; setLoading(false); controller.current = null }
    }
  }, [tenantId, userId, current])
  useEffect(() => {
    const lifecycleGeneration = generation
    mounted.current = true
    void refresh()
    return () => { mounted.current = false; lifecycleGeneration.current++; controller.current?.abort(); busy.current = false }
  }, [refresh])
  const search = async () => {
    if (!mounted.current || busy.current || !tenantId || !userId || !caps?.enabled || !caps.configured || !authorized || !query.trim()) return
    const version = ++generation.current
    const abort = new AbortController(); controller.current = abort
    busy.current = true; setLoading(true); setResult(null); setMessage('Consultando a fonte autorizada…'); setAuthorized(false)
    try {
      const response = await submitPublicSearch({ transport: backendFetch, identity: { tenantId, userId }, isCurrent: () => current(version), signal: abort.signal, capabilities: caps, query, authorized: true, requestId: crypto.randomUUID() })
      if (!current(version)) return
      setResult(response); setMessage(response.results.length ? '' : 'Nenhum resultado utilizável foi obtido nesta consulta. Isso não comprova ausência de estabelecimentos ou contatos.')
    } catch (error) {
      if (current(version)) { setCaps(null); setMessage(error instanceof PublicSearchFailure ? error.message : 'Busca indisponível. Atualize a disponibilidade.') }
    } finally {
      if (current(version)) { busy.current = false; setLoading(false); controller.current = null }
    }
  }
  const available = !!tenantId && !!userId && !!caps?.enabled && caps.configured
  return <section className="space-y-4" aria-label="Busca pública">
    <div className="glass-card p-5 space-y-3">
      <h2 className="font-semibold">Busca em fontes públicas</h2>
      <p className="text-sm text-amber-300">Resultado público não é cadastro de lead verificado</p>
      <p className="text-sm text-slate-400">A busca apenas mostra evidências da fonte. Titularidade, atividade e WhatsApp são desconhecidos; permissão de contato não estabelecida. Nenhum resultado é cadastrado ou usado para envio.</p>
      <p className="text-sm text-slate-400">DuckDuckGo Instant Answer oferece respostas limitadas, não um diretório completo de empresas. A autorização para uso comercial e as condições atuais precisam ser confirmadas antes da habilitação no servidor.</p>
      <p className="text-sm text-slate-400">Google Custom Search está fechado a novos clientes e encerra em 01/01/2027. Até essa data, exige elegibilidade de cliente existente confirmada, configuração e custos autorizados no servidor.</p>
      <button type="button" className="btn-secondary" disabled={loading || !tenantId || !userId} onClick={() => void refresh()}>Atualizar disponibilidade</button>
      {caps && <p className="text-sm">Fonte indicada pelo servidor: {providerNames[caps.provider]}</p>}
      <label className="block text-sm" htmlFor="public-search-query">Consulta pública genérica (até 200 caracteres)</label>
      <input id="public-search-query" className="input-field w-full" type="search" maxLength={200} autoComplete="off" spellCheck={false} value={query} disabled={!available || loading} placeholder="Ex.: salões de beleza em Curitiba" onChange={event => { setQuery(event.target.value); setAuthorized(false); setResult(null) }} />
      <p className="text-xs text-slate-400">Não inclua dados pessoais, sensíveis ou informações privadas. Nada da sua empresa ou dos seus leads é preenchido automaticamente.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={authorized} disabled={!available || loading} onChange={event => setAuthorized(event.target.checked)} />Autorizo compartilhar esta consulta com {caps ? providerNames[caps.provider] : 'a fonte indicada quando disponível'} para realizar esta busca pública.</label>
      <button type="button" className="btn-primary" disabled={!available || !authorized || !query.trim() || loading} onClick={() => void search()}>{loading ? 'Aguarde…' : 'Buscar na fonte pública'}</button>
      <p role="status" aria-live="polite" className="text-sm text-slate-300">{message}</p>
      {caps?.limitations.length ? <ul className="text-xs text-slate-400 list-disc pl-4">{caps.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul> : null}
    </div>
    {result && <div className="space-y-3">
      <p className="text-sm text-slate-400">Fonte: {providerNames[result.provider]} · Consulta: {result.query} · Data: {new Date(result.searched_at).toLocaleString('pt-BR')}</p>
      {result.results.map((item, i) => <article key={`${item.url}:${i}`} className="glass-card p-4 space-y-2">
        <h3 className="font-semibold">{item.title || 'Fonte sem título'}</h3>
        <p className="text-sm whitespace-pre-wrap">{item.snippet}</p>
        <a className="text-blue-400 break-all" href={item.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Abrir fonte: {item.url}</a>
        {item.phone_evidence.length ? item.phone_evidence.map((evidence, j) => <div key={j} className="text-sm text-slate-400"><p>Telefone encontrado no texto: {evidence.raw} ({evidence.normalized})</p><p>Trecho da evidência: {evidence.excerpt}</p></div>) : <p className="text-sm text-slate-400">Nenhuma evidência de telefone retornada.</p>}
        <p className="text-xs text-amber-300">Titularidade, atividade e WhatsApp desconhecidos. Permissão de contato não estabelecida.</p>
      </article>)}
      <ul className="text-xs text-slate-400 list-disc pl-4">{result.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </div>}
  </section>
}
