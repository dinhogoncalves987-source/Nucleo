import test from 'node:test'
import assert from 'node:assert/strict'
import { createIdentityLifecycle, emptyIdentity } from '../src/contexts/identity-lifecycle.ts'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const session = id => ({ user: { id }, access_token: `token-${id}` })
const profile = id => ({ id, tenant_id: `tenant-${id}`, email: `${id}@test.invalid`, role: 'operator' })
const tenant = id => ({ id: `tenant-${id}`, name: id })
function harness() {
  const initial = deferred(), out = deferred()
  const profiles = new Map(), tenants = new Map(), states = []
  let callback, unsubscribed = 0, signOutCalls = 0
  const owner = createIdentityLifecycle({
    getSession: () => initial.promise,
    subscribe: cb => { callback = cb; return () => { unsubscribed++ } },
    profile: id => { const request = deferred(); profiles.set(id, request); return request.promise },
    tenant: id => { const request = deferred(); tenants.set(id, request); return request.promise },
    signOut: () => { signOutCalls++; return out.promise },
  }, state => states.push(state))
  const emit = (event, value) => callback(event, value)
  const complete = async id => {
    profiles.get(id).resolve(profile(id)); await settle()
    tenants.get(`tenant-${id}`).resolve(tenant(id)); await settle()
  }
  return { owner, initial, out, profiles, tenants, states, emit, complete,
    last: () => states.at(-1), unsubscribed: () => unsubscribed, signOutCalls: () => signOutCalls }
}

test('normal initialization publishes only a complete identity; refresh and logout preserve contract', async () => {
  const h = harness()
  h.initial.resolve({ data: { session: session('a') } }); await settle()
  assert.deepEqual(h.last(), emptyIdentity(true))
  await h.complete('a')
  assert.deepEqual(h.last(), { session: session('a'), user: profile('a'), tenant: tenant('a'), loading: false })
  h.emit('TOKEN_REFRESHED', { ...session('a'), access_token: 'renewed' }); await settle()
  assert.deepEqual(h.last(), emptyIdentity(true))
  await h.complete('a'); assert.equal(h.last().session.access_token, 'renewed')
  const logout = h.owner.logout(); assert.deepEqual(h.last(), emptyIdentity())
  h.out.resolve({ error: null }); await logout
  assert.equal(h.signOutCalls(), 1)
  h.owner.dispose(); assert.equal(h.unsubscribed(), 1)
})

test('late getSession snapshot, failure and INITIAL_SESSION cannot supersede newer auth event', async () => {
  for (const failure of [false, true]) {
    const h = harness()
    h.emit('SIGNED_IN', session('b')); await settle(); await h.complete('b')
    if (failure) h.initial.reject(new Error('old read failed'))
    else h.initial.resolve({ data: { session: session('a') } })
    h.emit('INITIAL_SESSION', session('a')); await settle()
    assert.equal(h.last().user.id, 'b'); assert.equal(h.profiles.has('a'), false)
    h.owner.dispose()
  }
})

test('late profile success/error cannot replace or clear the newer identity', async () => {
  for (const failure of [false, true]) {
    const h = harness()
    h.emit('SIGNED_IN', session('a')); await settle()
    h.emit('SIGNED_IN', session('b')); await settle(); await h.complete('b')
    if (failure) h.profiles.get('a').reject(new Error('old profile failed'))
    else h.profiles.get('a').resolve(profile('a'))
    await settle()
    assert.equal(h.last().user.id, 'b'); assert.equal(h.tenants.has('tenant-a'), false)
    h.owner.dispose()
  }
})

test('late tenant success/error cannot replace new identity or end its loading', async () => {
  for (const failure of [false, true]) {
    const h = harness()
    h.emit('SIGNED_IN', session('a')); await settle()
    h.profiles.get('a').resolve(profile('a')); await settle()
    h.emit('SIGNED_IN', session('b')); await settle()
    if (failure) h.tenants.get('tenant-a').reject(new Error('old tenant failed'))
    else h.tenants.get('tenant-a').resolve(tenant('a'))
    await settle(); assert.deepEqual(h.last(), emptyIdentity(true))
    await h.complete('b'); assert.equal(h.last().user.id, 'b')
    h.owner.dispose()
  }
})

