// Independent adversarial review. Synthetic identities, receipts and transports only.
// This is a deterministic hooks/JSX harness, not a browser, live Supabase or RLS test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, Module } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
// Existing packages only; never installs dependencies.
const original = path.resolve(process.env.NUCLEO_TEST_DEPS_ROOT || root)
assert.deepEqual(readFileSync(path.join(root, 'package-lock.json')), readFileSync(path.join(original, 'package-lock.json')), 'Dependency lock must match the approved read-only source')
const deps = createRequire(path.join(original, 'package.json'))
const ts = deps('typescript')
const files = ['src/lib/tenant-directory.ts', 'src/lib/tenant-operations.ts', 'src/lib/use-tenant-administration.ts', 'src/pages/AdminProjects.tsx', 'src/pages/Estabelecimentos.tsx']
const digest = file => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')
const reviewed = new Map(files.map(file => [file, digest(file)]))
globalThis.fetch = async () => { throw Error('Network is prohibited in this independent review') }

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const row = (id = A, extra = {}) => ({ id, name: 'Synthetic ' + id.slice(0, 1), created_at: '2026-11-08T01:00:00.000Z', phone: null, address: null, segment: 'salao', status: 'pendente', ...extra })
const identity = (tenant = A, actor = ACTOR) => ({ tenant: { id: tenant }, user: { id: actor, tenant_id: tenant, role: 'superadmin' }, session: { user: { id: actor, is_anonymous: false }, access_token: 'synthetic-only-' + actor }, isAuthenticated: true, loading: false })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))

function hooks(fn) {
  const slots = [], effects = []
  let cursor = 0, dirty = true, alive = true, value
  const api = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], next => { if (alive) { slots[i] = typeof next === 'function' ? next(slots[i]) : next; dirty = true } }]
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(callback, deps) { const i = cursor++; if (!slots[i] || !sameDeps(slots[i].deps, deps)) slots[i] = { deps, callback }; return slots[i].callback },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || !sameDeps(slots[i].deps, deps)) slots[i] = { deps, value: factory() }; return slots[i].value },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || !sameDeps(slots[i].deps, deps)) effects.push({ i, effect, deps }) },
  }
  api.useLayoutEffect = api.useEffect
  const render = () => { cursor = 0; dirty = false; value = fn(api); return value }
  const flush = async () => {
    for (let i = 0; i < 20; i++) {
      if (dirty) render()
      for (const task of effects.splice(0)) {
        slots[task.i]?.cleanup?.()
        slots[task.i] = { deps: task.deps, cleanup: task.effect() }
      }
      await tick()
      if (!dirty && effects.length === 0) return value
    }
    throw Error('Hooks did not settle')
  }
  return { api, render, flush, get value() { return value }, rerender() { dirty = true; return render() }, dispose() { alive = false; for (const slot of slots) slot?.cleanup?.() } }
}

function loader({ context = identity(), transport } = {}) {
  const cache = new Map()
  let react = null
  const allowed = new Set(files.map(file => path.resolve(root, file)))
  const jsx = (type, props, key) => ({ type, props: props || {}, key })
  const state = { context, setHooks(value) { react = value } }
  const supabase = transport || { from() { throw Error('Unexpected Supabase access') } }
  function load(file) {
    file = path.resolve(root, file)
    assert.ok(allowed.has(file), 'Unapproved source: ' + file)
    if (cache.has(file)) return cache.get(file).exports
    const m = new Module(file); m.filename = file; cache.set(file, m)
    m.require = name => {
      if (name === 'react') return new Proxy({}, { get: (_, field) => react?.[field] })
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (name === 'lucide-react') return new Proxy({}, { get: (_, field) => String(field) })
      if (name.endsWith('/AppLayout')) return { __esModule: true, default: 'AppLayout' }
      if (name.endsWith('/tenant-context')) return { useTenant: () => state.context }
      if (name.endsWith('/supabase')) return { supabase }
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name.endsWith('.ts') ? name : name + '.ts'))
      throw Error('Unapproved dependency: ' + name)
    }
    m._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file)
    return m.exports
  }
  return { ...state, get context() { return state.context }, set context(v) { state.context = v }, load }
}

function descendants(node) {
  if (node == null || typeof node === 'boolean') return []
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (typeof node !== 'object') return [node]
  return [node, ...descendants(node.props?.children)]
}
const textOf = node => descendants(node).filter(x => typeof x === 'string' || typeof x === 'number').join(' ').trim()
const find = (tree, predicate) => descendants(tree).find(x => x && typeof x === 'object' && predicate(x))
const findAll = (tree, predicate) => descendants(tree).filter(x => x && typeof x === 'object' && predicate(x))

test('independent: the versioned tenant policy grants SELECT only, without metadata/superadmin override', () => {
  const sql = readFileSync(path.join(root, 'supabase/migrations/20260817153403_secure_demo_rls.sql'), 'utf8')
  assert.match(sql, /CREATE POLICY tenant_own_select ON public\.tenants FOR SELECT TO authenticated/)
  assert.match(sql, /USING \(id = \(SELECT tenant_id FROM public\.profiles WHERE id = \(SELECT auth\.uid\(\)\)\)\)/)
  const own = sql.slice(sql.indexOf('CREATE POLICY tenant_own_select'), sql.indexOf('DO $tenant_tables$'))
  assert.doesNotMatch(own, /user_metadata|superadmin|FOR ALL|FOR INSERT|FOR UPDATE|FOR DELETE/)
})

