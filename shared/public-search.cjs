// Canonical public-search implementation, shared by both backend entrypoints.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicSearchError = void 0;
exports.requireSearchAuth = requireSearchAuth;
exports.searchCapabilities = searchCapabilities;
exports.publicResultUrl = publicResultUrl;
exports.phoneEvidence = phoneEvidence;
exports.adaptResults = adaptResults;
exports.runPublicSearch = runPublicSearch;
exports.createSearchHandlers = createSearchHandlers;
class PublicSearchError extends Error {
    status;
    constructor(status, code) { super(code); this.status = status; }
}
exports.PublicSearchError = PublicSearchError;
const fail = (status, code) => { throw new PublicSearchError(status, code); };
const LIMIT = 256 * 1024;
const TIMEOUT = 8000;

const { createHash } = require('node:crypto');
function createSearchLedger(maxEntries = 1000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000) throw new Error('invalid_ledger_capacity');
    const records = new Map();
    return {
        claim(scope, payload) {
            const key = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
            const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
            const prior = records.get(key);
            if (prior) {
                if (prior.fingerprint !== fingerprint) return fail(409, 'request_id_conflict');
                if (prior.state === 'pending') return fail(409, 'request_in_progress');
                if (prior.state !== 'completed') return fail(409, 'request_outcome_uncertain');
                return { replay: structuredClone(prior.result) };
            }
            if (records.size >= maxEntries) return fail(503, 'request_ledger_full');
            const record = { fingerprint, state: 'pending' };
            records.set(key, record);
            return {
                complete(result) { record.result = structuredClone(result); record.state = 'completed'; },
                uncertain() { record.state = 'uncertain'; }
            };
        }
    };
}
exports.createSearchLedger = createSearchLedger;
// Process-local, bounded, no expiry/eviction: restart/replicas require a durable shared ledger.
const processLedger = createSearchLedger();
function validateProviderResponse(provider, data) {
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const invalid = () => fail(502, 'provider_response_invalid');
    if (!record(data)) return invalid();
    if (provider === 'google_cse') {
        if (data.searchInformation !== undefined && (!record(data.searchInformation) ||
            typeof data.searchInformation.totalResults !== 'string' || !/^\d+$/.test(data.searchInformation.totalResults))) return invalid();
        if (data.items !== undefined && !Array.isArray(data.items)) return invalid();
        const items = data.items || [];
        if (!items.length) {
            if (data.searchInformation?.totalResults !== '0') return invalid();
        } else {
            if (data.searchInformation?.totalResults === '0') return invalid();
            for (const item of items) if (!record(item) || typeof item.title !== 'string' || !item.title.trim() ||
                typeof item.link !== 'string' || !item.link.trim() ||
                (item.snippet !== undefined && typeof item.snippet !== 'string')) return invalid();
        }
    } else {
        for (const field of ['Heading', 'AbstractText', 'AbstractURL', 'Answer', 'Type']) {
            if (data[field] !== undefined && typeof data[field] !== 'string') return invalid();
        }
        let count = 0;
        const topics = (rows, depth = 0) => {
            if (!Array.isArray(rows) || depth > 4) return invalid();
            for (const row of rows) {
                if (++count > 1000 || !record(row)) return invalid();
                if (row.Topics !== undefined) {
                    if (row.Name !== undefined && typeof row.Name !== 'string') return invalid();
                    if (!Array.isArray(row.Topics) || row.Topics.length === 0) return invalid();
                    topics(row.Topics, depth + 1);
                } else if (typeof row.Text !== 'string' || !row.Text.trim() || typeof row.FirstURL !== 'string' || !row.FirstURL.trim()) return invalid();
            }
        };
        if (data.RelatedTopics !== undefined) topics(data.RelatedTopics);
        if (data.Results !== undefined) topics(data.Results);
        const abstract = typeof data.Heading === 'string' && data.Heading.trim() &&
            typeof data.AbstractText === 'string' && data.AbstractText.trim() &&
            typeof data.AbstractURL === 'string' && data.AbstractURL.trim();
        if ((data.AbstractText?.trim() || data.AbstractURL?.trim()) && !abstract) return invalid();
        const recognizedEnvelope = ['Heading', 'AbstractText', 'AbstractURL', 'Type'].every(k => typeof data[k] === 'string') &&
            Array.isArray(data.RelatedTopics) && Array.isArray(data.Results);
        const recognizedTopics = Array.isArray(data.RelatedTopics) && data.RelatedTopics.length > 0;
        const recognizedResults = Array.isArray(data.Results) && data.Results.length > 0;
        if (!abstract && !recognizedEnvelope && !recognizedTopics && !recognizedResults) return invalid();
    }
}


