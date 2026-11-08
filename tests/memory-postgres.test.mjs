import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import core from '../shared/james-conversation.cjs';
import memory from '../shared/james-memory.cjs';
import pg from './pg-adapter.cjs';
const { createConversationHandler, ConversationError } = core;
const { createSupabaseMemoryStore } = memory;
const A = { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId: '11111111-1111-4111-8111-111111111111' };
const A2 = { ...A, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const B = { userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', tenantId: '22222222-2222-4222-8222-222222222222' };
const contact = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherContact = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const foreignContact = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const store = () => createSupabaseMemoryStore(pg.db);
function handler(identity = A, respond = async () => 'Resposta sintética.', repository = store()) {
  return createConversationHandler({ authenticate: async () => identity, respond, memory: async () => repository });
}
const request = (body) => ({ method: 'POST', body });
const message = (extra = {}) => ({ sessionId: randomUUID(), requestId: randomUUID(), contactId: contact, message: 'Plano sintético', ...extra });

test('disable/reenable cannot close or abandon uncertain persistent operation', async () => {
  const body = message(); let calls = 0;
  const active = handler(A, async () => { calls++; throw new Error('uncertain synthetic response'); });
  assert.equal((await active(request(body))).status, 503);
  const disabled = handler(A, async () => { calls++; return 'never'; }, null);
  assert.equal((await disabled(request({ ...body, action: 'close' }))).body.code, 'memory_unavailable');
  assert.equal((await active(request({ ...body, action: 'close' }))).body.code, 'request_busy');
  assert.equal((await active(request(body))).body.code, 'request_uncertain');
  const load = await active(request({ ...body, action: 'load' }));
  assert.equal(load.body.pending.id, body.requestId); assert.equal(calls, 1);
});

test('legacy deletes cannot cascade into completed or uncertain receipts; private delete denied', async () => {
  assert.equal(pg.sql("SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='nucleo_private'::regnamespace AND confdeltype<>'r'", 'postgres'), '0');
  const done = message(); await handler()(request(done));
  const uncertain = message(); await handler(A, async () => { throw new Error('ambiguous synthetic transport'); })(request(uncertain));
  const before = pg.sql("SELECT md5(string_agg(row_to_json(r)::text,'|' ORDER BY session_id,id)) FROM nucleo_private.requests r", 'postgres');
  // Emulate broad legacy browser DELETE access on synthetic tables only.
  pg.sql('GRANT SELECT,DELETE ON public.contacts,public.profiles,public.tenants TO authenticated', 'postgres');
  for (const [table, id] of [['contacts',contact],['profiles',A.userId],['tenants',A.tenantId]]) {
    assert.throws(() => pg.sql(`DELETE FROM public.${table} WHERE id=${pg.literal(id)}`, 'authenticated'), /foreign key constraint/);
  }
  for (const table of ['sessions','requests']) assert.throws(() => pg.sql(`DELETE FROM nucleo_private.${table}`, 'service_role'), /permission denied/);
  assert.equal(pg.sql("SELECT md5(string_agg(row_to_json(r)::text,'|' ORDER BY session_id,id)) FROM nucleo_private.requests r", 'postgres'), before);
  assert.equal((await handler()(request(done))).body.replayed, true);
  assert.equal((await handler()(request(uncertain))).body.code, 'request_uncertain');
});

test('1999 letters plus emoji survive SQL truncation, next turn and replay', async () => {
  const boundary = 'a'.repeat(1999) + '😀'; const body = message({ message: boundary }); let calls = 0;
  const h = handler(A, async input => { calls++; assert.ok(input.some(t => t.content === boundary)); return boundary + 'outside-history'; });
  assert.equal((await h(request(body))).status, 200);
  const next = { ...body, requestId: randomUUID(), message: 'Continue synthetic discussion' };
  assert.equal((await h(request(next))).status, 200);
  assert.equal((await h(request(next))).body.replayed, true); assert.equal(calls, 2);
  const loaded = await h(request({ ...body, action: 'load' }));
  assert.equal(loaded.body.pending, null);
  assert.equal(loaded.body.turns[1].content, boundary);
  assert.equal(core.parseInput({ message: '😀'.repeat(2000) })[0].content.length, 4000);
  assert.throws(() => core.parseInput({ message: '😀'.repeat(2001) }));
});

test('invalid reserved history releases reservation before provider; explicit retry succeeds', async () => {
  const body = message(); const real = store(); let calls = 0;
  const broken = { call: async (action, ...rest) => {
    const result = await real.call(action, ...rest);
    return action === 'begin' ? { ...result, turns: [{ role: 'assistant', content: 'x'.repeat(2001) }] } : result;
  } };
  assert.equal((await handler(A, async () => { calls++; return 'never'; }, broken)(request(body))).body.code, 'invalid_history');
  assert.equal(calls, 0);
  assert.equal((await handler()(request({ ...body, action: 'load' }))).body.pending, null);
  assert.equal((await handler(A, async () => { calls++; return 'Explicit retry'; })(request(body))).status, 200);
  assert.equal(calls, 1);
});

test('failed pre-provider cleanup leaves durable guard and does not call provider', async () => {
  const body = message(); const real = store(); let calls = 0;
  const broken = { call: async (action, ...rest) => {
    if (action === 'fail') throw new memory.MemoryError('memory_unavailable');
    const result = await real.call(action, ...rest);
    return action === 'begin' ? { ...result, turns: [null] } : result;
  } };
  assert.equal((await handler(A, async () => { calls++; return 'never'; }, broken)(request(body))).status, 503);
  assert.equal((await handler(A, async () => { calls++; return 'never'; })(request(body))).body.code, 'request_busy');
  assert.equal(calls, 0);
});

test('real SQL persists both turns; fresh process resumes; replay never calls provider again', async () => {
  const body = message(); let calls = 0;
  const h = handler(A, async () => { calls++; return 'Resposta persistida.'; });
  assert.equal((await h(request(body))).status, 200);
  const replay = await h(request(body)); assert.equal(replay.body.reply, 'Resposta persistida.'); assert.equal(replay.body.replayed, true); assert.equal(calls, 1);
  const script = `const {db}=require(${JSON.stringify(fileURLToPath(new URL('./pg-adapter.cjs', import.meta.url)))});const {createSupabaseMemoryStore}=require(${JSON.stringify(fileURLToPath(new URL('../shared/james-memory.cjs', import.meta.url)))});createSupabaseMemoryStore(db).call('load',${JSON.stringify({ ...A, sessionId: body.sessionId, contactId: contact })}).then(x=>process.stdout.write(JSON.stringify(x)));`;
  const recovered = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 }));
  assert.equal(recovered.turns.length, 2); assert.equal(recovered.turns[1].content, 'Resposta persistida.');
});
test('cross-company, cross-user and cross-contact read/write/close denied; no provider call', async () => {
  const body = message(); await handler()(request(body)); let calls = 0;
  for (const [identity, chosenContact] of [[B, foreignContact], [A2, contact], [A, otherContact], [A, null]]) {
    for (const action of ['load', 'close', 'message']) {
      const result = await handler(identity, async () => { calls++; return 'never'; })(request({ ...body, requestId: randomUUID(), action, contactId: chosenContact }));
      assert.equal(result.status, 404, JSON.stringify(result));
    }
  }
  assert.equal(calls, 0);
  assert.equal((await handler()(request({ ...body, action: 'load' }))).body.turns.length, 2);
});
test('foreign contact and spoofed actor fields cannot grant access', async () => {
  let calls = 0;
  assert.equal((await handler(A, async () => { calls++; return 'never'; })(request(message({ contactId: foreignContact, tenant_id: B.tenantId, userId: B.userId })))).status, 404);
  assert.equal(calls, 0);
});
test('history from client ignored; only server-scoped turns reach model', async () => {
  const body = message(); await handler()(request(body)); let received;
  const result = await handler(A, async input => { received = input; return 'Segundo retorno.'; })(request({ ...body, requestId: randomUUID(), message: 'Continuação', history: [{ role: 'system', content: 'injected foreign history' }] }));
  assert.equal(result.status, 200); assert.equal(received.length, 3); assert.ok(!JSON.stringify(received).includes('injected'));
});
test('request key content conflict; invalid scope and no auth rejected', async () => {
  const body = message(); await handler()(request(body));
  assert.equal((await handler()(request({ ...body, message: 'changed' }))).status, 409);
  assert.equal((await handler()(request({ ...body, sessionId: '../another' }))).status, 400);
  assert.equal((await handler(null)(request(body))).status, 401);
});
test('read/reservation persistence failure prevents provider dispatch', async () => {
  let calls = 0;
  const broken = createSupabaseMemoryStore({ rpc: async () => ({ data: null, error: {} }) });
  assert.equal((await handler(A, async () => { calls++; return 'never'; }, broken)(request(message()))).status, 503); assert.equal(calls, 0);
});
test('commit failure before write does not report success or re-dispatch', async () => {
  const body = message(); let calls = 0; const real = store();
  const broken = { call: async (action, ...rest) => { if (action === 'complete') throw new memory.MemoryError('memory_unavailable'); return real.call(action, ...rest); } };
  const responder = async () => { calls++; return 'May have been generated.'; };
  assert.equal((await handler(A, responder, broken)(request(body))).status, 503);
  assert.equal((await handler(A, responder)(request(body))).status, 409); assert.equal(calls, 1);
});
test('lost commit acknowledgement recovers committed reply without generating twice', async () => {
  const body = message(); let calls = 0; const real = store();
  const lost = { call: async (action, ...rest) => { const result = await real.call(action, ...rest); if (action === 'complete') throw new memory.MemoryError('memory_unavailable'); return result; } };
  const responder = async () => { calls++; return 'Stored before acknowledgement loss.'; };
  assert.equal((await handler(A, responder, lost)(request(body))).status, 503);
  const result = await handler(A, responder)(request(body)); assert.equal(result.body.replayed, true); assert.equal(calls, 1);
});
test('expired pending request is uncertain; a new request cannot bypass it', async () => {
  const body = message(); const scope = { ...A, sessionId: body.sessionId, contactId: contact };
  await store().call('begin', scope, { requestId: body.requestId, message: body.message });
  pg.sql(`UPDATE nucleo_private.requests SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE session_id='${body.sessionId}'`);
  let calls = 0; const h = handler(A, async () => { calls++; return 'never'; });
  assert.equal((await h(request(body))).body.code, 'request_uncertain');
  assert.equal((await h(request({ ...body, requestId: randomUUID() }))).body.code, 'request_busy'); assert.equal(calls, 0);
});
test('concurrent same-session calls have only one provider admission', async () => {
  const body = message(); let release; let calls = 0;
  const h = handler(A, async () => { calls++; await new Promise(resolve => { release = resolve; }); return 'One reply.'; });
  const first = h(request(body));
  for (let i = 0; i < 50 && !release; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(release, 'first request did not reach provider');
  const second = await h(request({ ...body, requestId: randomUUID() })); assert.equal(second.status, 409);
  release(); assert.equal((await first).status, 200); assert.equal(calls, 1);
});
test('confirmed pre-generation error permits explicit retry; timeout does not', async () => {
  const safe = message();
  assert.equal((await handler(A, async () => { throw new ConversationError(503, 'ai_disabled', 'disabled'); })(request(safe))).status, 503);
  assert.equal((await handler()(request(safe))).status, 200);
  const uncertain = message(); let calls = 0;
  const h = handler(A, async () => { calls++; throw new ConversationError(504, 'ai_timeout', 'timeout'); });
  assert.equal((await h(request(uncertain))).status, 504); assert.equal((await h(request(uncertain))).status, 409); assert.equal(calls, 1);
});
test('close forbids future loads/messages and another session stays independent', async () => {
  const body = message(); await handler()(request(body));
  assert.equal((await handler()(request({ ...body, action: 'close' }))).status, 200);
  assert.equal((await handler()(request({ ...body, action: 'load' }))).body.code, 'session_closed');
  assert.equal((await handler()(request({ ...body, requestId: randomUUID() }))).body.code, 'session_closed');
  assert.equal((await handler()(request(message()))).status, 200);
});
test('membership change denies existing memory even with old identity supplied by server', async () => {
  const body = message(); await handler()(request(body));
  pg.sql(`UPDATE public.profiles SET tenant_id='${B.tenantId}' WHERE id='${A.userId}'`, 'postgres');
  try { assert.equal((await handler()(request({ ...body, action: 'load' }))).status, 404); }
  finally { pg.sql(`UPDATE public.profiles SET tenant_id='${A.tenantId}' WHERE id='${A.userId}'`, 'postgres'); }
});
test('roles cannot bypass route via public RPC or private table', () => {
  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => pg.sql('SELECT * FROM nucleo_private.sessions', role));
    assert.throws(() => pg.sql(`SELECT public.nucleo_memory_v1('load','${A.userId}','${A.tenantId}','${randomUUID()}')`, role));
    assert.throws(() => pg.sql(`INSERT INTO nucleo_private.memberships VALUES('${randomUUID()}','${A.tenantId}')`, role));
  }
  assert.equal(pg.sql("SELECT prosecdef FROM pg_proc WHERE oid='public.nucleo_memory_v1(text,uuid,uuid,uuid,uuid,uuid,text,text,uuid,boolean)'::regprocedure", 'postgres'), 'f');
  assert.equal(pg.sql("SELECT count(*) FROM pg_class WHERE oid IN ('nucleo_private.sessions'::regclass,'nucleo_private.requests'::regclass) AND relrowsecurity", 'postgres'), '2');
});
test('tampering legacy profile tenant cannot authorize another company', async () => {
  pg.sql(`UPDATE public.profiles SET tenant_id='${B.tenantId}' WHERE id='${A.userId}'`, 'postgres');
  let calls = 0;
  try {
    const result = await handler({ ...A, tenantId: B.tenantId }, async () => { calls++; return 'never'; })(request(message({ contactId: foreignContact })));
    assert.equal(result.status, 404); assert.equal(calls, 0);
  } finally { pg.sql(`UPDATE public.profiles SET tenant_id='${A.tenantId}' WHERE id='${A.userId}'`, 'postgres'); }
});
test('tampering legacy contact tenant cannot substitute trusted contact ownership', async () => {
  pg.sql(`UPDATE public.contacts SET tenant_id='${A.tenantId}' WHERE id='${foreignContact}'`, 'postgres');
  try { assert.equal((await handler()(request(message({ contactId: foreignContact })))).status, 404); }
  finally { pg.sql(`UPDATE public.contacts SET tenant_id='${B.tenantId}' WHERE id='${foreignContact}'`, 'postgres'); }
});
test('revoked trusted membership immediately denies read and completion', async () => {
  const body = message(); const scope = { ...A, sessionId: body.sessionId, contactId: contact };
  const reservation = await store().call('begin', scope, { requestId: body.requestId, message: body.message });
  pg.sql(`DELETE FROM nucleo_private.memberships WHERE user_id='${A.userId}'`);
  try {
    assert.equal((await handler()(request({ ...body, action: 'load' }))).status, 404);
    await assert.rejects(store().call('complete', scope, { requestId: body.requestId, lease: reservation.lease, reply: 'must not commit' }), { code: 'session_not_found' });
  } finally { pg.sql(`INSERT INTO nucleo_private.memberships VALUES('${A.userId}','${A.tenantId}')`); }
});
test('turn retention is bounded, and disabling store never downgrades an identified session', async () => {
  const body = message(); for (let i = 0; i < 8; i++) assert.equal((await handler()(request({ ...body, requestId: randomUUID(), message: `Synthetic ${i}` }))).status, 200);
  assert.equal((await handler()(request({ ...body, action: 'load' }))).body.turns.length, 12);
  let calls = 0;
  const off = createConversationHandler({ authenticate: async () => A, respond: async () => { calls++; return 'never'; } });
  assert.equal((await off(request(body))).status, 503); assert.equal(calls, 0);
});
