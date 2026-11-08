import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberSession } from '../src/lib/jamesSessionPointer.ts';
const key = 'synthetic-company:synthetic-user:synthetic-contact';
function storage() { const map = new Map(); return { setItem: (k, v) => map.set(k, v), getItem: k => map.get(k) ?? null }; }
test('temporary New conversation then reload remains temporary with no saved pointer', async () => {
  const disk = storage();
  rememberSession(disk, key, 'temporary-session', 'disabled');
  const reload = await import('../src/lib/jamesSessionPointer.ts?temporary-reload');
  assert.equal(disk.getItem(key), null);
  assert.doesNotThrow(() => reload.assertMemoryMode(disk.getItem(key), 'disabled'));
});
test('persistent New conversation then reload keeps new pointer and disabled-server guard', async () => {
  const disk = storage(); rememberSession(disk, key, 'old-session', 'persistent');
  rememberSession(disk, key, 'new-session', 'persistent');
  const reload = await import('../src/lib/jamesSessionPointer.ts?persistent-reload');
  assert.equal(disk.getItem(key), 'new-session');
  assert.doesNotThrow(() => reload.assertMemoryMode(disk.getItem(key), 'persistent'));
  assert.throws(() => reload.assertMemoryMode(disk.getItem(key), 'disabled'));
});
test('loading and storage failures do not manufacture a pointer', () => {
  const disk = storage(); rememberSession(disk, key, 'loading-session', 'loading');
  assert.equal(disk.getItem(key), null);
  assert.doesNotThrow(() => rememberSession({ setItem() { throw Error('storage blocked'); } }, key, 'session', 'persistent'));
});