const commonLimitations = [
    'Proteção contra repetição limitada a este processo; reinícios e réplicas exigem ledger persistente compartilhado.',
    'Títulos são textos da fonte, não identidades verificadas.',
    'Resultados públicos não comprovam atividade, WhatsApp ou permissão de contato.',
    'Nenhum resultado é salvo como lead. Nenhuma página de resultado é consultada.',
    'Telefones são apenas trechos literais com DDD explícito; titularidade não verificada.'
];
function requireSearchAuth(auth) {
    if (!auth || typeof auth.userId !== 'string' || !auth.userId.trim())
        return fail(401, 'authentication_required');
    if (typeof auth.tenantId !== 'string' || !auth.tenantId.trim())
        return fail(403, 'tenant_required');
    if (!['superadmin', 'manager', 'operator'].includes(auth.appRole || ''))
        return fail(403, 'role_forbidden');
    return { userId: auth.userId, tenantId: auth.tenantId };
}
function searchCapabilities(env, auth, now = () => new Date()) {
    const { tenantId } = requireSearchAuth(auth);
    const raw = env.PUBLIC_SEARCH_PROVIDER || 'duckduckgo_instant_answer';
    const valid = raw === 'duckduckgo_instant_answer' || raw === 'google_cse';
    const provider = raw === 'google_cse' ? 'google_cse' : 'duckduckgo_instant_answer';
    const configured = valid && (provider !== 'google_cse' || Boolean(env.GOOGLE_API_KEY?.trim() && env.GOOGLE_SEARCH_ENGINE_ID?.trim()));
    const checkedAt = provider === 'google_cse' ? now().getTime() : 0;
    const reason = !valid ? 'provider_not_supported' : env.PUBLIC_SEARCH_ENABLED !== 'true' ? 'search_disabled'
        : provider === 'google_cse' && (!Number.isFinite(checkedAt) || checkedAt >= Date.UTC(2027, 0, 1)) ? 'google_provider_retired'
        : !configured ? 'provider_not_configured'
        : provider === 'google_cse' && env.PUBLIC_SEARCH_GOOGLE_LEGACY_CUSTOMER !== 'true' ? 'google_eligibility_unconfirmed'
        : provider === 'duckduckgo_instant_answer' && env.PUBLIC_SEARCH_DDG_COMMERCIAL_APPROVED !== 'true' ? 'duckduckgo_commercial_approval_required'
            : provider === 'google_cse' && env.PUBLIC_SEARCH_GOOGLE_BUDGET_APPROVED !== 'true' ? 'google_budget_not_approved' : null;
    return { tenant_id: tenantId, enabled: reason === null, provider, configured, reason,
        requires_query_authorization: true,
        limitations: [...commonLimitations, provider === 'google_cse' ? 'Google Custom Search JSON API: somente clientes existentes elegíveis; encerramento em 2027-01-01 UTC.' : 'Dados via DuckDuckGo Instant Answer. Aprovação comercial prévia e verificação das condições atuais são necessárias; documentação histórica arquivada não confirma autorização atual.', provider === 'duckduckgo_instant_answer'
                ? 'DuckDuckGo Instant Answer não é diretório comercial nem busca web completa; pode não retornar resultados.'
                : 'Google CSE depende de credenciais, elegibilidade, quota e orçamento aprovados; não há fallback automático.'] };
}
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
// eslint-disable-next-line no-control-regex -- Strip control characters from untrusted provider text.
const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
function publicResultUrl(value) {
    // eslint-disable-next-line no-control-regex -- Reject control characters in source links.
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value))
        return null;
    try {
        const u = new URL(value);
        if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
            return null;
        const host = u.hostname.toLowerCase().replace(/\.$/, '');
        // Conservatively reject all IP literals, including IPv6, and non-public naming suffixes.
        if (!host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host) ||
            /(^|\.)(localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host))
            return null;
        if (u.port || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
            return null;
        u.hash = '';
        return u.href;
    }
    catch {
        return null;
    }
}
function phoneEvidence(snippet) {
    const matches = snippet.matchAll(/(?<![\d+])(?:\+55[ .-]?)?(?:\([1-9]\d\)|[1-9]\d)[ .-]?(?:9\d{4}|[2-5]\d{3})[- .]?\d{4}(?!\d)/g);
    const evidence = [];
    const validDdd = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
    for (const match of matches) {
        const raw = match[0];
        // Unformatted digit strings may be document IDs; do not treat them as phones.
        if (!/[(). -]/.test(raw))
            continue;
        const digits = raw.replace(/\D/g, '');
        const national = raw.startsWith('+55') ? digits.slice(2) : digits;
        if (!validDdd.has(national.slice(0, 2)))
            continue;
        const normalized = '+55' + national;
        if (!evidence.some(e => e.normalized === normalized))
            evidence.push({ raw, normalized, excerpt: snippet });
        if (evidence.length === 5)
            break;
    }
    return evidence;
}
function adaptResults(provider, data) {
    const source = object(data);
    const results = [];
    const seen = new Set();
    const add = (titleValue, snippetValue, urlValue) => {
        if (results.length >= 10)
            return;
        const title = text(titleValue, 300), snippet = text(snippetValue, 2000), url = publicResultUrl(urlValue);
        if (!title || !url || seen.has(url))
            return;
        seen.add(url);
        results.push({ title, snippet, url, phone_evidence: phoneEvidence(snippet) });
    };
    if (provider === 'google_cse') {
        for (const item of (Array.isArray(source.items) ? source.items : []).slice(0, 100)) {
            const row = object(item);
            add(row.title, row.snippet, row.link);
        }
    }
    else {
        add(source.Heading, source.AbstractText, source.AbstractURL);
        let visited = 0;
        const walk = (topics, depth) => {
            if (!Array.isArray(topics) || depth > 4)
                return;
            for (const topic of topics) {
                if (++visited > 100 || results.length >= 10)
                    return;
                const row = object(topic);
                // Text itself is source-supplied, never a manufactured title.
                add(row.Text, row.Text, row.FirstURL);
                walk(row.Topics, depth + 1);
            }
        };
        walk(source.Results, 0);
        walk(source.RelatedTopics, 0);
    }
    return results;
}
async function runPublicSearch(options) {
    const capability = searchCapabilities(options.env, options.auth, options.now);
    const body = object(options.body);
    const keys = ['query', 'expected_tenant_id', 'expected_provider', 'authorize_public_query', 'request_id'];
    if (Object.keys(body).length !== keys.length || !keys.every(key => Object.hasOwn(body, key)))
        return fail(400, 'invalid_request');
    if (body.authorize_public_query !== true)
        return fail(400, 'public_query_authorization_required');
    // eslint-disable-next-line no-control-regex -- Queries containing control characters must not leave the server.
    if (typeof body.query !== 'string' || body.query.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(body.query))
        return fail(400, 'invalid_query');
    const query = body.query.trim().replace(/\s+/g, ' ');
    if (!query)
        return fail(400, 'invalid_query');
    if (typeof body.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id))
        return fail(400, 'invalid_request_id');
    // Snapshot the validated receipt before any asynchronous provider operation.
    const requestId = body.request_id;
    if (body.expected_tenant_id !== capability.tenant_id)
        return fail(409, 'tenant_changed');
    if (body.expected_provider !== capability.provider)
        return fail(409, 'provider_changed');
    if (!capability.enabled)
        return fail(503, capability.reason || 'search_unavailable');
    const claim = (options.ledger || processLedger).claim([capability.tenant_id, options.auth.userId, requestId.toLowerCase()], [query, capability.provider, body.expected_tenant_id, body.authorize_public_query]);
    if (claim.replay) return claim.replay;
    const google = capability.provider === 'google_cse';
    const url = google ? 'https://www.googleapis.com/customsearch/v1' : 'https://api.duckduckgo.com/';
    const params = google
        ? { key: options.env.GOOGLE_API_KEY, cx: options.env.GOOGLE_SEARCH_ENGINE_ID, q: query, num: 10, hl: 'pt-BR' }
        : { q: query, format: 'json', no_redirect: 1, no_html: 1, t: 'nucleo-public-search' };
    const controller = new AbortController();
    let timer;
    try {
        const response = await Promise.race([
            options.transport(url, { params, timeout: TIMEOUT, maxContentLength: LIMIT, maxBodyLength: LIMIT, maxRedirects: 0, signal: controller.signal }),
            new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new PublicSearchError(504, 'provider_timeout')); }, TIMEOUT); })
        ]);
        const serialized = JSON.stringify(response.data);
        if (!serialized || new TextEncoder().encode(serialized).byteLength > LIMIT)
            return fail(502, 'provider_response_invalid');
        let data = response.data;
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            }
            catch {
                return fail(502, 'provider_response_invalid');
            }
        }
        if (!data || typeof data !== 'object' || Array.isArray(data))
            return fail(502, 'provider_response_invalid');
        if (Object.hasOwn(data, 'error'))
            return fail(502, 'provider_request_failed');
        validateProviderResponse(capability.provider, data);
        const result = { request_id: requestId, tenant_id: capability.tenant_id, query, provider: capability.provider,
            searched_at: (options.now?.() || new Date()).toISOString(), results: adaptResults(capability.provider, data),
            limitations: capability.limitations, state: { whatsapp: 'unknown', activity: 'unknown', contact_permission: 'not_established' } };
        claim.complete(result);
        return result;
    }
    catch (error) {
        claim.uncertain();
        if (error instanceof PublicSearchError)
            throw error;
        return fail(502, 'provider_request_failed');
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
function createSearchHandlers(options) {
    const sendError = (res, error) => {
        const known = error instanceof PublicSearchError;
        res.status(known ? error.status : 500).json({ error: known ? error.message : 'search_failed' });
    };
    return {
        guard(req, res, next) {
            try {
                requireSearchAuth(req.auth);
                next();
            }
            catch (error) {
                sendError(res, error);
            }
        },
        capabilities(req, res) {
            res.setHeader('Cache-Control', 'no-store');
            try {
                res.json(searchCapabilities(options.env, req.auth, options.now));
            }
            catch (error) {
                sendError(res, error);
            }
        },
        async search(req, res) {
            res.setHeader('Cache-Control', 'no-store');
            try {
                res.json(await runPublicSearch({ ...options, auth: req.auth, body: req.body }));
            }
            catch (error) {
                sendError(res, error);
            }
        }
    };
}
