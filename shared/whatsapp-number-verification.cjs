'use strict';
// Preparatory, synthetic-only contract for the existing gateway's onWhatsApp shape.
// No gateway import, session startup, network client, route, lead write or message send.
const { createHmac, randomBytes } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DDD = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
const ROLES = new Set(['superadmin', 'manager', 'operator']);
const LIMITS = Object.freeze({ deadline_ms: 8000, ledger_entries: 128, concurrent_queries: 1 });
const LIMITATIONS = Object.freeze([
  'Somente contrato sintetico. Nenhuma verificacao real de numero esta integrada ou habilitavel.',
  'Presenca relatada no WhatsApp nao comprova uso atual, titularidade, interesse ou consentimento.',
  'Nenhum lead e alterado, verificado, autorizado, enfileirado ou contatado.',
  'A data registra recebimento local; data de observacao da fonte e desconhecida.',
  'Baileys onWhatsApp nao oferece AbortSignal neste contrato. Timeout descarta o resultado, sem cancelar ou repetir a consulta.',
  'Ledger em memoria por instancia: sem garantia entre processos/reinicio. O contrato nao pode ser montado em producao.'
]);
class WhatsappVerificationError extends Error {
  constructor(status, code) { super(code); this.name = 'WhatsappVerificationError'; this.status = status; this.code = code; }
}
const internalErrors = new WeakSet();
const safeError = (status, code) => { const error = new WhatsappVerificationError(status, code); internalErrors.add(error); return error; };
const fail = (status, code) => { throw safeError(status, code); };
function snapshot(value, keys, status, code) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw 0;
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some(key => !keys.includes(key))) throw 0;
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw 0;
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch { fail(status, code); }
}
const uuid = value => typeof value === 'string' && UUID.test(value);
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
}
function validatePhone(value) {
  // Existing lead import normalization accepts presentation formatting; this boundary
  // intentionally requires an already-normalized exact number, never inferring digits.
  if (typeof value !== 'string' || !/^\+55[1-9]\d(?:[2-5]\d{7}|9\d{8})$/.test(value) ||
      !DDD.has(value.slice(3, 5)) || /^(.)\1+$/.test(value.slice(-8))) fail(400, 'invalid_phone');
  return value;
}
function authSnapshot(raw, time) {
  const auth = snapshot(raw, ['userId', 'tenantId', 'sessionId', 'appRole', 'expiresAt', 'isAnonymous'], 401, 'authentication_required');
  if (!uuid(auth.userId) || !uuid(auth.sessionId) || auth.isAnonymous !== false || timestamp(auth.expiresAt) === null || timestamp(auth.expiresAt) <= time) fail(401, 'authentication_required');
  if (!uuid(auth.tenantId)) fail(403, 'tenant_required');
  if (!ROLES.has(auth.appRole)) fail(403, 'role_forbidden');
  return auth;
}
function requestSnapshot(raw, auth) {
  const body = snapshot(raw, ['request_id', 'expected_tenant_id', 'expected_actor_id', 'expected_session_id', 'expected_channel_id', 'phone', 'authorize_number_query'], 400, 'invalid_verification_request');
  if (!uuid(body.request_id)) fail(400, 'invalid_request_id');
  if (body.expected_tenant_id !== auth.tenantId) fail(409, 'tenant_changed');
  if (body.expected_actor_id !== auth.userId) fail(409, 'actor_changed');
  if (body.expected_session_id !== auth.sessionId) fail(409, 'session_changed');
  if (!uuid(body.expected_channel_id)) fail(400, 'invalid_channel_id');
  if (body.authorize_number_query !== true) fail(403, 'number_query_authorization_required');
  validatePhone(body.phone);
  return body;
}
const GRANT_KEYS = ['requestId', 'phone', 'tenantId', 'actorId', 'authSessionId', 'channelId', 'transportSessionId', 'transportEpoch', 'expiresAt', 'allowed', 'connected', 'ownershipVerified'];
function grantSnapshot(raw, query, time) {
  const grant = snapshot(raw, GRANT_KEYS, 403, 'query_authorization_invalid');
  for (const key of ['requestId', 'phone', 'tenantId', 'actorId', 'authSessionId', 'channelId']) if (grant[key] !== query[key]) fail(403, 'query_scope_mismatch');
  if (grant.allowed !== true || grant.connected !== true || grant.ownershipVerified !== true) fail(403, 'query_not_authorized');
  if (!uuid(grant.transportSessionId) || !Number.isSafeInteger(grant.transportEpoch) || grant.transportEpoch < 1 || timestamp(grant.expiresAt) === null || timestamp(grant.expiresAt) <= time) fail(403, 'transport_binding_invalid');
  return grant;
}
function observation(raw, phone) {
  // Exact scope only: do not guess that a changed Brazilian ninth digit is the
  // same subscriber, and never return unrequested JIDs, LIDs or extra provider data.
  try {
    if (!Array.isArray(raw) || Reflect.ownKeys(raw).some(key => !['length', '0'].includes(key)) || raw.length > 1) throw 0;
    if (raw.length === 0) return 'unknown';
    const slot = Object.getOwnPropertyDescriptor(raw, '0');
    if (!slot || !Object.hasOwn(slot, 'value')) throw 0;
    const entry = snapshot(slot.value, ['exists', 'jid'], 502, 'verification_response_invalid');
    if (typeof entry.exists !== 'boolean' || entry.jid !== phone.slice(1) + '@s.whatsapp.net') throw 0;
    return entry.exists ? 'registered_reported' : 'not_registered_reported';
  } catch { fail(502, 'verification_response_invalid'); }
}
function bounded(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(safeError(504, 'verification_timeout'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw safeError(504, 'verification_timeout');
      return work();
    }).then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) abort(); else resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function createWhatsappNumberVerification({ enabled = false, mode = 'disabled', authorizeQuery, transport, now = () => new Date(), timeoutMs = LIMITS.deadline_ms } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMITS.deadline_ms || typeof now !== 'function') fail(500, 'verification_configuration_invalid');
  // The synthetic label is a caller contract, not proof an arbitrary JS callback
  // is harmless. No real callback is supplied or constructed by this module.
  const lookup = transport?.mode === 'synthetic' && typeof transport.onWhatsApp === 'function' ? transport.onWhatsApp.bind(transport) : null;
  const readBinding = typeof transport?.getBinding === 'function' ? transport.getBinding.bind(transport) : null;
  const reason = enabled !== true ? 'verification_disabled' : mode !== 'synthetic' ? 'real_transport_not_integrated' : typeof authorizeQuery !== 'function' || !lookup || !readBinding ? 'synthetic_dependencies_required' : null;
  const ledger = new Map(), targets = new Set(), secret = randomBytes(32);
  let busy = false, transportInFlight = false, lastTime = -Infinity;
  const digest = value => createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
  function clock() {
    let date;
    let time;
    try { date = now(); time = date instanceof Date ? Date.prototype.getTime.call(date) : NaN; } catch { fail(503, 'verification_clock_invalid'); }
    if (!Number.isSafeInteger(time) || time < 0 || time < lastTime) fail(503, 'verification_clock_invalid');
    lastTime = time;
    return time;
  }
  function requireBinding(grant) {
    let raw;
    try { raw = readBinding(); } catch { fail(503, 'transport_binding_unavailable'); }
    const binding = snapshot(raw, ['tenantId', 'channelId', 'transportSessionId', 'transportEpoch', 'connected'], 403, 'transport_binding_invalid');
    if (binding.connected !== true || ['tenantId', 'channelId', 'transportSessionId', 'transportEpoch'].some(key => binding[key] !== grant[key])) fail(403, 'transport_binding_mismatch');
  }
  const capabilities = () => Object.freeze({ enabled: reason === null, mode: 'synthetic_only', production_ready: false, reason, requires_query_authorization: true, limits: LIMITS, limitations: LIMITATIONS });
  async function verify({ auth: inputAuth, body: inputBody } = {}) {
    if (reason) fail(503, reason);
    const auth = authSnapshot(inputAuth, clock()), body = requestSnapshot(inputBody, auth);
    const query = Object.freeze({ requestId: body.request_id, phone: body.phone, tenantId: auth.tenantId, actorId: auth.userId, authSessionId: auth.sessionId, channelId: body.expected_channel_id, appRole: auth.appRole });
    const key = digest(body.request_id), payload = digest([query, auth.expiresAt]);
    const prior = ledger.get(key);
    if (prior) fail(409, prior === payload ? 'verification_request_replayed' : 'verification_request_conflict');
    // Intentionally broader than session: a new actor/session/channel does not
    // bypass suppression of a prior attempt for the same tenant and number.
    const target = digest([auth.tenantId, body.phone]);
    if (targets.has(target)) fail(409, 'number_query_already_attempted');
    if (busy || transportInFlight) fail(409, 'verification_busy');
    if (ledger.size >= LIMITS.ledger_entries) fail(429, 'verification_capacity_reached');
    // Reserve before any awaited user-supplied callback; never evict tombstones.
    ledger.set(key, payload); targets.add(target); busy = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = controller.signal;
    let stage = 'authorization';
    try {
      const first = grantSnapshot(await bounded(() => authorizeQuery(query, { signal }), signal), query, clock());
      if (timestamp(auth.expiresAt) <= clock()) fail(401, 'authentication_required');
      stage = 'lookup';
      const raw = await bounded(() => {
        // Only one string argument, matching Baileys' variadic string signature.
        // Passing signal/options as a second argument would be an unsafe extra query.
        requireBinding(first);
        const dispatchTime = clock();
        if (timestamp(auth.expiresAt) <= dispatchTime) fail(401, 'authentication_required');
        if (timestamp(first.expiresAt) <= dispatchTime) fail(403, 'transport_binding_invalid');
        if (signal.aborted) fail(504, 'verification_timeout');
        transportInFlight = true;
        try { return Promise.resolve(lookup(body.phone.slice(1))).finally(() => { transportInFlight = false; }); }
        catch { transportInFlight = false; fail(502, 'verification_transport_failed'); }
      }, signal);
      const receivedAt = new Date(clock()).toISOString();
      const result = observation(raw, body.phone);
      stage = 'revalidation';
      const second = grantSnapshot(await bounded(() => authorizeQuery(query, { signal }), signal), query, clock());
      if (timestamp(auth.expiresAt) <= clock()) fail(401, 'authentication_required');
      if (GRANT_KEYS.some(key => first[key] !== second[key])) fail(409, 'authorization_changed');
      requireBinding(second);
      const releaseTime = clock();
      if (timestamp(auth.expiresAt) <= releaseTime) fail(401, 'authentication_required');
      if (timestamp(second.expiresAt) <= releaseTime) fail(403, 'transport_binding_invalid');
      return Object.freeze({
        synthetic: true, request_id: body.request_id, tenant_id: auth.tenantId, actor_id: auth.userId,
        auth_session_id: auth.sessionId, channel_id: body.expected_channel_id, phone: body.phone,
        observation: result,
        source: Object.freeze({ kind: 'synthetic_transport_fixture', origin: 'existing_gateway_onWhatsApp_contract', library: '@whiskeysockets/baileys', inspected_version: '7.0.0-rc14', method: 'onWhatsApp', received_at: receivedAt, source_observed_at: null }),
        state: Object.freeze({ whatsapp: 'unknown', activity: 'unknown', number_ownership: 'unverified', consent: 'not_established', contact_permission: 'not_established' }),
        canContact: false, canSend: false, canEnqueue: false, canMarkLeadVerified: false, limitations: LIMITATIONS
      });
    } catch (error) {
      if (signal.aborted) fail(504, 'verification_timeout');
      if (internalErrors.has(error)) throw error;
      fail(stage === 'lookup' ? 502 : 503, stage === 'lookup' ? 'verification_transport_failed' : 'verification_authorization_unavailable');
    } finally { clearTimeout(timer); controller.abort(); busy = false; }
  }
  return Object.freeze({ capabilities, verify });
}
module.exports = { createWhatsappNumberVerification, WhatsappVerificationError };