const directory = loader().load('src/lib/tenant-directory.ts')
const operations = loader().load('src/lib/tenant-operations.ts')
const scope = { tenantId: A, actorId: ACTOR }
const request = (kind = 'update', details = true) => ({ ...scope, kind, targetId: A, details, ...(kind === 'create' ? { values: { name: 'New synthetic' } } : { before: row(A), ...(kind === 'update' ? { values: { name: 'Updated synthetic' } } : {}) }) })
const success = req => ({ data: [{ ...row(req.targetId), ...req.before, ...req.values }], error: null })
const rejectAs = (outcome, settled) => error => error.outcome === outcome && (settled === undefined || error.settled === settled)

function browser() {
  const map = new Map(), events = new EventTarget(), originals = { window: Object.getOwnPropertyDescriptor(globalThis, 'window'), navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') }
  let held = false, confirmResult = true
  const confirmations = []
  const storage = { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => { map.set(key, String(value)) }, removeItem: key => { map.delete(key) } }
  const locks = { async request(name, opts, callback) {
    assert.equal(name, operations.TENANT_MUTATION_KEY); assert.deepEqual(opts, { mode: 'exclusive', ifAvailable: true })
    if (held) return callback(null)
    held = true
    try { return await callback({ name }) } finally { held = false }
  } }
  const win = { localStorage: storage, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), confirm(text) { confirmations.push(text); return confirmResult } }
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true })
  Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true })
  return { storage, locks, map, win, confirmations, setConfirm(value) { confirmResult = value }, restore() { for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } } }
}

function transport(initialRows = [row()]) {
  let rows = structuredClone(initialRows)
  const calls = [], replies = [], reads = [], writes = []
  const source = { from(table) {
    assert.equal(table, 'tenants')
    const query = { table, kind: 'read', filters: [], selected: null, retry: null, values: null, order: null, headers: {} }
    const chain = {
      select(columns, options) { query.selected = { columns, options }; return this },
      order(column, options) { query.order = { column, options }; return this },
      retry(value) { query.retry = value; return this },
      setHeader(name, value) { query.headers[name] = value; return this },
      abortSignal(signal) { query.signal = signal; return this },
      insert(values) { query.kind = 'create'; query.values = structuredClone(values); return this },
      update(values) { query.kind = 'update'; query.values = structuredClone(values); return this },
      delete() { query.kind = 'delete'; return this },
      eq(field, value) { query.filters.push(['eq', field, value]); return this },
      is(field, value) { query.filters.push(['is', field, value]); return this },
      then(yes, no) {
        calls.push(query); (query.kind === 'read' ? reads : writes).push(query)
        assert.equal(query.retry, false, 'Each dispatched read/write must disable transport retry')
        const next = replies.shift()
        let answer
        if (next) answer = next(query)
        else if (query.kind === 'read') answer = { data: structuredClone(rows), error: null, count: rows.length }
        else {
          const matching = rows.filter(r => query.filters.every(([, field, value]) => r[field] === value))
          const result = query.kind === 'create' ? [{ ...row(query.values.id), ...query.values }] : query.kind === 'update' ? matching.map(r => ({ ...r, ...query.values })) : matching
          if (query.kind === 'create') rows.push(...result)
          else if (query.kind === 'delete') rows = rows.filter(r => !matching.includes(r))
          else rows = rows.map(r => result.find(changed => changed.id === r.id) || r)
          answer = { data: structuredClone(result), error: null }
        }
        return Promise.resolve(answer).then(yes, no)
      },
    }
    return chain
  } }
  return { source, calls, replies, reads, writes, setRows(value) { rows = structuredClone(value) } }
}

function mountHook(t, context = identity(), details = true) {
  const l = loader({ context, transport: t.source })
  const fn = l.load('src/lib/use-tenant-administration.ts').useTenantAdministration
  const h = hooks(api => { l.setHooks(api); return fn(details) })
  return { l, h }
}
function mountPage(filename, t, context = identity()) {
  const l = loader({ context, transport: t.source }), parent = l.load(filename).default
  let descriptor, h
  const change = async next => {
    l.context = next
    const following = parent()
    if (!descriptor || descriptor.key !== following.key || descriptor.type !== following.type) {
      h?.dispose()
      h = hooks(api => { l.setHooks(api); return following.type(following.props) })
    } else h.rerender()
    descriptor = following
    await h.flush()
  }
  return { l, change, get h() { return h }, get tree() { return h.value }, dispose() { h?.dispose() } }
}

