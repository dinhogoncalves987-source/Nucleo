import test from 'node:test';
import assert from 'node:assert/strict';
import { createJamesVoiceContext, cancelJamesRecognition, voiceCallbackIsCurrent } from '../src/lib/jamesVoiceContext.ts';
function recognition() {
  return { onresult: null, onerror: null, onend: null, aborted: 0, stopped: 0,
    abort() { this.aborted++; this.onresult?.('event during abort'); this.onend?.(); },
    stop() { this.stopped++; } };
}
test('context switch cancels recognition and a previously queued result cannot submit into loaded context', () => {
  const context = createJamesVoiceContext(); context.bind('companyA/userA/contactA'); const origin = context.snapshot();
  const old = recognition(); let active = old; const submitted = [];
  old.onresult = text => { if (voiceCallbackIsCurrent(context, origin, old, active)) submitted.push(text); };
  const queuedResult = old.onresult;
  context.bind('companyB/userB/contactB'); context.invalidate(); cancelJamesRecognition(active); active = null;
  active = recognition(); // new context has finished loading and can accept valid voice
  queuedResult('late old context');
  assert.deepEqual(submitted, []); assert.equal(old.aborted, 1); assert.equal(old.onresult, null);
});
test('valid same-context voice submits once and stopped recognizer cannot submit twice', () => {
  const context = createJamesVoiceContext(); context.bind('synthetic-scope'); const origin = context.snapshot();
  const current = recognition(); let active = current; const submitted = [];
  current.onresult = text => {
    if (!voiceCallbackIsCurrent(context, origin, current, active)) return;
    active = null; cancelJamesRecognition(current); submitted.push(text);
  };
  const result = current.onresult; result('valid synthetic request'); result('duplicate');
  assert.deepEqual(submitted, ['valid synthetic request']);
});
test('late error/end from old recognizer cannot clear the new recognizer in same context', () => {
  const context = createJamesVoiceContext(); context.bind('scope'); const origin = context.snapshot();
  const old = recognition(); let active = old;
  const lateEnd = () => { if (voiceCallbackIsCurrent(context, origin, old, active)) active = null; };
  cancelJamesRecognition(old); const next = recognition(); active = next; lateEnd();
  assert.equal(active, next); assert.equal(voiceCallbackIsCurrent(context, origin, next, active), true);
});
test('resume/new-session invalidates scheduled callbacks even with unchanged scope key', () => {
  const context = createJamesVoiceContext(); context.bind('same-scope'); const origin = context.snapshot();
  context.invalidate(); context.bind('same-scope');
  assert.equal(context.current(origin), false); assert.equal(context.current(context.snapshot()), true);
});
test('cancel removes all handlers before abort and falls back to stop if abort throws', () => {
  const old = recognition(); let events = 0;
  old.onresult = old.onerror = old.onend = () => events++;
  cancelJamesRecognition(old); assert.equal(events, 0); assert.equal(old.aborted, 1);
  const fallback = recognition(); fallback.abort = () => { throw Error('unsupported abort'); };
  cancelJamesRecognition(fallback); assert.equal(fallback.stopped, 1);
  assert.doesNotThrow(() => cancelJamesRecognition(null));
});
