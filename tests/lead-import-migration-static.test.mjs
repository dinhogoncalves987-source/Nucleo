import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/20261108031932_lead_import_atomic_v1.sql', import.meta.url), 'utf8');
test('migration is transactional and refuses absent baseline / reapply', () => {
 assert.match(sql, /BEGIN;/); assert.match(sql, /COMMIT;/);
 assert.match(sql, /lead_import_missing_baseline/); assert.match(sql, /lead_import_already_installed/);
});
test('private tables use RLS and deny client writes', () => {
 for (const table of ['receipts', 'provenance']) assert.match(sql, new RegExp(`ALTER TABLE nucleo_intake\\.${table} ENABLE ROW LEVEL SECURITY`));
 assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA nucleo_intake FROM PUBLIC, anon, authenticated/);
});
test('identity comes from auth uid and locked profile, not metadata', () => {
 assert.match(sql, /actor uuid := auth.uid\(\)/); assert.match(sql, /is_anonymous/);
 assert.match(sql, /tenant IS DISTINCT FROM p_expected_tenant/); assert.match(sql, /FOR SHARE/);
});
test('legacy is not rewritten or forced into a unique phone index', () => {
 assert.doesNotMatch(sql, /(?:UPDATE|DELETE FROM|ALTER TABLE) public\.leads/i);
 assert.doesNotMatch(sql, /CREATE UNIQUE INDEX/i);
 assert.match(sql, /LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE/);
});
test('replay compares full payload and returns persisted response', () => {
 assert.match(sql, /pg_advisory_xact_lock/); assert.match(sql, /previous.source IS DISTINCT FROM p_source/);
 assert.match(sql, /previous.contacts IS DISTINCT FROM p_contacts/); assert.match(sql, /RETURN previous.response/);
 assert.match(sql, /public.nucleo_get_lead_import_v1/);
});
test('fixed safe states and no exception swallowing', () => {
 assert.match(sql, /'csv','new','pending'/); assert.match(sql, /CHECK\(whatsapp='unknown'\)/);
 assert.match(sql, /CHECK\(activity='unknown'\)/); assert.match(sql, /CHECK\(contact_permission='not_established'\)/);
 assert.doesNotMatch(sql, /EXCEPTION\s+WHEN/i);
});