test('independent: actor/tenant agreement is required; frontend role and user metadata cannot supply Auth', () => {
  assert.deepEqual(directory.tenantScope(identity()), scope)
  for (const change of [{ session: null }, { tenant: null }, { user: null }, { loading: true }, { isAuthenticated: false }, { session: { user: { id: OTHER } } }, { user: { id: ACTOR, tenant_id: B, role: 'superadmin' } }]) assert.equal(directory.tenantScope({ ...identity(), ...change }), null)
  const bypass = { ...identity(), session: null, user_metadata: { role: 'superadmin', tenant_id: A } }
  assert.equal(directory.tenantScope(bypass), null)
  assert.notEqual(directory.tenantScopeKey(scope), directory.tenantScopeKey({ ...scope, actorId: OTHER }))
  assert.notEqual(directory.tenantScopeKey(scope), directory.tenantScopeKey({ ...scope, tenantId: B }))
})

test('independent: directory preserves server list scope, valid emptiness, exact count and unique IDs', async t => {
  const read = result => directory.readTenantDirectory({ scope, details: true, isCurrent: () => true, execute: async () => result })
  assert.deepEqual(await read({ data: [], error: null, count: 0 }), { items: [], total: 0 })
  assert.deepEqual(await read({ data: [row(A), row(B)], error: null, count: 2 }), { items: [row(A), row(B)], total: 2 })
  assert.deepEqual(await read({ data: [row()], error: null, count: null }), { items: [row()], total: null })
  for (const bad of [null, {}, { data: null, error: null, count: 0 }, { data: [row()], error: null, count: 0 }, { data: [row(), row()], error: null, count: 2 }, { data: [{ ...row(), status: 'invented' }], error: null, count: 1 }, { data: [{ ...row(), name: null }], error: null, count: 1 }]) await t.test('malformed ' + JSON.stringify(bad), () => assert.rejects(read(bad), error => error.kind === 'unavailable'))
  await assert.rejects(read({ data: [], error: { code: '42501' }, count: 0 }), error => error.kind === 'denied')
})

test('independent: latest read wins and synchronous throws/rejected promises are not empty success', async () => {
  const gate = directory.createTenantReadGate(), first = gate.begin(), pending = deferred()
  const older = directory.readTenantDirectory({ scope, details: true, isCurrent: first, execute: () => pending.promise })
  await tick(); const second = gate.begin()
  pending.resolve({ data: [row(B)], error: null, count: 1 })
  await assert.rejects(older, error => error.kind === 'stale'); assert.equal(second(), true)
  gate.cancel(); assert.equal(second(), false)
  for (const execute of [() => { throw Error('sync') }, () => Promise.reject(Error('async'))]) await assert.rejects(directory.readTenantDirectory({ scope, details: true, isCurrent: () => true, execute }), error => error.kind === 'unavailable')
})

test('independent: create/update/delete accept only the exact single receipt', async t => {
  for (const kind of ['create', 'update', 'delete']) {
    const req = request(kind)
    assert.deepEqual(await operations.mutateTenant({ ...req, isCurrent: () => true, execute: async () => success(req) }), success(req).data[0])
    const cases = [null, {}, { data: [], error: null }, { data: [success(req).data[0], success(req).data[0]], error: null }, { data: [{ ...success(req).data[0], id: B }], error: null }, { data: [{ ...success(req).data[0], name: 'different' }], error: null }, { data: [success(req).data[0]], error: undefined }]
    for (const [i, response] of cases.entries()) await t.test(kind + ' bad receipt ' + i, () => assert.rejects(operations.mutateTenant({ ...req, isCurrent: () => true, execute: async () => response }), rejectAs('uncertain', false)))
  }
})

test('independent: mutation errors distinguish confirmed rejection from unknown outcome', async t => {
  for (const code of ['42501', '23503', '23505', '22P02', 'P0001']) await t.test(code, () => assert.rejects(operations.mutateTenant({ ...request(), isCurrent: () => true, execute: async () => ({ error: { code }, data: null }) }), rejectAs('rejected', true)))
  for (const execute of [() => { throw Error('network') }, () => Promise.reject({ code: '42501' }), async () => ({ data: null, error: { code: '08006' } }), async () => ({ data: null, error: { code: '57014' } }), async () => ({ data: null, error: { message: 'permission denied', code: '' } })]) await assert.rejects(operations.mutateTenant({ ...request(), isCurrent: () => true, execute }), rejectAs('uncertain', false))
})

test('independent: contradictory error envelopes retain the uncertainty reservation', async tcase => {
  for (const response of [{ data: [row()], error: { code: '42501' } }, { data: null, error: { code: '23503' }, count: 1 }, { data: [], error: { code: '42501' } }, { data: null, error: { code: '42501' }, status: 200 }, { data: success(request()).data, error: null, count: 0 }, { data: success(request()).data, error: null, status: 403 }]) await tcase.test(JSON.stringify(response), async () => {
    const b = browser()
    try {
      await assert.rejects(operations.withTenantReservation({ ...scope, targetId: A, requestId: 'ambiguous-envelope', kind: 'update', storage: b.storage, locks: b.locks,
        work: () => operations.mutateTenant({ ...request(), isCurrent: () => true, execute: async () => response }),
      }), rejectAs('uncertain', false))
      assert.ok(b.storage.getItem(operations.TENANT_MUTATION_KEY), 'ambiguous response must not clear marker')
    } finally { b.restore() }
  })
})

