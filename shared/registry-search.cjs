"use strict";
// Isolated, disabled-by-default registry adapter. No HTTP authentication or route is installed.
const { randomBytes, createHash } = require('node:crypto');
const PROVIDER = 'minha_receita';
const ENDPOINT = 'https://minhareceita.org/';
const LIMITS = Object.freeze({ page_size: 10, session_results: 30, session_pages: 30, ttl_ms: 600000, response_bytes: 262144, deadline_ms: 8000, sessions: 64, ledger: 512 });
const UF_PREFIX = Object.freeze({ RO:'11', AC:'12', AM:'13', RR:'14', PA:'15', AP:'16', TO:'17', MA:'21', PI:'22', CE:'23', RN:'24', PB:'25', PE:'26', AL:'27', SE:'28', BA:'29', MG:'31', ES:'32', RJ:'33', SP:'35', PR:'41', SC:'42', RS:'43', MS:'50', MT:'51', GO:'52', DF:'53' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex -- Reject control characters in untrusted source fields.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const ROLES = new Set(['superadmin', 'manager', 'operator']);
const LIMITATIONS = Object.freeze([
  'Consulta cadastral por CNAE principal, UF e municipio IBGE; nao comprova atividade, WhatsApp ou permissao de contato.',
  'O provedor pode transmitir campos adicionais, inclusive QSA/CPF. Eles sao descartados localmente, sem log, persistencia ou uso.',
  'A fonte nao documenta projecao de campos nem SLA; gratuidade nao confirma licenca ou condicoes atuais.',
  'Data de situacao cadastral nao e a data de extracao. A data de extracao da fonte e desconhecida.',
  'A sintaxe do CNPJ nao prova existencia ou titularidade. Suporte alfanumerico no provedor nao esta documentado.',
  'Nenhum resultado e salvo como lead e nenhum envio e realizado. Ledger e cursores sao locais, limitados e nao duraveis.'
]);
class RegistrySearchError extends Error {
  constructor(status, code) { super(code); this.name = 'RegistrySearchError'; this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new RegistrySearchError(status, code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function requireIdentity(auth) {
  // Structural validation only. The caller MUST obtain this identity from trusted authentication.
  if (!object(auth) || auth.isAnonymous === true || typeof auth.userId !== 'string' || !UUID.test(auth.userId)) fail(401, 'authentication_required');
  if (typeof auth.tenantId !== 'string' || !UUID.test(auth.tenantId)) fail(403, 'tenant_required');
  if (!ROLES.has(auth.appRole)) fail(403, 'role_forbidden');
  return { userId: auth.userId.toLowerCase(), tenantId: auth.tenantId.toLowerCase(), appRole: auth.appRole };
}
function capabilities(env, auth) {
  const identity = requireIdentity(auth);
  const gates = [
    ['REGISTRY_SEARCH_ENABLED', 'registry_search_disabled'],
    ['REGISTRY_SEARCH_TERMS_APPROVED', 'registry_terms_approval_required'],
    ['REGISTRY_SEARCH_ARCHITECTURE_APPROVED', 'registry_architecture_approval_required'],
    ['REGISTRY_SEARCH_TRANSIENT_DATA_APPROVED', 'registry_transient_data_approval_required']
  ];
  const reason = gates.find(([key]) => env[key] !== 'true')?.[1] || null;
  return { tenant_id: identity.tenantId, provider: PROVIDER, enabled: reason === null, reason,
    requires_query_authorization: true, filters: { cnae_fiscal: 'primary_only', uf: 'required', municipio: 'ibge7_required' },
    limits: { ...LIMITS }, source_extracted_at: null, limitations: [...LIMITATIONS] };
}
function normalizeFilters(filters) {
  if (!exactKeys(filters, ['cnae_fiscal', 'uf', 'municipio']) ||
      typeof filters.cnae_fiscal !== 'string' || !/^\d{7}$/.test(filters.cnae_fiscal) ||
      typeof filters.uf !== 'string' || !Object.hasOwn(UF_PREFIX, filters.uf) ||
      typeof filters.municipio !== 'string' || !/^\d{7}$/.test(filters.municipio) ||
      !filters.municipio.startsWith(UF_PREFIX[filters.uf])) fail(400, 'invalid_registry_filters');
  return { cnae_fiscal: filters.cnae_fiscal, uf: filters.uf, municipio: filters.municipio };
}
function validatedSourceCursor(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.length || value.length > 2048 || CONTROL.test(value)) fail(502, 'registry_response_invalid');
  return value;
}
function sourceCode(value, length, numericPadding = false) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    value = String(value);
    if (numericPadding && value.length <= length) value = value.padStart(length, '0');
  }
  return typeof value === 'string' && new RegExp('^\\d{' + length + '}$').test(value) ? value : null;
}
function cnpjIdentity(value) {
  if (typeof value !== 'string') fail(502, 'registry_response_invalid');
  if (/^[A-Z0-9]{12}[0-9]{2}$/.test(value)) return { literal: value, key: value };
  if (/^[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-[0-9]{2}$/.test(value)) return { literal: value, key: value.replace(/[./-]/g, '') };
  fail(502, 'registry_response_invalid');
}
function safeText(value, max = 200) {
  if (typeof value !== 'string' || !value.trim()) return { value: null, omitted: null };
  if (value.length > max || CONTROL.test(value)) return { value: null, omitted: 'invalid_source_text' };
  // Conservatively omit the entire field if it may contain a CPF, even an invalid one.
  // Masked CPFs are also sensitive; punctuation/spacing cannot make a mask safe to echo.
  const masked = value.replace(/[^\p{Decimal_Number}*xX•●]/gu, '');
  if ((value.match(/\p{Decimal_Number}/gu) || []).length >= 11 ||
      (masked.length >= 11 && /[*xX•●]/u.test(masked))) return { value: null, omitted: 'possible_personal_identifier' };
  return { value: value.trim(), omitted: null };
}
const DDD = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
function phones(row) {
  const result = [];
  for (const field of ['ddd_telefone_1', 'ddd_telefone_2']) {
    const raw = row[field];
    // No free-text extraction: only explicit registry telephone fields, without extension.
    if (typeof raw !== 'string' || raw.length > 24 || !/^(?:\([1-9]\d\)|[1-9]\d)[ -]?(?:[2-5]\d{3}|9\d{4})[- ]?\d{4}$/.test(raw)) continue;
    const digits = raw.replace(/[() -]/g, '');
    if (!DDD.has(digits.slice(0, 2))) continue;
    const normalized = '+55' + digits;
    if (!result.some(item => item.normalized === normalized)) result.push({ source_field: field, raw, normalized, evidence_type: 'registry_phone', ownership: 'unverified' });
  }
  return result;
}
function sourceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function projectEnvelope(raw, filters, requestedLimit) {
  if (!object(raw) || !Object.hasOwn(raw, 'data') || !Array.isArray(raw.data) || raw.data.length > requestedLimit ||
      Object.hasOwn(raw, 'error')) fail(502, 'registry_response_invalid');
  const cursor = validatedSourceCursor(raw.cursor);
  const results = [], keys = new Set();
  for (const row of raw.data) {
    if (!object(row)) fail(502, 'registry_response_invalid');
    // Missing scope fields are not evidence that the provider applied the requested AND filters.
    if (row.uf !== filters.uf || sourceCode(row.cnae_fiscal, 7, true) !== filters.cnae_fiscal ||
        sourceCode(row.codigo_municipio_ibge, 7) !== filters.municipio) fail(502, 'registry_scope_unverified');
    const cnpj = cnpjIdentity(row.cnpj);
    if (keys.has(cnpj.key)) fail(502, 'registry_response_invalid');
    keys.add(cnpj.key);
    const fields = { razao_social: safeText(row.razao_social), nome_fantasia: safeText(row.nome_fantasia),
      municipio: safeText(row.municipio, 100), cnae_descricao: safeText(row.cnae_fiscal_descricao, 300),
      situacao: safeText(row.descricao_situacao_cadastral, 100) };
    const omitted = Object.entries(fields).filter(([, entry]) => entry.omitted).map(([field, entry]) => ({ field, reason: entry.omitted }));
    results.push({
      cnpj: cnpj.literal, cnpj_key: cnpj.key, cnpj_validation: 'syntax_only',
      razao_social: fields.razao_social.value, nome_fantasia: fields.nome_fantasia.value,
      uf: filters.uf, municipio: { codigo_ibge: filters.municipio, nome: fields.municipio.value },
      cnae_fiscal: { codigo: filters.cnae_fiscal, descricao: fields.cnae_descricao.value },
      situacao_cadastral: { descricao: fields.situacao.value, data: sourceDate(row.data_situacao_cadastral) },
      phone_evidence: phones(row), omitted_fields: omitted,
      source: { provider: PROVIDER, upstream: 'Receita Federal', origin: ENDPOINT, source_extracted_at: null }
    });
  }
  return { results, cursor };
}
function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new RegistrySearchError(504, 'registry_timeout'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) {
        try { value?.body?.cancel()?.catch(() => {}); } catch { /* late response already closed */ }
        abort();
      } else resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function createBoundedRegistryTransport(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation required');
  return async ({ filters, limit, cursor, signal }) => {
    // This transport never accepts caller-provided hosts, paths, methods, credentials or headers.
    const checked = normalizeFilters(filters);
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.page_size || !(signal instanceof AbortSignal)) fail(400, 'invalid_registry_transport');
    if (cursor !== null && (typeof cursor !== 'string' || !cursor.length || cursor.length > 2048 || CONTROL.test(cursor))) fail(400, 'invalid_registry_transport');
    const url = new URL(ENDPOINT);
    for (const [key, value] of Object.entries(checked)) url.searchParams.set(key, value);
    url.searchParams.set('limit', String(limit));
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    let response, reader;
    try {
      if (signal.aborted) fail(504, 'registry_timeout');
      response = await withAbort(fetchImpl(url.href, { method: 'GET', headers: { Accept: 'application/json' }, signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }), signal);
      if (response.status === 429) fail(429, 'registry_provider_rate_limited');
      if (response.status !== 200 || response.redirected || (response.url && new URL(response.url).origin !== new URL(ENDPOINT).origin)) fail(502, 'registry_provider_failed');
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > LIMITS.response_bytes)) fail(502, 'registry_response_invalid');
      const type = response.headers.get('content-type');
      if (type && !/^application\/(?:json|[\w.-]+\+json)(?:\s*;|$)/i.test(type)) fail(502, 'registry_response_invalid');
      if (!response.body) fail(502, 'registry_response_invalid');
      reader = response.body.getReader();
      let size = 0, text = '';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      while (true) {
        if (signal.aborted) fail(504, 'registry_timeout');
        const part = await withAbort(reader.read(), signal);
        if (part.done) break;
        size += part.value.byteLength;
        if (size > LIMITS.response_bytes) fail(502, 'registry_response_invalid');
        try { text += decoder.decode(part.value, { stream: true }); } catch { fail(502, 'registry_response_invalid'); }
      }
      try { text += decoder.decode(); } catch { fail(502, 'registry_response_invalid'); }
      let data;
      try { data = JSON.parse(text); } catch { fail(502, 'registry_response_invalid'); }
      // Return only the projected fields. Raw provider content never enters the session/ledger.
      return projectEnvelope(data, checked, limit);
    } catch (error) {
      // Cancellation is best-effort and MUST NOT delay the bounded request.
      try { const cancellation = reader ? reader.cancel() : response?.body?.cancel(); cancellation?.catch(() => {}); } catch { /* already locked/closed */ }
      if (error instanceof RegistrySearchError) throw error;
      fail(signal.aborted ? 504 : 502, signal.aborted ? 'registry_timeout' : 'registry_provider_failed');
    } finally { try { reader?.releaseLock(); } catch { /* cancelled or pending reader */ } }
  };
}
const clone = value => structuredClone(value);
function createRegistrySearchAdapter({ env = {}, fetchImpl = globalThis.fetch, now = () => new Date(), timeoutMs = LIMITS.deadline_ms } = {}) {
  const transport = createBoundedRegistryTransport(fetchImpl);
  const sessions = new Map(), cursors = new Map(), ledger = new Map();
  const clock = () => {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail(500, 'registry_clock_invalid');
    return value.getTime();
  };
  const deadline = Number.isFinite(timeoutMs) ? Math.min(LIMITS.deadline_ms, Math.max(1, timeoutMs)) : LIMITS.deadline_ms;
  function clean(at) {
    for (const [id, session] of sessions) if (!session.busy && session.expires <= at) {
      sessions.delete(id);
      for (const token of session.tokens) cursors.delete(token);
    }
    for (const entry of ledger.values()) if (entry.done && entry.expires <= at) {
      // Expire minimized results, NEVER the execution identity. Bounded tombstones fail closed.
      entry.promise = null;
      entry.expired = true;
    }
  }
  function validate(auth, body) {
    const identity = requireIdentity(auth), capability = capabilities(env, identity);
    if (!exactKeys(body, ['request_id','expected_tenant_id','expected_provider','authorize_registry_query','filters','page_size','cursor'])) fail(400, 'invalid_registry_request');
    if (typeof body.request_id !== 'string' || !UUID.test(body.request_id)) fail(400, 'invalid_request_id');
    if (body.authorize_registry_query !== true) fail(400, 'registry_query_authorization_required');
    if (body.expected_tenant_id !== identity.tenantId) fail(409, 'tenant_changed');
    if (body.expected_provider !== PROVIDER) fail(409, 'provider_changed');
    const filters = normalizeFilters(body.filters);
    if (!Number.isInteger(body.page_size) || body.page_size < 1 || body.page_size > LIMITS.page_size) fail(400, 'invalid_registry_page_size');
    if (body.cursor !== null && (typeof body.cursor !== 'string' || !/^rsc_[A-Za-z0-9_-]{43}$/.test(body.cursor))) fail(400, 'invalid_registry_cursor');
    if (!capability.enabled) fail(503, capability.reason);
    return { identity, filters };
  }
  async function search({ auth, body } = {}) {
    const { identity, filters } = validate(auth, body);
    const requestId = body.request_id;
    const at = clock(); clean(at);
    const owner = identity.tenantId + ':' + identity.userId;
    const scope = JSON.stringify({ filters, page_size: body.page_size });
    const hash = createHash('sha256').update(JSON.stringify({ scope, cursor: body.cursor })).digest('hex');
    const id = owner + ':' + body.request_id.toLowerCase();
    const previous = ledger.get(id);
    if (previous) {
      if (previous.hash !== hash) fail(409, 'registry_request_conflict');
      if (previous.expired) fail(410, 'registry_request_expired');
      return clone(await previous.promise);
    }
    if (ledger.size >= LIMITS.ledger) fail(503, 'registry_capacity_reached');
    let session, cursorEntry;
    if (body.cursor !== null) {
      cursorEntry = cursors.get(body.cursor);
      if (!cursorEntry) fail(410, 'registry_cursor_expired');
      session = sessions.get(cursorEntry.sessionId);
      if (!session || session.expires <= at) fail(410, 'registry_cursor_expired');
      if (session.owner !== owner || session.scope !== scope) fail(409, 'registry_cursor_scope_mismatch');
      if (cursorEntry.requestId !== null) fail(409, 'registry_cursor_consumed');
      if (session.busy) fail(409, 'registry_session_busy');
    } else {
      if (sessions.size >= LIMITS.sessions) fail(503, 'registry_capacity_reached');
      session = { id: randomBytes(18).toString('base64url'), owner, scope, expires: at + LIMITS.ttl_ms, results: 0, pages: 0, tokens: [], seenCnpjs: new Set(), seenCursors: new Set(), busy: false };
      sessions.set(session.id, session);
    }
    if (session.results >= LIMITS.session_results || session.pages >= LIMITS.session_pages) fail(409, 'registry_session_limit');
    const providerLimit = Math.min(body.page_size, LIMITS.session_results - session.results);
    if (cursorEntry) cursorEntry.requestId = id;
    session.busy = true; session.pages++;
    const entry = { hash, expires: session.expires, done: false, promise: null };
    // The ledger is reserved synchronously before the first await; concurrent callers share this promise.
    ledger.set(id, entry);
    let resolvePromise, rejectPromise;
    entry.promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    // Publish the complete promise before invoking even a synchronously reentrant transport.
    (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const page = await Promise.race([
          transport({ filters, limit: providerLimit, cursor: cursorEntry?.upstream ?? null, signal: controller.signal }),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RegistrySearchError(504, 'registry_timeout')); }, deadline); })
        ]);
        if (clock() >= session.expires) fail(410, 'registry_cursor_expired');
        for (const row of page.results) if (session.seenCnpjs.has(row.cnpj_key)) fail(502, 'registry_pagination_invalid');
        if (page.cursor && session.seenCursors.has(page.cursor)) fail(502, 'registry_pagination_invalid');
        for (const row of page.results) session.seenCnpjs.add(row.cnpj_key);
        if (page.cursor) session.seenCursors.add(page.cursor);
        session.results += page.results.length;
        const limited = session.results >= LIMITS.session_results || session.pages >= LIMITS.session_pages;
        let next = null;
        if (page.cursor && !limited) {
          next = 'rsc_' + randomBytes(32).toString('base64url');
          cursors.set(next, { sessionId: session.id, upstream: page.cursor, requestId: null });
          session.tokens.push(next);
        }
        return {
          request_id: requestId, tenant_id: identity.tenantId, provider: PROVIDER, filters: clone(filters),
          fetched_at: new Date(clock()).toISOString(), source_extracted_at: null, results: page.results,
          pagination: { next_cursor: next, has_more: next !== null, returned: page.results.length, session_returned: session.results,
            session_limit: LIMITS.session_results, pages_fetched: session.pages, stop_reason: limited ? 'session_limit' : page.cursor ? null : 'source_exhausted' },
          state: { whatsapp: 'unknown', activity: 'unknown', contact_permission: 'not_established' },
          limitations: [...LIMITATIONS]
        };
      } catch (error) {
        if (error instanceof RegistrySearchError) throw error;
        fail(502, 'registry_provider_failed');
      } finally { clearTimeout(timer); controller.abort(); session.busy = false; entry.done = true; }
    })().then(resolvePromise, rejectPromise);
    return clone(await entry.promise);
  }
  return { capabilities: auth => capabilities(env, auth), search };
}
module.exports = { RegistrySearchError, LIMITS, createRegistrySearchAdapter, createBoundedRegistryTransport };
