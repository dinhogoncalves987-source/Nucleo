import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionJamesWakeState } from '../src/lib/jamesWakeTransition.ts';
import { startJamesWakeListener } from '../src/lib/jamesWakeListener.ts';
import { createJamesVoiceContext, advanceJamesVoiceContext, voiceCallbackIsCurrent } from '../src/lib/jamesVoiceContext.ts';
function fixture() {
  const timers = new Map(); let id = 0; const instances = []; let current = true, listening = true, wakes = 0;
  const clock = { schedule(fn, delay) { const key = ++id; timers.set(key, { fn, delay }); return key; }, cancel(key) { timers.delete(key); } };
  const options = {
    clock, isCurrent: () => current, shouldListen: () => listening, onWake: () => wakes++,
    createRecognition() {
      const r = { lang: '', continuous: false, interimResults: false, onresult: null, onend: null, onerror: null, active: false, aborts: 0,
        start() { this.active = true; assert.equal(instances.filter(x => x.active).length, 1); },
        abort() { this.active = false; this.aborts++; this.onend?.(); }, stop() { this.active = false; } };
      instances.push(r); return r;
    },
  };
  function tick() { assert.equal(timers.size, 1); const [key, value] = timers.entries().next().value; timers.delete(key); value.fn(); }
  return { timers, instances, options, tick, invalidate() { current = false; }, pause() { listening = false; }, resume() { listening = true; }, wakes: () => wakes };
}
test('error followed by queued end owns a single restart and old callbacks cannot spawn another recognizer', () => {
  const f = fixture(); const stop = startJamesWakeListener(f.options); f.tick(); const old = f.instances[0];
  const error = old.onerror, end = old.onend, result = old.onresult;
  error(); end(); assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].delay, 1200);
  f.tick(); assert.equal(f.instances.length, 2); assert.equal(old.active, false);
  error(); end(); result({ results: [[{ transcript: 'James' }]] });
  assert.equal(f.timers.size, 0); assert.equal(f.wakes(), 0); stop();
  assert.ok(f.instances.every(r => !r.active)); assert.equal(f.timers.size, 0);
});
test('end followed by queued error also has one restart', () => {
  const f = fixture(); const stop = startJamesWakeListener(f.options); f.tick(); const r = f.instances[0];
  const error = r.onerror; r.onend(); error(); assert.equal(f.timers.size, 1); f.tick();
  assert.equal(f.instances.length, 2); stop();
});
test('context change and unmount cancel recognizer, restart timer and already queued timer callbacks', () => {
  const f = fixture(); const stop = startJamesWakeListener(f.options); f.tick(); const r = f.instances[0]; const end = r.onend;
  r.onerror(); const queued = [...f.timers.values()][0].fn;
  f.invalidate(); stop(); stop(); queued(); end();
  assert.equal(f.timers.size, 0); assert.equal(f.instances.length, 1); assert.equal(r.active, false);
  const g = fixture(); const unmount = startJamesWakeListener(g.options); g.tick(); const late = g.instances[0].onresult;
  unmount(); late({ results: [[{ transcript: 'James' }]] });
  assert.equal(g.wakes(), 0); assert.equal(g.instances[0].active, false); assert.equal(g.timers.size, 0);
});
test('valid wake fires once; busy suspension has no timer and resumes explicitly', () => {
  const f = fixture(); const stop = startJamesWakeListener(f.options); f.tick(); const result = f.instances[0].onresult;
  result({ results: [[{ transcript: 'James' }]] }); result({ results: [[{ transcript: 'James' }]] });
  assert.equal(f.wakes(), 1); assert.equal(f.instances[0].active, false); f.pause(); stop.suspend();
  assert.equal(f.instances.length, 1); assert.equal(f.timers.size, 0);
  stop.resume(); assert.equal(f.timers.size, 0);
  f.resume(); stop.resume(); stop.resume(); assert.equal(f.timers.size, 1); f.tick();
  assert.equal(f.instances.length, 2); stop(); assert.equal(f.timers.size, 0);
});
test('empty temporary New explicitly requests render; fresh voice and wake work with unchanged empty fields', () => {
  const context = createJamesVoiceContext(); context.bind('scope'); const oldOrigin = context.snapshot();
  const fields = { draft: '', reply: '', error: '' }; let renderRequests = 0;
  advanceJamesVoiceContext(context, () => renderRequests++);
  assert.equal(renderRequests, 1); assert.deepEqual(fields, { draft: '', reply: '', error: '' });
  assert.equal(context.current(oldOrigin), false);
  // The explicit React state increment schedules this next render, even when fields are unchanged.
  const renderedOrigin = context.snapshot(); const recognition = {};
  assert.equal(voiceCallbackIsCurrent(context, renderedOrigin, recognition, recognition), true);
  const f = fixture(); const stop = startJamesWakeListener({ ...f.options, isCurrent: () => context.current(renderedOrigin) });
  f.tick(); f.instances[0].onresult({ results: [[{ transcript: 'James' }]] }); assert.equal(f.wakes(), 1); stop();
});

for (const trigger of ['opening', 'thinking']) {
  test(`active wake -> ${trigger} suspends before command/text transition and resumes only in nucleus`, () => {
    const f = fixture(); const controller = startJamesWakeListener(f.options); f.tick();
    const old = f.instances[0]; const lateResult = old.onresult, lateEnd = old.onend;
    let committed = false;
    transitionJamesWakeState(trigger, controller, () => {
      assert.equal(old.active, false); assert.equal(f.timers.size, 0);
      committed = true; f.pause();
    });
    assert.equal(committed, true);
    // Models command recognition start after the actual transition helper used by James.
    const command = f.options.createRecognition(); command.start();
    lateResult({ results: [[{ transcript: 'James' }]] }); lateEnd();
    assert.equal(f.wakes(), 0); assert.equal(f.timers.size, 0);
    controller.resume(); assert.equal(f.timers.size, 0);
    command.abort();
    transitionJamesWakeState('nucleus', controller, () => f.resume());
    assert.equal(f.timers.size, 1); f.tick();
    assert.equal(f.instances.filter(r => r.active).length, 1);
    controller(); assert.ok(f.instances.every(r => !r.active)); assert.equal(f.timers.size, 0);
    controller.resume(); assert.equal(f.timers.size, 0);
  });
}
test('suspend invalidates a queued restart timer before it can create a command competitor', () => {
  const f = fixture(); const controller = startJamesWakeListener(f.options); f.tick();
  f.instances[0].onerror(); const queued = [...f.timers.values()][0].fn;
  transitionJamesWakeState('opening', controller, () => f.pause()); queued();
  assert.equal(f.instances.length, 1); assert.equal(f.timers.size, 0); controller();
});