test('independent: invalid requests and stale-before-dispatch never call transport', async () => {
  let calls = 0
  for (const change of [{ tenantId: '' }, { actorId: '' }, { targetId: B }, { before: undefined }, { values: { tenant_id: B } }, { values: { role: 'superadmin' } }, { values: {} }]) await assert.rejects(operations.mutateTenant({ ...request(), ...change, isCurrent: () => true, execute: () => { calls++; return Promise.resolve({}) } }), rejectAs('rejected', true))
  await assert.rejects(operations.mutateTenant({ ...request(), isCurrent: () => false, execute: () => { calls++; return Promise.resolve({}) } }), rejectAs('stale', true))
  let current = true
  const promise = operations.mutateTenant({ ...request(), isCurrent: () => current, execute: () => { calls++; return Promise.resolve({}) } })
  current = false
  await assert.rejects(promise, rejectAs('stale', true)); assert.equal(calls, 0)
})

test('independent: request snapshots cannot mutate during dispatch; late valid receipts stay stale', async () => {
  const req = request(), pending = deferred()
  let current = true, sent
  const p = operations.mutateTenant({ ...req, isCurrent: () => current, execute: op => { sent = structuredClone(op); op.values.name = 'transport tamper'; op.before.name = 'transport tamper'; return pending.promise } })
  req.values.name = 'caller tamper'; req.before.name = 'caller tamper'
  await tick(); assert.equal(sent.values.name, 'Updated synthetic'); assert.equal(sent.before.name, row().name)
  current = false; pending.resolve(success(sent))
  await assert.rejects(p, rejectAs('stale', true))
})

test('independent: read and mutation deadlines reject and late completion cannot undo them', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, timers = new Set()
  globalThis.setTimeout = (fn, ms) => { assert.equal(ms, 45000); timers.add(fn); return fn }
  globalThis.clearTimeout = fn => timers.delete(fn)
  try {
    for (const kind of ['read', 'write']) {
      const d = deferred(), options = { scope, details: true, isCurrent: () => true, execute: () => d.promise }
      const p = kind === 'read' ? directory.readTenantDirectory(options) : operations.mutateTenant({ ...request(), ...options })
      await tick(); assert.equal(timers.size, 1); [...timers][0]()
      await assert.rejects(p, error => kind === 'read' ? error.kind === 'unavailable' : rejectAs('uncertain', false)(error))
      d.resolve(kind === 'read' ? { ...success(request()), count: 1 } : success(request())); await tick(); assert.equal(timers.size, 0)
    }
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear }
})

test('independent: browser reservation blocks concurrent tabs and preserves unknown outcomes across actor/reload', async () => {
  const b = browser(), d = deferred(); let writes = 0
  const reserve = extra => operations.withTenantReservation({ ...scope, targetId: A, requestId: 'synthetic-request-a', kind: 'update', storage: b.storage, locks: b.locks, work: async () => { writes++; return d.promise }, ...extra })
  try {
    const p = reserve(); await tick()
    assert.equal(operations.readPendingTenantMutation(b.storage).actorId, ACTOR)
    await assert.rejects(reserve({ actorId: OTHER, tenantId: B, requestId: 'synthetic-request-b' }), rejectAs('busy', true)); assert.equal(writes, 1)
    d.reject(new operations.TenantMutationFailure('uncertain'))
    await assert.rejects(p, rejectAs('uncertain', false)); assert.ok(b.storage.getItem(operations.TENANT_MUTATION_KEY))
    const reloaded = loader().load('src/lib/tenant-operations.ts')
    await assert.rejects(reloaded.withTenantReservation({ ...scope, targetId: B, actorId: OTHER, kind: 'delete', requestId: 'reload', storage: b.storage, locks: b.locks, work: async () => { writes++ } }), error => error.outcome === 'busy')
    assert.equal(writes, 1)
    assert.deepEqual(Object.keys(JSON.parse(b.storage.getItem(operations.TENANT_MUTATION_KEY))).sort(), ['actorId', 'createdAt', 'kind', 'requestId', 'targetId', 'tenantId'].sort())
  } finally { b.restore() }
})

test('independent: reservation releases only its own settled marker; failures in locks/storage fail closed', async () => {
  const b = browser(); let calls = 0
  const base = { ...scope, targetId: A, requestId: 'synthetic', kind: 'update', storage: b.storage, locks: b.locks }
  try {
    assert.equal(await operations.withTenantReservation({ ...base, work: async () => { calls++; return 1 } }), 1)
    assert.equal(operations.readPendingTenantMutation(b.storage), null)
    await assert.rejects(operations.withTenantReservation({ ...base, work: async () => { throw new operations.TenantMutationFailure('rejected', true) } }), rejectAs('rejected', true))
    assert.equal(operations.readPendingTenantMutation(b.storage), null)
    for (const change of [{ locks: undefined }, { storage: { getItem() { throw Error('blocked storage') } } }, { storage: { ...b.storage, setItem() { throw Error('quota') } } }, { storage: { ...b.storage, setItem() {} } }]) await assert.rejects(operations.withTenantReservation({ ...base, ...change, work: async () => { calls++ } }), rejectAs('busy', true))
    assert.equal(calls, 1)
    b.storage.setItem(operations.TENANT_MUTATION_KEY, '{broken')
    await assert.rejects(operations.withTenantReservation({ ...base, work: async () => { calls++ } }), rejectAs('busy', true)); assert.equal(calls, 1)
  } finally { b.restore() }
})

