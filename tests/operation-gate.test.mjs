import test from 'node:test';
import assert from 'node:assert/strict';
import { createJamesOperationGate } from '../src/lib/jamesOperationGate.ts';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('loading admits neither New, Resume nor submit even before React renders disabled controls', () => {
  const gate = createJamesOperationGate(); gate.bind('company/user/contact');
  const load = gate.begin();
  for (const action of ['new', 'resume', 'submit']) assert.equal(gate.begin(), null, action);
  gate.finish(load); assert.notEqual(gate.begin(), null);
});
test('late load after context change cannot update turns or persist a different session pointer', async () => {
  const gate = createJamesOperationGate(); gate.bind('scopeA');
  const response = deferred(); const token = gate.begin(); const loadedSession = 'sessionA';
  let session = loadedSession; const writes = [];
  const load = response.promise.then(() => { if (gate.current(token)) writes.push(loadedSession); });
  gate.bind('scopeB'); session = 'sessionB'; const next = gate.begin();
  response.resolve(); await load;
  assert.equal(session, 'sessionB'); assert.deepEqual(writes, []); assert.ok(gate.current(next));
});
test('late close/error/finally cannot reset new context or unlock its operation', async () => {
  const gate = createJamesOperationGate(); gate.bind('A'); const close = gate.begin();
  const response = deferred(); let resets = 0;
  const work = response.promise.then(() => { if (gate.current(close)) resets++; }).finally(() => gate.finish(close));
  gate.invalidate(); gate.bind('B'); const load = gate.begin(); response.resolve(); await work;
  assert.equal(resets, 0); assert.ok(gate.current(load)); assert.equal(gate.begin(), null);
});
test('double New and Resume while closing cannot start overlapping operations', () => {
  const gate = createJamesOperationGate(); const close = gate.begin();
  assert.equal(gate.begin(), null); assert.equal(gate.begin(), null);
  gate.finish(close); const resume = gate.begin(); assert.notEqual(resume, close);
  assert.equal(gate.current(close), false);
});
test('late rejected load cannot replace a newer successful context with an error', async () => {
  const gate = createJamesOperationGate(); gate.bind('old'); const old = gate.begin();
  const response = deferred(); let error = '';
  const work = response.promise.then(() => { throw Error('late failure'); }).catch(e => { if (gate.current(old)) error = e.message; }).finally(() => gate.finish(old));
  gate.bind('new'); const current = gate.begin(); response.resolve(); await work;
  assert.equal(error, ''); assert.ok(gate.current(current));
});
test('late provider reply cannot append turns or speak in the next context', async () => {
  const gate = createJamesOperationGate(); gate.bind('old'); const old = gate.begin();
  const response = deferred(); const turns = []; let spoken = 0;
  const work = response.promise.then(reply => { if (!gate.current(old)) return; turns.push(reply); spoken++; });
  gate.bind('new'); gate.begin(); response.resolve('old scoped reply'); await work;
  assert.deepEqual(turns, []); assert.equal(spoken, 0);
});
