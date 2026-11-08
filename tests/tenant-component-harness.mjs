// Offline actual-TSX harness. Simulates hooks/JSX, not React DOM or production RLS.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
const dependencyRoot = path.resolve(process.env.NUCLEO_TEST_DEPS_ROOT || root)
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
assert.equal(hash(path.join(root, 'package-lock.json')), hash(path.join(dependencyRoot, 'package-lock.json')), 'Dependency lock must match')
const require = createRequire(path.join(dependencyRoot, 'package.json'))
const ts = require('typescript')
export const existing = { id: 'target-a', name: 'Projeto existente', created_at: '2026-11-08T00:00:00Z', phone: null, address: null, segment: 'salao', status: 'pendente' }
export const identity = (actorId = 'actor-a', tenantId = 'origin-a') => ({ tenant: { id: tenantId }, user: { id: actorId, tenant_id: tenantId, role: 'superadmin' }, session: { user: { id: actorId }, access_token: 'synthetic-fixture-' + actorId }, isAuthenticated: true, loading: false })
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
export const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
export const textOf = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(textOf).join(' ') : typeof node !== 'object' ? String(node) : textOf(node.props?.children)
const find = (node, predicate) => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => find(child, predicate)) : [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)]
export const storage = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) } }
export const locks = () => {
  let occupied = false
  return { request: async (_key, _options, callback) => {
    if (occupied) return callback(null)
    occupied = true
    try { return await callback({ name: 'synthetic-lock' }) } finally { occupied = false }
  } }
}