test('independent: hook retains known rows on read error and writes use exact ID plus snapshot CAS', async () => {
  const b = browser(), t = transport([row(A), row(B)]), { h } = mountHook(t)
  try {
    await h.flush(); assert.deepEqual(h.value.items, [row(A), row(B)]); assert.equal(h.value.confirmed, true)
    assert.deepEqual(t.reads[0].filters, []); assert.equal(t.reads[0].selected.options.count, 'exact')
    t.replies.push(async () => ({ data: null, error: { code: '42501' }, count: null }))
    await h.value.refresh(); await h.flush(); assert.equal(h.value.items.length, 2); assert.match(h.value.loadError, /autorizada/)
    assert.equal(await h.value.mutate('update', row(B), { status: 'ativo' }), true); await h.flush()
    const write = t.writes[0]
    assert.deepEqual(write.filters, [['eq', 'id', B], ['eq', 'name', row(B).name], ['eq', 'created_at', row(B).created_at], ['is', 'phone', null], ['is', 'address', null], ['eq', 'segment', 'salao'], ['eq', 'status', 'pendente']])
    assert.equal(h.value.items.find(r => r.id === B).status, 'ativo')
  } finally { h.dispose(); b.restore() }
})

test('independent: repeated forced mutation handlers dispatch once and uncertain receipts block further tabs', async () => {
  const b = browser(), t = transport(), { h } = mountHook(t), d = deferred()
  try {
    await h.flush(); t.replies.push(() => d.promise)
    const staleHandler = h.value.mutate
    const first = staleHandler('update', row(), { status: 'ativo' })
    const second = staleHandler('update', row(), { status: 'ativo' })
    assert.equal(await second, false); await tick(); assert.equal(t.writes.length, 1)
    d.resolve({ data: [], error: null }); assert.equal(await first, false); await h.flush()
    assert.equal(h.value.items[0].status, 'pendente'); assert.equal(h.value.blocked, true); assert.match(h.value.mutationError, /confirmar/)
    assert.equal(await h.value.mutate('update', row(), { status: 'ativo' }), false); await h.flush(); assert.equal(t.writes.length, 1)
    const secondTab = mountHook(t); await secondTab.h.flush()
    assert.equal(await secondTab.h.value.mutate('create', undefined, { name: 'another tab' }), false); assert.equal(t.writes.length, 1); secondTab.h.dispose()
  } finally { h.dispose(); b.restore() }
})

test('independent: hook timeout aborts the request, retains state/reservation and ignores a late receipt', async () => {
  const b = browser(), t = transport(), { h } = mountHook(t), d = deferred()
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, timers = new Set()
  try {
    await h.flush()
    globalThis.setTimeout = (fn, ms) => { assert.equal(ms, 45000); timers.add(fn); return fn }
    globalThis.clearTimeout = fn => timers.delete(fn)
    t.replies.push(() => d.promise)
    const pending = h.value.mutate('update', row(), { status: 'ativo' }); await tick()
    assert.equal(t.writes.length, 1); assert.equal(timers.size, 1); [...timers][0]()
    assert.equal(await pending, false); await h.flush()
    assert.equal(t.writes[0].signal.aborted, true); assert.equal(h.value.items[0].status, 'pendente'); assert.equal(h.value.blocked, true)
    const marker = b.storage.getItem(operations.TENANT_MUTATION_KEY); assert.ok(marker)
    d.resolve({ data: [row(A, { status: 'ativo' })], error: null }); await tick(); await h.flush()
    assert.equal(h.value.items[0].status, 'pendente'); assert.equal(b.storage.getItem(operations.TENANT_MUTATION_KEY), marker)
    assert.equal(await h.value.mutate('update', row(), { status: 'ativo' }), false); assert.equal(t.writes.length, 1)
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; h.dispose(); b.restore() }
})

test('independent: missing Auth and DEV-style identities cannot dispatch forced reads or writes', async () => {
  const b = browser()
  try {
    for (const context of [{ ...identity(), session: null }, { ...identity(), session: { user: { id: OTHER } } }, { ...identity(), isAuthenticated: false }]) {
      const t = transport(), { h } = mountHook(t, context)
      await h.flush(); await h.value.refresh(); assert.equal(await h.value.mutate('create', undefined, { name: 'Denied' }), false)
      assert.equal(t.calls.length, 0); assert.equal(h.value.hasIdentity, false); h.dispose()
    }
  } finally { b.restore() }
})

test('independent: both keyed pages fence late A-to-B-to-A, actor changes and logout receipts', async tcase => {
  for (const page of ['src/pages/AdminProjects.tsx', 'src/pages/Estabelecimentos.tsx']) for (const transition of ['tenant', 'actor', 'logout']) await tcase.test(page + ' ' + transition, async () => {
    const b = browser(), t = transport(), d = deferred(), p = mountPage(page, t)
    try {
      t.replies.push(() => d.promise)
      await p.change(identity()); assert.ok(textOf(p.tree).includes('Carregando'))
      const middle = transition === 'tenant' ? identity(B) : transition === 'actor' ? identity(A, OTHER) : { ...identity(), session: null, isAuthenticated: false }
      await p.change(middle)
      await p.change(identity())
      d.resolve({ data: [row(B, { name: 'LATE-OLD-IDENTITY' })], error: null, count: 1 }); await p.h.flush()
      assert.doesNotMatch(textOf(p.tree), /LATE-OLD-IDENTITY/); assert.match(textOf(p.tree), /Synthetic a/)
    } finally { p.dispose(); b.restore() }
  })
})

