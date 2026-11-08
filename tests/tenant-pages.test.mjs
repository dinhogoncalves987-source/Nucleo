import test from 'node:test'
import assert from 'node:assert/strict'
import { harness, existing, identity, deferred, settle, storage, locks } from './tenant-component-harness.mjs'
import { TENANT_MUTATION_KEY } from '../src/lib/tenant-operations.ts'

const safe = h => assert.doesNotMatch(h.text(), /SECRET|private-token|fix_rls|service_role/)
const formName = h => h.one(n => n.type === 'input' && n.props.placeholder === 'Nome *').props.value
const editName = h => h.nodes(n => n.type === 'input' && n.props.type === 'text' && !n.props.placeholder)[0]
async function establishment() { const h = harness('Estabelecimentos'); await h.flush(); return h }

for (const error of [{ code: '42501', message: 'SECRET' }, { code: '23505', message: 'SECRET' }]) {
  test('establishment insert preserves filled form on ' + error.code, async () => {
    const h = await establishment()
    h.click('Novo Estabelecimento'); h.change('Nome *', '  Novo salão fictício  '); h.change('Telefone', '1100000000')
    const operation = h.submit(); await settle()
    assert.equal(h.mutations.length, 1)
    h.mutations[0].resolve({ data: null, error })
    await operation; await h.flush()
    assert.equal(formName(h), '  Novo salão fictício  ')
    assert.match(h.text(), /Operação recusada/)
    assert.ok(h.text().includes(existing.name)); safe(h); h.unmount()
  })
}

test('establishment creation closes only after exact ID and all submitted fields return', async () => {
  const h = await establishment()
  h.click('Novo Estabelecimento'); h.change('Nome *', 'Novo salão')
  const operation = h.submit(); await settle()
  const request = h.mutations[0]
  assert.deepEqual(JSON.parse(JSON.stringify(request.values)), { id: request.values.id, name: 'Novo salão', phone: null, address: null, segment: 'salao', status: 'pendente' })
  request.resolve({ data: [{ ...request.values, created_at: existing.created_at }], error: null })
  await operation; await h.flush()
  assert.equal(h.nodes(n => n.type === 'form').length, 0)
  assert.match(h.text(), /Novo salão/); safe(h); h.unmount()
})

test('editing preserves draft after FK rejection and sends exact previous-state CAS with null filters', async () => {
  const h = await establishment()
  h.click('Editar'); editName(h).props.onChange({ target: { value: 'Nome editado' } }); h.render()
  const operation = h.click('Salvar'); await settle()
  const request = h.mutations[0]
  assert.equal(request.kind, 'update')
  assert.deepEqual(JSON.parse(JSON.stringify(request.filters)), [
    ['id', existing.id], ['name', existing.name], ['created_at', existing.created_at],
    ['phone', null], ['address', null], ['segment', 'salao'], ['status', 'pendente'],
  ])
  assert.ok(h.calls.some(call => call[0] === 'is' && call[1] === 'phone' && call[2] === null))
  request.resolve({ data: null, error: { code: '23503', message: 'SECRET' } })
  await operation; await h.flush()
  assert.equal(editName(h).props.value, 'Nome editado')
  assert.equal(h.button('Salvar').props.disabled, false)
  safe(h); h.unmount()
})

test('zero-row status update cannot turn Pendente into Ativo; blocks repeated attempts', async () => {
  const h = await establishment()
  const first = h.click('Ativar'), second = h.click('Ativar')
  await settle(); assert.equal(h.mutations.length, 1)
  h.mutations[0].resolve({ data: [], error: null })
  await Promise.all([first, second]); await h.flush()
  assert.equal(h.button('Ativar').props.disabled, true)
  assert.equal(h.nodes(n => n.type === 'button' && n.props.children === 'Desativar').length, 0)
  assert.match(h.text(), /Não foi possível confirmar a alteração/)
  safe(h); h.unmount()
})

test('exact status update updates row only after receipt', async () => {
  const h = await establishment()
  const operation = h.click('Ativar'); await settle()
  assert.equal(h.button('Ativar').props.disabled, true)
  h.mutations[0].resolve({ data: [{ ...existing, status: 'ativo' }], error: null })
  await operation; await h.flush()
  assert.equal(h.button('Desativar').props.disabled, false)
  assert.equal(h.storage.getItem(TENANT_MUTATION_KEY), null)
  h.unmount()
})