export function harness(page = 'AdminProjects', options = {}) {
  let currentIdentity = options.identity ?? identity(), tree, cursor = 0, slots = [], mountedKey, active = true
  const effects = [], cache = new Map(), calls = [], confirms = [], readQueue = [], mutations = []
  const sharedStorage = options.storage ?? storage(), sharedLocks = options.locks ?? locks()
  const events = new EventTarget()
  let serverRows = [{ ...existing }]
  const changedDeps = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => value !== b[i])
  const hooks = {
    useState(initial) {
      const index = cursor++, owner = slots
      owner[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [owner[index].value, value => { owner[index].value = typeof value === 'function' ? value(owner[index].value) : value }]
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index] },
    useCallback(callback, deps) {
      const index = cursor++
      if (!slots[index] || changedDeps(slots[index].deps, deps)) slots[index] = { callback, deps }
      return slots[index].callback
    },
    useEffect(effect, deps) {
      const index = cursor++, owner = slots
      if (!owner[index] || changedDeps(owner[index].deps, deps)) {
        const previous = owner[index]
        owner[index] = { deps }
        effects.push(() => { previous?.cleanup?.(); owner[index].cleanup = effect() })
      }
    },
  }
  hooks.useLayoutEffect = hooks.useEffect
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  const project = (row, columns) => !columns || columns === '*' ? { ...row } : Object.fromEntries(columns.split(',').map(c => c.trim()).map(c => [c, row[c]]))
  const supabase = {
    from(table) {
      assert.equal(table, 'tenants'); calls.push(['from', table])
      let kind = 'read', values, selected = '', filters = [], single = false, signal
      const query = {
        select(columns, selectOptions) { selected = columns; calls.push(['select', kind, columns, selectOptions]); return query },
        order(field, orderOptions) { calls.push(['order', field, orderOptions]); return query },
        insert(payload) { kind = 'create'; values = payload; calls.push(['insert', structuredClone(payload)]); return query },
        update(payload) { kind = 'update'; values = payload; calls.push(['update', structuredClone(payload)]); return query },
        delete() { kind = 'delete'; calls.push(['delete']); return query },
        eq(field, value) { filters.push([field, value]); calls.push(['eq', field, value]); return query },
        is(field, value) { filters.push([field, value]); calls.push(['is', field, value]); return query },
        single() { single = true; return query },
        retry(enabled) { assert.equal(enabled, false); calls.push(['retry', enabled]); return query },
        setHeader(name, value) { assert.equal(name, 'Authorization'); assert.equal(value.startsWith('Bearer '), true); calls.push(['setHeader', name]); return query },
        abortSignal(value) { signal = value; calls.push(['abortSignal']); return query },
        then(resolve, reject) {
          if (kind === 'read') {
            const next = readQueue.length ? readQueue.shift() : { data: serverRows.map(row => project(row, selected)), error: null, count: serverRows.length }
            return Promise.resolve(next).then(resolve, reject)
          }
          const pending = deferred()
          mutations.push({ kind, values, filters, selected, signal, resolve: response => {
            if (response?.error === null && Array.isArray(response.data) && response.data.length === 1) {
              const row = response.data[0]
              if (kind === 'create') serverRows = [...serverRows, row]
              else if (kind === 'delete') serverRows = serverRows.filter(item => item.id !== row.id)
              else serverRows = serverRows.map(item => item.id === row.id ? row : item)
            }
            pending.resolve(single && Array.isArray(response?.data) ? { ...response, data: response.data[0] ?? null } : response)
          }, reject: pending.reject })
          return pending.promise.then(resolve, reject)
        },
      }
      return query
    },
  }
  const load = file => {
    if (cache.has(file)) return cache.get(file)
    const exports = {}; cache.set(file, exports)
    const source = readFileSync(file, 'utf8')
    const output = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(output, {
      exports, setTimeout, clearTimeout, Event, AbortController, crypto: { randomUUID },
      window: { localStorage: sharedStorage, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), confirm: message => { confirms.push(message); return options.confirm !== false } },
      navigator: { locks: sharedLocks },
      require(name) {
        if (name === 'react') return hooks
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
        if (name.endsWith('/tenant-context')) return { useTenant: () => currentIdentity }
        if (name.endsWith('/AppLayout')) return { default: 'app-layout' }
        if (name.endsWith('/supabase')) return { supabase }
        if (name === 'lucide-react') return new Proxy({}, { get: (_object, key) => String(key) })
        const target = path.resolve(path.dirname(file), name.endsWith('.ts') ? name : name + '.ts')
        assert.ok(target.startsWith(path.join(root, 'src', 'lib')))
        return load(target)
      },
    }, { timeout: 10000 })
    return exports
  }
  const defaultSource = path.join(root, 'src', 'pages', page + '.tsx')
  const component = load(options.sourceFile ?? defaultSource).default
  const cleanup = () => { for (const slot of slots) slot?.cleanup?.(); slots = []; effects.length = 0 }
  const render = () => {
    if (!active) return
    cursor = 0
    const wrapper = component()
    if (typeof wrapper.type === 'function') {
      if (mountedKey !== wrapper.key) { cleanup(); mountedKey = wrapper.key }
      cursor = 0; tree = wrapper.type(wrapper.props)
    } else tree = wrapper
    for (const effect of effects.splice(0)) effect()
    return tree
  }
  render()
  return {
    calls, confirms, mutations, readQueue, render, storage: sharedStorage,
    text: () => textOf(tree), nodes: predicate => find(tree, predicate),
    one(predicate) { const nodes = find(tree, predicate); assert.equal(nodes.length, 1, 'Expected one matching node'); return nodes[0] },
    button(label) { return this.one(n => n.type === 'button' && (n.props['aria-label'] === label || textOf(n).trim() === label)) },
    click(label) { const value = this.button(label).props.onClick(); render(); return value },
    change(placeholder, value) { this.one(n => n.type === 'input' && n.props.placeholder === placeholder).props.onChange({ target: { value } }); render() },
    submit() { const value = this.one(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); render(); return value },
    async flush() { await settle(); render(); await settle(); render() },
    switchIdentity(next) { currentIdentity = next; render() },
    setServerRows(rows) { serverRows = rows },
    unmount() { cleanup(); active = false },
  }
}