test('independent: page create forms survive confirmed rejection and unknown receipt; only exact success closes', async tcase => {
  for (const page of ['src/pages/AdminProjects.tsx', 'src/pages/Estabelecimentos.tsx']) for (const outcome of ['rejected', 'unknown', 'success']) await tcase.test(page + ' ' + outcome, async () => {
    const b = browser(), t = transport(), p = mountPage(page, t)
    try {
      await p.change(identity()); find(p.tree, n => n.type === 'button' && /^Novo /.test(textOf(n))).props.onClick(); await p.h.flush()
      const input = find(p.tree, n => n.type === 'input' && /^Nome/.test(n.props.placeholder || ''))
      input.props.onChange({ target: { value: 'Synthetic form retained' } }); await p.h.flush()
      if (outcome === 'rejected') t.replies.push(async () => ({ data: null, error: { code: '42501' } }))
      if (outcome === 'unknown') t.replies.push(async () => ({ data: [], error: null }))
      const submit = find(p.tree, n => n.type === 'form').props.onSubmit
      const first = submit({ preventDefault() {} }), duplicate = submit({ preventDefault() {} })
      await Promise.all([first, duplicate]); await p.h.flush()
      assert.equal(t.writes.length, 1)
      if (outcome === 'success') assert.equal(find(p.tree, n => n.type === 'form'), undefined)
      else { assert.equal(find(p.tree, n => n.type === 'input' && /^Nome/.test(n.props.placeholder || '')).props.value, 'Synthetic form retained'); assert.ok(find(p.tree, n => n.props.role === 'alert')) }
    } finally { p.dispose(); b.restore() }
  })
})

test('independent: delete requires confirmation, zero rows retains card, and fabricated telemetry is absent', async () => {
  const b = browser(), t = transport(), p = mountPage('src/pages/AdminProjects.tsx', t)
  try {
    await p.change(identity()); assert.doesNotMatch(textOf(p.tree), /99,8%|42%|Banco isolado|tenants ativos/)
    b.setConfirm(false); find(p.tree, n => n.props.title === 'Excluir projeto').props.onClick(); await p.h.flush(); assert.equal(t.writes.length, 0)
    assert.match(b.confirmations[0], new RegExp(A))
    b.setConfirm(true); t.replies.push(async () => ({ data: [], error: null }))
    find(p.tree, n => n.props.title === 'Excluir projeto').props.onClick(); await p.h.flush()
    assert.equal(t.writes.length, 1); assert.match(textOf(p.tree), /Synthetic a/); assert.ok(find(p.tree, n => n.props.role === 'alert'))
  } finally { p.dispose(); b.restore() }
})

test('independent: late create success/error and captured handlers cannot affect remounted A identity', async tcase => {
  for (const page of ['src/pages/AdminProjects.tsx', 'src/pages/Estabelecimentos.tsx']) for (const outcome of ['success', 'rejected', 'network']) await tcase.test(page + ' ' + outcome, async () => {
    const b = browser(), t = transport(), p = mountPage(page, t), d = deferred()
    const openDraft = async name => {
      find(p.tree, n => n.type === 'button' && /^Novo /.test(textOf(n))).props.onClick(); await p.h.flush()
      find(p.tree, n => n.type === 'input' && /^Nome/.test(n.props.placeholder || '')).props.onChange({ target: { value: name } }); await p.h.flush()
    }
    try {
      await p.change(identity()); await openDraft('OLD CONTEXT DRAFT')
      t.replies.push(() => d.promise)
      const oldSubmit = find(p.tree, n => n.type === 'form').props.onSubmit
      const pending = oldSubmit({ preventDefault() {} }); await tick(); assert.equal(t.writes.length, 1)
      await p.change(identity(B)); await p.change(identity()); await openDraft('NEW CONTEXT DRAFT')
      await oldSubmit({ preventDefault() {} }); assert.equal(t.writes.length, 1, 'captured handler after unmount must not dispatch')
      if (outcome === 'success') d.resolve({ data: [{ ...row(t.writes[0].values.id), ...t.writes[0].values }], error: null })
      else if (outcome === 'rejected') d.resolve({ data: null, error: { code: '42501' } })
      else d.reject(Error('old request rejected'))
      await pending; await p.h.flush()
      assert.equal(find(p.tree, n => n.type === 'input' && /^Nome/.test(n.props.placeholder || '')).props.value, 'NEW CONTEXT DRAFT')
      assert.equal(findAll(p.tree, n => n.props.role === 'alert').length, 0)
      assert.equal(t.writes.length, 1)
    } finally { p.dispose(); b.restore() }
  })
})

