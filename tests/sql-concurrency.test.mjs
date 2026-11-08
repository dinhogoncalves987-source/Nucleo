import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from './pg-adapter.cjs';
const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenant = '11111111-1111-4111-8111-111111111111';
const contact = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function connection() {
  const child = spawn(process.env.NUCLEO_TEST_PSQL, ['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',process.env.NUCLEO_TEST_PGPORT,'-U','postgres','-d','postgres','-f','-'], { windowsHide: true, env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });
  let out = '', err = ''; child.stdout.on('data', b => out += b.toString()); child.stderr.on('data', b => err += b.toString());
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve(out) : reject(Error(err))); });
  done.catch(() => {});
  return { child, done, output: () => out };
}
async function until(check) {
  const end = Date.now() + 8000;
  while (!check()) { if (Date.now() > end) throw Error('SQL barrier timed out'); await new Promise(r => setTimeout(r, 15)); }
}
test('two real SQL connections contend on same session, before/after restart', async () => {
  const key = 184716; const holder = connection(); const workers = [];
  try {
    holder.child.stdin.write(`SELECT pg_advisory_lock(${key}); SELECT 'READY';\n`);
    await until(() => holder.output().includes('READY'));
    const session = randomUUID();
    for (let i = 0; i < 2; i++) {
      const worker = connection(); workers.push(worker);
      worker.child.stdin.end(`BEGIN; SELECT pg_advisory_xact_lock_shared(${key}); SET ROLE service_role; SELECT public.nucleo_memory_v1('begin','${user}','${tenant}','${session}','${contact}','${randomUUID()}','Synthetic concurrent request'); COMMIT;\n`);
    }
    await until(() => pg.sql(`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=${key} AND NOT granted`, 'postgres') === '2');
    holder.child.stdin.end(`SELECT pg_advisory_unlock(${key});\n`); await holder.done;
    const results = (await Promise.all(workers.map(w => w.done))).map(out => JSON.parse(out.split(/\r?\n/).find(line => line.startsWith('{'))));
    assert.equal(results.filter(r => r.state === 'reserved').length, 1);
    assert.equal(results.filter(r => r.code === 'request_busy').length, 1);
    assert.equal(pg.sql(`SELECT count(*) FROM nucleo_private.requests WHERE session_id='${session}'`, 'postgres'), '1');
  } finally { for (const c of [holder,...workers]) if (c.child.exitCode === null) c.child.kill(); }
});

test('legacy delete waits for competing SQL row lock then fails without deleting receipts', async () => {
  const holder = connection(); const worker = connection();
  try {
    holder.child.stdin.write(`BEGIN; SELECT id FROM public.contacts WHERE id='${contact}' FOR SHARE; SELECT 'READY';\n`);
    await until(() => holder.output().includes('READY'));
    worker.child.stdin.end(`SET application_name='nucleo_delete_race'; SET ROLE authenticated; DELETE FROM public.contacts WHERE id='${contact}';\n`);
    await until(() => pg.sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='nucleo_delete_race' AND wait_event_type='Lock'", 'postgres') === '1');
    holder.child.stdin.end('COMMIT;\n'); await holder.done;
    await assert.rejects(worker.done, /foreign key constraint/);
    assert.equal(pg.sql(`SELECT count(*) FROM public.contacts WHERE id='${contact}'`, 'postgres'), '1');
  } finally { for (const c of [holder,worker]) if (c.child.exitCode === null) c.child.kill(); }
});
