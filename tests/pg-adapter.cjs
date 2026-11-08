'use strict';
const { execFileSync } = require('node:child_process');
// Test-only adapter: exact same RPC executed in PostgreSQL, no PostgREST or network provider.
function sql(query, role = 'service_role') {
  if (!process.env.NUCLEO_TEST_PSQL || !process.env.NUCLEO_TEST_PGPORT) throw Error('isolated test database required');
  return execFileSync(process.env.NUCLEO_TEST_PSQL, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
    '-p', process.env.NUCLEO_TEST_PGPORT, '-U', 'postgres', '-d', 'postgres', '-f', '-'],
  { input: Buffer.from(`SET ROLE ${role}; ${query}`, 'utf8'), env: { ...process.env, PGCLIENTENCODING: 'UTF8' }, encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function literal(value) { return value == null ? 'NULL' : typeof value === 'boolean' ? String(value) : `'${String(value).replaceAll("'", "''")}'`; }
const db = { async rpc(name, args) {
  if (name !== 'nucleo_memory_v1') throw Error('unexpected RPC');
  const keys = ['p_action','p_user','p_tenant','p_session','p_contact','p_request','p_message','p_reply','p_lease','p_safe_failure'];
  try { return { data: JSON.parse(sql(`SELECT public.nucleo_memory_v1(${keys.map(k => literal(args[k])).join(',')})`)), error: null }; }
  catch { return { data: null, error: { message: 'synthetic test database failure' } }; }
} };
module.exports = { db, sql, literal };
