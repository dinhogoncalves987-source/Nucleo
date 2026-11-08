"""Fresh local PostgreSQL only. No remote connection, Docker or installation."""
from pathlib import Path
import subprocess, socket, os, json, time, re

root = Path(__file__).resolve().parents[1]
pg = Path('C:/Program Files/PostgreSQL/17/bin')
work = root / '.validation' / ('memory-pg-' + str(time.time_ns()))
work.mkdir(parents=True)
data = work / 'data'
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = str(sock.getsockname()[1])
env = os.environ.copy()
# Isolate PG client settings; no .env files or existing database credentials.
for key in ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']:
    env.pop(key, None)
env['PGCLIENTENCODING'] = 'UTF8'
env['PGPASSFILE'] = str(work / 'nonexistent-pgpass')
env['NUCLEO_TEST_PSQL'] = str(pg / 'psql.exe')
env['NUCLEO_TEST_PGPORT'] = port

def run(args, timeout=60, check=True):
    result = subprocess.run([str(a) for a in args], cwd=root, env=env, capture_output=True,
                            text=True, timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
    if check and result.returncode:
        raise RuntimeError((result.stdout + result.stderr)[-5000:])
    return result

psql = [pg / 'psql.exe', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres']
def sql(query): return run(psql + ['-c', query]).stdout.strip()
def start():
    subprocess.run([str(a) for a in [pg / 'pg_ctl.exe', '-D', data, '-l', work / 'postgres.log', '-o',
         f'-h 127.0.0.1 -p {port} -c shared_buffers=16MB -c max_connections=12 -c log_statement=none', '-w', 'start']],
         cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
def stop(): run([pg / 'pg_ctl.exe', '-D', data, '-m', 'fast', '-w', 'stop'])

started = False
try:
    run([pg / 'initdb.exe', '-D', data, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale'])
    started = True; start()
    print("Synthetic PostgreSQL ready", flush=True)
    migration = next((root / 'supabase/migrations').glob('*_james_scoped_memory.sql'))
    rejected = run(psql + ['-f', migration], check=False)
    assert rejected.returncode != 0 and 'missing identity baseline' in rejected.stderr
    assert sql("select to_regnamespace('nucleo_private') is null") == 't'
    run(psql + ['-f', root / 'tests/memory-fixture.sql'])
    run(psql + ['-f', migration])
    assert sql('select count(*) from nucleo_private.memberships') == '0'
    run(psql + ['-f', root / 'tests/memory-provision-fixture.sql'])
    repeated = run(psql + ['-f', migration], check=False)
    assert repeated.returncode != 0 and 'already installed' in repeated.stderr
    print('Migration and refusal checks passed', flush=True)
    result = run(['node', '--test', 'tests/conversation.test.mjs', 'tests/memory-postgres.test.mjs'], timeout=120)
    print(result.stdout)
    (work / 'test-results.txt').write_text(result.stdout + result.stderr, encoding='utf-8')
    concurrency = run(['node', '--test', 'tests/sql-concurrency.test.mjs'], timeout=45)
    print(concurrency.stdout)
    before = sql("select md5(string_agg(row_to_json(s)::text,'|' order by id)) from nucleo_private.sessions s")
    receipts_before = sql("select md5(string_agg(row_to_json(r)::text,'|' order by session_id,id)) from nucleo_private.requests r")
    assert int(sql('select count(*) from nucleo_private.sessions where jsonb_array_length(turns)>0')) > 0
    stop(); started = False
    started = True; start()
    print("Synthetic PostgreSQL ready", flush=True)
    after = sql("select md5(string_agg(row_to_json(s)::text,'|' order by id)) from nucleo_private.sessions s")
    assert before == after, 'restart lost durable sessions'
    assert receipts_before == sql("select md5(string_agg(row_to_json(r)::text,'|' order by session_id,id)) from nucleo_private.requests r"), 'restart lost receipts'
    restart_tests = run(['node', '--test', 'tests/receipts-after-restart.test.mjs', 'tests/sql-concurrency.test.mjs'], timeout=45)
    print(restart_tests.stdout)
    summary = {'result': 'passed', 'tests': int(re.search(r'tests (\d+)', result.stdout).group(1)), 'migration_missing_baseline_rejected': True,
               'migration_reapply_rejected': True, 'postgres_restart_preserved_sessions': True,
               'postgres_restart_preserved_receipts': True, 'sql_concurrency_tests_before_restart': 2,
               'sql_concurrency_and_replay_tests_after_restart': 3,
               'postgres': '17 synthetic fresh cluster on loopback', 'real_openai': False,
               'real_supabase_auth_or_postgrest': False, 'remote_changes': False}
    (root / '.validation/memory-result.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary))
finally:
    if started:
        status = run([pg / 'pg_ctl.exe', '-D', data, 'status'], check=False)
        if status.returncode == 0: stop()