test('logout immediately invalidates pending tenant, snapshot and events even when signOut fails', async () => {
  const h = harness()
  h.emit('SIGNED_IN', session('a')); await settle()
  h.profiles.get('a').resolve(profile('a')); await settle()
  const pending = h.owner.logout()
  assert.equal(h.owner.logout(), pending)
  assert.deepEqual(h.last(), emptyIdentity())
  h.emit('SIGNED_IN', session('a'))
  h.tenants.get('tenant-a').resolve(tenant('a'))
  h.initial.resolve({ data: { session: session('a') } }); await settle()
  assert.deepEqual(h.last(), emptyIdentity())
  h.out.reject(new Error('offline')); await pending
  h.emit('TOKEN_REFRESHED', session('a')); await settle()
  assert.deepEqual(h.last(), emptyIdentity())
  h.emit('SIGNED_IN', session('b')); await settle(); await h.complete('b')
  assert.equal(h.last().user.id, 'b'); h.owner.dispose()
})

test('SIGNED_OUT discards old requests and refreshes', async () => {
  const h = harness()
  h.emit('SIGNED_IN', session('a')); await settle()
  h.emit('SIGNED_OUT', null)
  h.profiles.get('a').resolve(profile('a'))
  h.emit('TOKEN_REFRESHED', session('a')); await settle()
  assert.deepEqual(h.last(), emptyIdentity()); h.owner.dispose()
})

test('unmount blocks successes, errors, auth events and logout continuations', async () => {
  for (const stage of ['initial', 'profile', 'tenant', 'logout']) {
    for (const failure of [false, true]) {
      const h = harness()
      let request = h.initial, value = { data: { session: session('a') } }
      if (stage !== 'initial') {
        h.emit('SIGNED_IN', session('a')); await settle()
        request = h.profiles.get('a'); value = profile('a')
      }
      if (stage === 'tenant') {
        request.resolve(value); await settle()
        request = h.tenants.get('tenant-a'); value = tenant('a')
      }
      if (stage === 'logout') { void h.owner.logout(); await settle(); request = h.out; value = {} }
      h.owner.dispose(); const count = h.states.length
      if (failure) request.reject(new Error('late error')); else request.resolve(value)
      h.emit('SIGNED_IN', session('b')); await settle(); await h.owner.logout()
      assert.equal(h.states.length, count); assert.equal(h.unsubscribed(), 1)
    }
  }
})

test('missing session and current profile/tenant/read errors fail closed with loading false', async () => {
  for (const stage of ['anonymous', 'read-error', 'profile', 'tenant', 'wrong-user', 'wrong-tenant']) {
    const h = harness()
    h.initial.resolve({ data: { session: stage === 'anonymous' ? null : session('a') }, error: stage === 'read-error' ? new Error('read failed') : null }); await settle()
    if (stage === 'profile') h.profiles.get('a').reject(new Error('no profile'))
    if (stage === 'wrong-user') h.profiles.get('a').resolve(profile('b'))
    if (stage === 'tenant' || stage === 'wrong-tenant') {
      h.profiles.get('a').resolve(profile('a')); await settle()
      if (stage === 'tenant') h.tenants.get('tenant-a').reject(new Error('no tenant'))
      else h.tenants.get('tenant-a').resolve(tenant('b'))
    }
    await settle(); assert.deepEqual(h.last(), emptyIdentity(), stage); h.owner.dispose()
  }
})

test('synchronous subscription event also supersedes a rejected initialization snapshot', async () => {
  const initial = deferred(), result = deferred(), states = []
  const owner = createIdentityLifecycle({
    subscribe: callback => { callback('SIGNED_IN', session('a')); return () => {} },
    getSession: () => initial.promise,
    profile: () => result.promise,
    tenant: async () => tenant('a'),
    signOut: async () => ({}),
  }, value => states.push(value))
  initial.reject(new Error('stale snapshot')); await settle()
  assert.deepEqual(states.at(-1), emptyIdentity(true))
  result.resolve(profile('a')); await settle()
  assert.equal(states.at(-1).user.id, 'a'); owner.dispose()
})

test('new login can wait for logout without a late logout clearing its identity', async () => {
  const h = harness()
  void h.owner.logout()
  let ready = false
  const login = h.owner.waitForLogout().then(() => { ready = true; h.emit('SIGNED_IN', session('b')) })
  await settle(); assert.equal(ready, false)
  h.out.resolve({}); await login; await settle(); await h.complete('b')
  assert.equal(h.last().user.id, 'b'); h.owner.dispose()
})
