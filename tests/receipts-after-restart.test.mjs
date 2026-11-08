import test from 'node:test';
import assert from 'node:assert/strict';
import pg from './pg-adapter.cjs';
import core from '../shared/james-conversation.cjs';
import memory from '../shared/james-memory.cjs';
test('completed and uncertain durable receipts still prevent re-generation after database restart', async () => {
  for (const status of ['completed','uncertain']) {
    const rows = JSON.parse(pg.sql(`SELECT coalesce(json_agg(t),'[]') FROM (SELECT r.*,s.user_id,s.tenant_id,s.contact_id FROM nucleo_private.requests r JOIN nucleo_private.sessions s ON s.id=r.session_id JOIN nucleo_private.memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id WHERE r.status='${status}' AND NOT s.closed AND s.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND s.contact_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' LIMIT 1) t`, 'postgres'));
    assert.equal(rows.length, 1); const r = rows[0]; let calls = 0;
    const handle = core.createConversationHandler({ authenticate: async () => ({ userId: r.user_id, tenantId: r.tenant_id }), memory: async () => memory.createSupabaseMemoryStore(pg.db), respond: async () => { calls++; return 'must not generate'; } });
    const result = await handle({ method: 'POST', body: { sessionId: r.session_id, requestId: r.id, contactId: r.contact_id, message: r.message } });
    if (status === 'completed') { assert.equal(result.body.replayed, true); assert.equal(result.body.reply, r.reply); }
    else assert.equal(result.body.code, 'request_uncertain');
    assert.equal(calls, 0);
  }
});
