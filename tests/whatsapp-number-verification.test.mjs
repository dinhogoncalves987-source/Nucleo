import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWhatsappNumberVerification, WhatsappVerificationError } from '../shared/whatsapp-number-verification.cjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-11-08T12:00:00.000Z', expiry = '2026-11-08T12:10:00.000Z';
const auth = () => ({ userId: id(1), tenantId: id(2), sessionId: id(3), appRole: 'operator', expiresAt: expiry, isAnonymous: false });
const body = (changes = {}) => ({ request_id: id(4), expected_tenant_id: id(2), expected_actor_id: id(1), expected_session_id: id(3), expected_channel_id: id(5), phone: '+5511987654321', authorize_number_query: true, ...changes });
const binding = () => ({ tenantId: id(2), channelId: id(5), transportSessionId: id(6), transportEpoch: 1, connected: true });
const grant = q => ({ requestId: q.requestId, phone: q.phone, tenantId: q.tenantId, actorId: q.actorId, authSessionId: q.authSessionId, channelId: q.channelId, transportSessionId: id(6), transportEpoch: 1, expiresAt: expiry, allowed: true, connected: true, ownershipVerified: true });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
  const calls = [], grants = []; let current = new Date(date);
  const service = createWhatsappNumberVerification({ enabled: true, mode: 'synthetic', now: () => current,
    authorizeQuery: q => { grants.push(q); return grant(q); },
    transport: { mode: 'synthetic', getBinding: binding, onWhatsApp: (...args) => { calls.push(args); return [{ exists: true, jid: args[0] + '@s.whatsapp.net' }]; } }, ...options });
  return { service, calls, grants, time: value => { current = new Date(value); }, verify: (b = body(), a = auth()) => service.verify({ body: b, auth: a }) };
}
const rejects = (promise, code, status) => assert.rejects(promise, e => e instanceof WhatsappVerificationError && e.code === code && e.message === code && (status === undefined || e.status === status));

