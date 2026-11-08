"use strict";
const { PublicSearchError, requireSearchAuth, searchCapabilities, runPublicSearch } = require('../../shared/public-search.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createBoundedSearchTransport(fetchImpl = globalThis.fetch) {
  return async (url, options) => {
    // Only core-owned provider endpoints; never a result URL.
    if (!['https://api.duckduckgo.com/', 'https://www.googleapis.com/customsearch/v1'].includes(url)) throw new PublicSearchError(502, 'provider_request_failed');
    const target = new URL(url);
    for (const [key, value] of Object.entries(options.params)) target.searchParams.set(key, String(value));
    const response = await fetchImpl(target.href, { method: 'GET', signal: options.signal, redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) { await response.body?.cancel(); throw new PublicSearchError(502, 'provider_request_failed'); }
    const maxBytes = Math.min(options.maxContentLength, 256 * 1024);
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
      await response.body?.cancel(); throw new PublicSearchError(502, 'provider_response_invalid');
    }
    if (!response.body) throw new PublicSearchError(502, 'provider_response_invalid');
    const reader = response.body.getReader();
    let size = 0, data = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new PublicSearchError(502, 'provider_response_invalid'); }
        data += decoder.decode(part.value, { stream: true });
      }
      data += decoder.decode();
    } finally { reader.releaseLock(); }
    return { data };
  };
}

function createAuthenticatedSearchBridge({ env, createClient, fetchImpl = globalThis.fetch, now, authTimeoutMs = 5000 }) {
  const transport = createBoundedSearchTransport(fetchImpl);
  async function authenticateWork(request, isExpired) {
    // Search always authenticates against Núcleo. James/Qadma mode never changes this authority.
    const headers = request.rawHeaders;
    let values;
    if (Array.isArray(headers)) {
      values = [];
      for (let index = 0; index < headers.length; index += 2) if (headers[index].toLowerCase() === 'authorization') values.push(headers[index + 1]);
    } else values = [request.headers?.authorization].filter(value => value !== undefined);
    const token = values.length === 1 && typeof values[0] === 'string' ? /^Bearer ([^\s,]+)$/.exec(values[0])?.[1] : null;
    if (!token) throw new PublicSearchError(401, 'authentication_required');
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new PublicSearchError(503, 'auth_unavailable');
    let db, result, profile;
    try {
      db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      result = await db.auth.getUser(token);
    } catch { throw new PublicSearchError(503, 'auth_unavailable'); }
    if (isExpired()) throw new PublicSearchError(503, 'auth_unavailable');
    const userId = result.data?.user?.id;
    if (result.data?.user?.is_anonymous === true || result.error || typeof userId !== 'string' || !UUID.test(userId)) throw new PublicSearchError(401, 'authentication_required');
    try { profile = await db.from('profiles').select('tenant_id, role').eq('id', userId).single(); }
    catch { throw new PublicSearchError(503, 'auth_unavailable'); }
    if (isExpired()) throw new PublicSearchError(503, 'auth_unavailable');
    if (profile.error || !UUID.test(profile.data?.tenant_id || '')) throw new PublicSearchError(403, 'tenant_required');
    const auth = { userId, tenantId: profile.data.tenant_id, appRole: profile.data.role };
    requireSearchAuth(auth);
    return auth;
  }
  async function authenticate(request) {
    let expired = false, timer;
    const timeout = Number.isFinite(authTimeoutMs) ? Math.min(5000, Math.max(1, authTimeoutMs)) : 5000;
    try {
      return await Promise.race([
        authenticateWork(request, () => expired),
        new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new PublicSearchError(503, 'auth_unavailable')); }, timeout); })
      ]);
    } finally { expired = true; clearTimeout(timer); }
  }
  async function handle(request, capabilities) {
    try {
      const auth = await authenticate(request);
      return { status: 200, body: capabilities ? searchCapabilities(env, auth, now) : await runPublicSearch({ env, auth, body: request.body, transport, now }) };
    } catch (error) {
      const known = error instanceof PublicSearchError;
      return { status: known ? error.status : 500, body: { error: known ? error.message : 'search_failed' } };
    }
  }
  return { capabilities: request => handle(request, true), search: request => handle(request, false) };
}
module.exports = { createAuthenticatedSearchBridge, createBoundedSearchTransport };