test('independent: edit drafts and status are retained on denied or unconfirmed writes', async tcase => {
  for (const action of ['edit', 'status']) for (const outcome of ['rejected', 'zero', 'foreign', 'success']) await tcase.test(action + ' ' + outcome, async () => {
    const b = browser(), t = transport(), p = mountPage('src/pages/Estabelecimentos.tsx', t)
    try {
      await p.change(identity())
      if (action === 'edit') {
        find(p.tree, n => n.type === 'button' && textOf(n) === 'Editar').props.onClick(); await p.h.flush()
        find(p.tree, n => n.type === 'input' && n.props.value === row().name).props.onChange({ target: { value: 'Edited retained draft' } }); await p.h.flush()
      }
      if (outcome === 'rejected') t.replies.push(async () => ({ data: null, error: { code: '42501' } }))
      if (outcome === 'zero') t.replies.push(async () => ({ data: [], error: null }))
      if (outcome === 'foreign') t.replies.push(async q => ({ data: [{ ...row(B), ...q.values }], error: null }))
      const button = find(p.tree, n => n.type === 'button' && textOf(n) === (action === 'edit' ? 'Salvar' : 'Ativar'))
      await button.props.onClick(); await p.h.flush(); assert.equal(t.writes.length, 1)
      if (outcome !== 'success') {
        assert.ok(find(p.tree, n => n.props.role === 'alert'))
        if (action === 'edit') assert.ok(find(p.tree, n => n.type === 'input' && n.props.value === 'Edited retained draft'))
        else assert.ok(find(p.tree, n => n.type === 'button' && textOf(n) === 'Ativar'))
      } else if (action === 'edit') {
        assert.equal(find(p.tree, n => n.type === 'button' && textOf(n) === 'Salvar'), undefined)
        assert.match(textOf(p.tree), /Edited retained draft/)
      } else assert.ok(find(p.tree, n => n.type === 'button' && textOf(n) === 'Desativar'))
    } finally { p.dispose(); b.restore() }
  })
})

test('independent: stale error cannot overwrite a newer confirmed directory read', async () => {
  const b = browser(), t = transport(), { h } = mountHook(t), d = deferred()
  try {
    await h.flush(); t.replies.push(() => d.promise)
    const older = h.value.refresh(); await tick()
    t.setRows([row(B, { name: 'NEWEST READ' })]); await h.value.refresh(); await h.flush()
    d.reject(Error('late error')); await older; await h.flush()
    assert.equal(h.value.loadError, null); assert.equal(h.value.items[0].name, 'NEWEST READ')
  } finally { h.dispose(); b.restore() }
})

test('independent: baseline nullable created_at survives read, exact write receipt and null-safe CAS', async () => {
  const nullable = row(A, { created_at: null })
  assert.deepEqual(await directory.readTenantDirectory({ scope, details: true, isCurrent: () => true, execute: async () => ({ data: [nullable], error: null, count: 1 }) }), { items: [nullable], total: 1 })
  assert.equal((await operations.mutateTenant({ ...request(), before: nullable, isCurrent: () => true, execute: async () => ({ data: [{ ...nullable, name: 'Updated synthetic' }], error: null }) })).created_at, null)
  const b = browser(), t = transport([nullable]), { h } = mountHook(t), p = mountPage('src/pages/AdminProjects.tsx', t)
  try {
    await h.flush(); assert.equal(await h.value.mutate('update', nullable, { status: 'ativo' }), true); await h.flush()
    assert.ok(t.writes[0].filters.some(([op, field, value]) => op === 'is' && field === 'created_at' && value === null))
    await p.change(identity()); assert.match(textOf(p.tree), /Data(?: de criação)? não informada/); assert.doesNotMatch(textOf(p.tree), /Invalid Date|01\/01\/1970/)
  } finally { h.dispose(); p.dispose(); b.restore() }
})

test('independent: legacy names remain literal in reads/CAS while new blank names are rejected', async () => {
  for (const name of ['', ' ', '  Legacy literal  ']) {
    const legacy = row(A, { name })
    assert.deepEqual(await directory.readTenantDirectory({ scope, details: true, isCurrent: () => true, execute: async () => ({ data: [legacy], error: null, count: 1 }) }), { items: [legacy], total: 1 })
    assert.equal((await operations.mutateTenant({ ...request('delete'), before: legacy, isCurrent: () => true, execute: async () => ({ data: [legacy], error: null }) })).name, name)
    let calls = 0
    await assert.rejects(operations.mutateTenant({ ...request('create'), values: { name }, isCurrent: () => true, execute: async () => { calls++; return {} } }), rejectAs('rejected', true)); assert.equal(calls, 0)
  }
})