test('no gateway imports, IO, application mounting, database, sending or automatic activation', () => {
  const source = readFileSync(new URL('../shared/whatsapp-number-verification.cjs', import.meta.url), 'utf8');
  assert.ok(!/require\((?!['"]node:crypto['"])/.test(source));
  assert.ok(!/\b(?:fetch|sendMessage|relayMessage|makeWASocket|writeFile|readFile|setInterval)\s*\(/.test(source));
  assert.ok(!/process\.env|console\.|\.listen\(/.test(source));
});
test('disabled default, real mode impossible and dependencies explicit', async t => {
  const cases = [[{}, 'verification_disabled'], [{ enabled: true }, 'real_transport_not_integrated'], [{ enabled: true, mode: 'production' }, 'real_transport_not_integrated'], [{ enabled: true, mode: 'synthetic' }, 'synthetic_dependencies_required'], [{ enabled: 'true', mode: 'synthetic' }, 'verification_disabled']];
  for (const [options, code] of cases) await t.test(code, async () => {
    const s = createWhatsappNumberVerification(options); assert.equal(s.capabilities().production_ready, false); assert.equal(s.capabilities().enabled, false); await rejects(s.verify(), code);
  });
});
test('invalid configuration rejected synchronously', () => {
  for (const timeoutMs of [0, -1, 8001, NaN, Infinity, 1.5, '100']) assert.throws(() => createWhatsappNumberVerification({ timeoutMs }), { code: 'verification_configuration_invalid' });
  assert.throws(() => createWhatsappNumberVerification({ now: null }), { code: 'verification_configuration_invalid' });
});
test('exact trusted identity and live expiry required before callback', async t => {
  for (const [changes, code] of [[{ userId: 'x' }, 'authentication_required'], [{ sessionId: 'x' }, 'authentication_required'], [{ isAnonymous: true }, 'authentication_required'], [{ isAnonymous: undefined }, 'authentication_required'], [{ tenantId: '' }, 'tenant_required'], [{ appRole: 'viewer' }, 'role_forbidden'], [{ expiresAt: date }, 'authentication_required'], [{ expiresAt: '2026-11-08T13:00:00Z' }, 'authentication_required'], [{ extra: true }, 'authentication_required']]) await t.test(JSON.stringify(changes), async () => { const f = fixture(); await rejects(f.verify(body(), { ...auth(), ...changes }), code); assert.equal(f.calls.length, 0); assert.equal(f.grants.length, 0); });
});
test('exact query, expected scope and explicit number authorization', async t => {
  for (const [changes, code] of [[{ request_id: 'x' }, 'invalid_request_id'], [{ expected_tenant_id: id(7) }, 'tenant_changed'], [{ expected_actor_id: id(7) }, 'actor_changed'], [{ expected_session_id: id(7) }, 'session_changed'], [{ expected_channel_id: 'x' }, 'invalid_channel_id'], [{ authorize_number_query: false }, 'number_query_authorization_required'], [{ extra: true }, 'invalid_verification_request']]) await t.test(code, async () => { const f = fixture(); await rejects(f.verify(body(changes)), code); assert.equal(f.calls.length, 0); assert.equal(f.grants.length, 0); });
});
test('single normalized Brazilian phone only: no guessing, formatting, bad DDD or multiple targets', async t => {
  for (const phone of ['', null, 5511987654321, '5511987654321', '(11) 98765-4321', '+5511987654321\n', '+5520987654321', '+5501987654321', '+551187654321', '+5511999999999', '+4411987654321', '+5511987654321,+5511987654322', ['+5511987654321']]) await t.test(String(phone), async () => { const f = fixture(); await rejects(f.verify(body({ phone })), 'invalid_phone'); assert.equal(f.calls.length, 0); });
  const f = fixture(); assert.equal((await f.verify(body({ phone: '+551123456789' }))).phone, '+551123456789');
});
test('success uses one digits argument; synthetic evidence never validates or permits contact', async () => {
  const f = fixture(), r = await f.verify();
  assert.deepEqual(f.calls, [['5511987654321']]); assert.equal(f.grants.length, 2); assert.ok(Object.isFrozen(f.grants[0]));
  assert.equal(r.synthetic, true); assert.equal(r.observation, 'registered_reported');
  assert.equal(r.source.received_at, date); assert.equal(r.source.source_observed_at, null); assert.equal(r.source.kind, 'synthetic_transport_fixture');
  assert.equal(r.state.whatsapp, 'unknown'); assert.equal(r.state.activity, 'unknown'); assert.equal(r.state.consent, 'not_established'); assert.equal(r.state.contact_permission, 'not_established');
  for (const key of ['canContact', 'canSend', 'canEnqueue', 'canMarkLeadVerified']) assert.equal(r[key], false);
  assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.source)); assert.ok(Object.isFrozen(r.state)); assert.ok(!JSON.stringify(r).includes('@s.whatsapp.net'));
});
test('empty observation is unknown; explicit false is only a source report', async () => {
  for (const [raw, expected] of [[[], 'unknown'], [[{ exists: false, jid: '5511987654321@s.whatsapp.net' }], 'not_registered_reported']]) {
    const f = fixture({ transport: { mode: 'synthetic', getBinding: binding, onWhatsApp: () => raw } }); const r = await f.verify(); assert.equal(r.observation, expected); assert.equal(r.state.whatsapp, 'unknown');
  }
});
test('malformed, multiple, unrelated and canonical ninth-digit variants are rejected', async t => {
  const valid = { exists: true, jid: '5511987654321@s.whatsapp.net' };
  for (const raw of [undefined, null, {}, true, [valid, valid], new Array(1), [{ ...valid, extra: 'private' }], [{ ...valid, exists: 'true' }], [{ ...valid, jid: '551187654321@s.whatsapp.net' }], [{ ...valid, jid: '5511987654322@s.whatsapp.net' }], [{ ...valid, jid: '5511987654321@g.us' }], [{ ...valid, jid: '5511987654321@lid' }]]) await t.test(String(raw), async () => { const f = fixture({ transport: { mode: 'synthetic', getBinding: binding, onWhatsApp: () => raw } }); await rejects(f.verify(), 'verification_response_invalid'); assert.equal(f.grants.length, 1); });
});
test('each authorization grant binding is mandatory before transport', async t => {
  const cases = [{ allowed: false }, { connected: false }, { ownershipVerified: false }, { tenantId: id(9) }, { actorId: id(9) }, { authSessionId: id(9) }, { channelId: id(9) }, { requestId: id(9) }, { phone: '+5511987654322' }, { transportSessionId: 'x' }, { transportEpoch: 0 }, { expiresAt: date }, { extra: true }];
  for (const change of cases) await t.test(JSON.stringify(change), async () => { const f = fixture({ authorizeQuery: q => ({ ...grant(q), ...change }) }); await assert.rejects(f.verify(), e => e instanceof WhatsappVerificationError && e.status === 403); assert.equal(f.calls.length, 0); });
});
test('revalidation discards revoked, swapped or expired scope after lookup', async t => {
  for (const change of [{ allowed: false }, { transportEpoch: 2 }, { transportSessionId: id(8) }, { expiresAt: '2026-11-08T12:11:00.000Z' }, { tenantId: id(8) }]) await t.test(JSON.stringify(change), async () => {
    let count = 0; const f = fixture({ authorizeQuery: q => ({ ...grant(q), ...(++count === 2 ? change : {}) }) }); await assert.rejects(f.verify(), WhatsappVerificationError); assert.equal(f.calls.length, 1); await rejects(f.verify(), 'verification_request_replayed');
  });
});
test('auth expiry after lookup prevents evidence release', async () => {
  const f = fixture({ transport: { mode: 'synthetic', getBinding: binding, onWhatsApp: phone => { f.time(expiry); return [{ exists: true, jid: phone + '@s.whatsapp.net' }]; } } });
  await assert.rejects(f.verify(), e => e.code === 'transport_binding_invalid' || e.code === 'authentication_required');
});
test('input and grant mutations after await do not redirect number or identity', async () => {
  const first = deferred(), a = auth(), b = body(); let issued;
  const f = fixture({ authorizeQuery: q => { issued = grant(q); return f.calls.length ? issued : first.promise; } });
  const task = f.verify(b, a); await Promise.resolve();
  const captured = issued; b.phone = '+5511987654322'; a.userId = id(9); first.resolve(captured);
  const r = await task; assert.equal(r.phone, '+5511987654321'); assert.equal(r.actor_id, id(1)); assert.deepEqual(f.calls[0], ['5511987654321']);
});
test('same ID replay and changed payload conflict never query twice', async () => {
  const f = fixture(); await f.verify(); await rejects(f.verify(), 'verification_request_replayed'); await rejects(f.verify(body({ phone: '+5511987654322' })), 'verification_request_conflict'); assert.equal(f.calls.length, 1);
});
test('new request/session/actor/channel does not retry same tenant number', async () => {
  const f = fixture(); await f.verify();
  await rejects(f.verify(body({ request_id: id(10), expected_actor_id: id(11), expected_session_id: id(12), expected_channel_id: id(13) }), { ...auth(), userId: id(11), sessionId: id(12) }), 'number_query_already_attempted'); assert.equal(f.calls.length, 1);
});
test('concurrent and synchronous reentrant calls reserved before callback', async () => {
  const pending = deferred(); let nested;
  const f = fixture({ authorizeQuery: q => { if (!nested) nested = f.verify().catch(e => e.code); return pending.promise.then(() => grant(q)); } });
  const task = f.verify(); await Promise.resolve(); await Promise.resolve();
  assert.equal(await nested, 'verification_request_replayed');
  await rejects(f.verify(body({ request_id: id(20), phone: '+5511987654322' })), 'verification_busy'); pending.resolve(); await task; assert.equal(f.calls.length, 1);
});
test('timeout never repeats; late unresolved lookup blocks other targets until settled', async () => {
  const pending = deferred(); let calls = 0;
  const f = fixture({ timeoutMs: 15, transport: { mode: 'synthetic', getBinding: binding, onWhatsApp: () => { calls++; return pending.promise; } } });
  await rejects(f.verify(), 'verification_timeout', 504);
  await rejects(f.verify(), 'verification_request_replayed');
  await rejects(f.verify(body({ request_id: id(21), phone: '+5511987654322' })), 'verification_busy');
  pending.resolve([{ exists: true, jid: '5511987654321@s.whatsapp.net' }]); await new Promise(resolve => setTimeout(resolve, 0));
  await rejects(f.verify(body({ request_id: id(22) })), 'number_query_already_attempted'); assert.equal(calls, 1);
});
test('late authorization after deadline cannot enter lookup', async () => {
  const pending = deferred(); let q;
  const f = fixture({ timeoutMs: 10, authorizeQuery: query => { q = query; return pending.promise; } });
  await rejects(f.verify(), 'verification_timeout'); pending.resolve(grant(q)); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(f.calls.length, 0);
});
test('provider failure does not leak raw data or reset tombstone', async () => {
  const f = fixture({ transport: { mode: 'synthetic', getBinding: binding, onWhatsApp: () => { throw Error('PRIVATE_PHONE_SECRET'); } } });
  await rejects(f.verify(), 'verification_transport_failed'); await rejects(f.verify(), 'verification_request_replayed');
});
test('bounded ledger never evicts successful, denied or uncertain requests', async () => {
  const f = fixture();
  for (let i = 0; i < 128; i++) await f.verify(body({ request_id: id(1000 + i), phone: '+55119' + String(10000001 + i) }));
  await rejects(f.verify(body({ request_id: id(2000), phone: '+5511922223333' })), 'verification_capacity_reached');
  assert.equal(f.calls.length, 128);
});
test('backwards/invalid clock fails closed without number query', async () => {
  for (const now of [() => new Date('bad'), () => '2026-11-08', () => { throw Error('secret'); }]) { const f = fixture({ now }); await rejects(f.verify(), 'verification_clock_invalid'); }
  const f = fixture(); await f.verify(); f.time('2026-11-07T12:00:00.000Z'); await rejects(f.verify(body({ request_id: id(30), phone: '+5511987654322' })), 'verification_clock_invalid');
});