test('failed initial details query displays unavailable instead of invented zero metrics', async () => {
  const h = harness('Estabelecimentos')
  h.readQueue.push({ data: null, error: { code: '42703', message: 'SECRET' }, count: null })
  await h.flush()
  const metrics = h.nodes(n => n.type === 'p' && n.props.className === 'text-2xl font-bold')
  assert.equal(metrics.length, 4)
  for (const metric of metrics) assert.equal(metric.props.children, 'Indisponível')
  safe(h); h.unmount()
})

test('latest refresh wins and late older response never replaces confirmed newer list', async () => {
  const h = await establishment(), first = deferred(), second = deferred()
  h.readQueue.push(first.promise, second.promise)
  h.click('Atualizar estabelecimentos'); await settle()
  h.click('Atualizar estabelecimentos'); await settle()
  second.resolve({ data: [{ ...existing, name: 'Mais recente' }], error: null, count: 1 })
  await h.flush(); assert.match(h.text(), /Mais recente/)
  first.resolve({ data: [{ ...existing, name: 'Resposta velha' }], error: null, count: 1 })
  await h.flush(); assert.match(h.text(), /Mais recente/); assert.doesNotMatch(h.text(), /Resposta velha/)
  h.unmount()
})

test('actor change, company change, logout and A→B→A discard old operation UI callbacks', async () => {
  for (const next of [identity('actor-b'), identity('actor-a', 'origin-b'), { tenant: null, user: null, session: null, isAuthenticated: false, loading: false }]) {
    const h = await establishment()
    h.click('Novo Estabelecimento'); h.change('Nome *', 'Draft old actor')
    const operation = h.submit(); await settle()
    h.switchIdentity(next); await h.flush()
    assert.equal(h.mutations[0].signal.aborted, true)
    h.switchIdentity(identity()); await h.flush()
    h.click('Novo Estabelecimento'); h.change('Nome *', 'Draft current actor')
    h.mutations[0].resolve({ data: null, error: { message: 'SECRET network' } })
    await operation; await h.flush()
    assert.equal(formName(h), 'Draft current actor')
    assert.ok(h.storage.getItem(TENANT_MUTATION_KEY))
    assert.equal(h.one(n => n.type === 'button' && n.props.type === 'submit').props.disabled, true)
    safe(h); h.unmount()
  }
})

test('global browser reservation blocks another page/tab and survives unmount and reload', async () => {
  const sharedStorage = storage(), sharedLocks = locks()
  const admin = harness('AdminProjects', { storage: sharedStorage, locks: sharedLocks })
  const establishments = harness('Estabelecimentos', { storage: sharedStorage, locks: sharedLocks })
  await admin.flush(); await establishments.flush()
  admin.click('Novo Projeto (Tenant)'); admin.change('Nome do projeto', 'Draft')
  const operation = admin.submit(); await settle()
  await establishments.click('Ativar'); await establishments.flush()
  assert.equal(establishments.mutations.length, 0)
  admin.unmount()
  admin.mutations[0].reject(Error('SECRET'))
  await operation; await settle()
  establishments.unmount()
  const reload = harness('Estabelecimentos', { storage: sharedStorage, locks: sharedLocks, identity: identity('different-actor') })
  await reload.flush()
  assert.equal(reload.button('Ativar').props.disabled, true)
  await reload.click('Ativar'); await reload.flush()
  assert.equal(reload.mutations.length, 0)
  assert.ok(sharedStorage.getItem(TENANT_MUTATION_KEY))
  safe(reload); reload.unmount()
})

test('nullable creation date is shown honestly and deletes use IS NULL; partial lists retain loaded rows', async () => {
  const h = harness('AdminProjects')
  h.readQueue.push({ data: [{ id: existing.id, name: existing.name, created_at: null }], count: 1001, error: null })
  await h.flush()
  assert.match(h.text(), /Data de criação não informada/)
  assert.match(h.text(), /Lista parcial: 1 de 1001/)
  h.click('Excluir projeto ' + existing.name); await settle()
  assert.ok(h.calls.some(call => call[0] === 'is' && call[1] === 'created_at' && call[2] === null))
  h.mutations[0].resolve({ data: [{ id: existing.id, name: existing.name, created_at: null }], error: null })
  await h.flush(); assert.equal(h.storage.getItem(TENANT_MUTATION_KEY), null)
  h.unmount()
})
