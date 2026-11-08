import test from 'node:test';
import assert from 'node:assert/strict';
import { accessJamesMemory } from '../src/lib/jamesConversation.ts';
import core from '../shared/james-conversation.cjs';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('disabled server refuses close rather than claiming success', async () => {
  let calls = 0;
  const h = core.createConversationHandler({ authenticate: async () => ({ userId: id, tenantId: id }), memory: async () => null, respond: async () => { calls++; } });
  const result = await h({ method: 'POST', body: { action: 'close', sessionId: id } });
  assert.equal(result.status, 503); assert.equal(result.body.code, 'memory_unavailable'); assert.equal(calls, 0);
});
test('client rejects disabled/ambiguous close and caller retains persistent pointer', async () => {
  for (const [status, body] of [[200,{ memory: 'disabled', turns: [] }],[200,{ memory: 'persistent', turns: [] }],[503,{ code: 'memory_unavailable' }],[409,{ code: 'request_busy' }],[404,{ code: 'session_not_found' }]]) {
    let pointer = id;
    const close = async () => { await accessJamesMemory(async () => new Response(JSON.stringify(body), { status }), 'close', pointer, null, new AbortController().signal); pointer = 'replacement'; };
    await assert.rejects(close); assert.equal(pointer, id);
  }
});
test('confirmed persistent close permits replacement', async () => {
  const result = await accessJamesMemory(async () => new Response(JSON.stringify({ memory: 'persistent', state: 'closed' })), 'close', id, null, new AbortController().signal);
  assert.equal(result.state, 'closed');
});