test('independent: legitimate partial lists retain rows and expose an explicit partial notice', async tcase => {
  assert.deepEqual(await directory.readTenantDirectory({ scope, details: true, isCurrent: () => true, execute: async () => ({ data: [row()], error: null, count: 1001 }) }), { items: [row()], total: 1001 })
  for (const page of ['src/pages/AdminProjects.tsx', 'src/pages/Estabelecimentos.tsx']) await tcase.test(page, async () => {
    const b = browser(), t = transport(), p = mountPage(page, t)
    try {
      t.replies.push(async () => ({ data: [row()], error: null, count: 1001 }))
      await p.change(identity()); assert.match(textOf(p.tree), /Synthetic a/); assert.match(textOf(p.tree), /parcial/i); assert.match(textOf(p.tree), /1001/)
      assert.equal(findAll(p.tree, n => n.props.role === 'alert').length, 0)
    } finally { p.dispose(); b.restore() }
  })
  const b = browser(), t = transport(), p = mountPage('src/pages/AdminProjects.tsx', t)
  try {
    t.replies.push(async () => ({ data: [], error: null, count: 1001 }))
    await p.change(identity()); assert.match(textOf(p.tree), /parcial/i); assert.doesNotMatch(textOf(p.tree), /Nenhum projeto visível/)
  } finally { p.dispose(); b.restore() }
})

test('independent: installed Supabase transport honors pinned Authorization despite later session token', async () => {
  const { createClient } = deps('@supabase/supabase-js'), seen = []
  const client = createClient('https://synthetic.invalid', 'synthetic-publishable', {
    accessToken: async () => 'synthetic-new-actor-token',
    global: { fetch: async (url, options) => { seen.push({ url: String(url), options, headers: new Headers(options.headers) }); return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '*/0' } }) } },
  })
  await client.from('tenants').select('id,name,created_at', { count: 'exact' }).setHeader('Authorization', 'Bearer synthetic-captured-actor-token').retry(false)
  assert.equal(seen.length, 1); assert.equal(seen[0].headers.get('authorization'), 'Bearer synthetic-captured-actor-token')
  assert.match(seen[0].url, /synthetic\.invalid\/rest\/v1\/tenants/)
})

test('independent: installed transport does not retry failed writes when retry(false) is used', async () => {
  const { createClient } = deps('@supabase/supabase-js')
  for (const failure of ['unavailable', 'throw']) {
    let calls = 0
    const client = createClient('https://synthetic.invalid', 'synthetic-publishable', {
      accessToken: async () => 'synthetic-only',
      global: { fetch: async () => { calls++; if (failure === 'throw') throw Error('synthetic transport rejection'); return new Response(JSON.stringify({ message: 'Unavailable', code: '503' }), { status: 503, headers: { 'Content-Type': 'application/json' } }) } },
    })
    const response = await client.from('tenants').update({ status: 'ativo' }).eq('id', A).select('id,name,created_at').setHeader('Authorization', 'Bearer synthetic-only').retry(false)
    assert.ok(response.error); assert.equal(calls, 1)
  }
})

test('independent: installed SDK async Auth cannot dispatch old page writes after identity cleanup', async tcase => {
  for (const transition of ['tenant', 'actor', 'logout', 'ABA']) await tcase.test(transition, async () => {
    const { createClient } = deps('@supabase/supabase-js'), delayedAuth = deferred(), b = browser()
    const sent = [], canceled = []; let deferNext = false, authEntered = false
    const client = createClient('https://synthetic.invalid', 'synthetic-publishable', {
      accessToken: async () => { if (deferNext) { deferNext = false; authEntered = true; return delayedAuth.promise } return 'synthetic-new-sdk-session' },
      global: { fetch: async (url, options) => {
        const headers = new Headers(options.headers)
        const record = { method: options.method, headers, signal: options.signal }
        if (options.signal?.aborted) { canceled.push(record); throw new DOMException('Synthetic pre-dispatch cancellation', 'AbortError') }
        sent.push(record)
        return new Response(JSON.stringify([row()]), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' } })
      } },
    })
    const p = mountPage('src/pages/AdminProjects.tsx', { source: client })
    try {
      await p.change(identity())
      find(p.tree, n => n.type === 'button' && /^Novo /.test(textOf(n))).props.onClick(); await p.h.flush()
      find(p.tree, n => n.type === 'input' && /^Nome/.test(n.props.placeholder || '')).props.onChange({ target: { value: 'Do not dispatch under new actor' } }); await p.h.flush()
      deferNext = true
      const pending = find(p.tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await tick(); assert.equal(authEntered, true)
      const next = transition === 'tenant' ? identity(B) : transition === 'logout' ? { ...identity(), session: null, isAuthenticated: false } : identity(A, OTHER)
      await p.change(next)
      if (transition === 'ABA') await p.change(identity())
      delayedAuth.resolve('synthetic-changed-actor-sdk-token'); await pending; await p.h.flush()
      assert.equal(sent.filter(r => r.method === 'POST').length, 0, 'no old mutation may dispatch after identity cleanup')
      assert.equal(canceled.filter(r => r.method === 'POST').length, 1)
      assert.equal(canceled.find(r => r.method === 'POST').headers.get('authorization'), 'Bearer ' + identity().session.access_token)
      assert.doesNotMatch(JSON.stringify([...b.map.values()]), /synthetic-only|sdk-token/)
    } finally { p.dispose(); b.restore() }
  })
})

test('independent: reviewed source files remained unchanged during this run', () => {
  for (const [file, expected] of reviewed) assert.equal(digest(file), expected, file + ' changed while review was running')
  for (const [file, hash] of reviewed) console.log('REVIEW_SHA256 ' + file + ' ' + hash)
})
