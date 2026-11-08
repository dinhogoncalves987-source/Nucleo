import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { harness, existing, settle } from './tenant-component-harness.mjs'

const source = readFileSync(process.env.NUCLEO_TEST_SOURCE_FILE || new URL('../src/pages/AdminProjects.tsx', import.meta.url), 'utf8')
const safe = text => assert.doesNotMatch(text, /fix_rls|SQL Editor|service_role|raw-backend-detail|private-token|nada foi alterado|nenhum dado foi alterado/i)
async function prepare(name = '  Projeto fictício  ', extra = {}) {
  const h = harness('AdminProjects', { sourceFile: process.env.NUCLEO_TEST_SOURCE_FILE, ...extra })
  await h.flush()
  h.click('Novo Projeto (Tenant)')
  h.change('Nome do projeto', name)
  return h
}
const formName = h => h.one(n => n.type === 'input' && n.props.placeholder === 'Nome do projeto').props.value
const submitButton = h => h.one(n => n.type === 'button' && n.props.type === 'submit')

test('source does not recommend SQL/credential bypasses or invent telemetry', () => {
  assert.doesNotMatch(source, /fix_rls|SQL Editor|setFormError\(error\.message\)|service_role|99,8%|42%|tenants.length \* 2/i)
  assert.match(source, /<form onSubmit=\{handleCreate\}/)
})

for (const [label, error, remainsBlocked] of [
  ['RLS code', { code: '42501', message: 'raw-backend-detail private-token', hint: 'Run fix_rls.sql' }, false],
  ['RLS text without reliable code', { message: 'new row violates row-level security raw-backend-detail' }, true],
  ['duplicate rejection', { code: '23505', message: 'raw-backend-detail private-token', hint: 'Use service_role' }, false],
  ['network response error', { message: 'TypeError: Failed to fetch private-token' }, true],
  ['empty error object', {}, true],
]) {
  test(label + ': preserves form, input and existing tenant; sanitizes error without a false success', async () => {
    const h = await prepare()
    const operation = h.submit()
    assert.equal(submitButton(h).props.disabled, true)
    await settle()
    assert.equal(h.mutations.length, 1)
    h.mutations[0].resolve({ data: null, error })
    await operation; await h.flush()
    assert.equal(h.nodes(n => n.type === 'form').length, 1)
    assert.equal(formName(h), '  Projeto fictício  ')
    assert.equal(submitButton(h).props.disabled, remainsBlocked)
    assert.ok(h.text().includes(existing.name))
    assert.match(h.text(), remainsBlocked ? /Não foi possível confirmar a alteração/ : /Operação recusada/)
    safe(h.text())
    assert.equal(h.calls.filter(([kind]) => kind === 'insert').length, 1)
    h.change('Nome do projeto', 'Nome revisado')
    assert.equal(formName(h), 'Nome revisado')
    assert.equal(h.calls.filter(([kind]) => kind === 'insert').length, 1)
    h.unmount()
  })
}

test('error alongside data remains uncertain and cannot append or close', async () => {
  const h = await prepare()
  const operation = h.submit(); await settle()
  const created = { ...h.mutations[0].values, created_at: existing.created_at }
  h.mutations[0].resolve({ data: [created], error: { code: '42501', message: 'raw-backend-detail' } })
  await operation; await h.flush()
  assert.equal(h.nodes(n => n.type === 'form').length, 1)
  assert.match(h.text(), /Não foi possível confirmar a alteração/)
  assert.equal(h.nodes(n => n.type === 'h3').length, 1)
  safe(h.text()); h.unmount()
})

test('exact creation receipt adds returned UUID/name, resets form and does not imply account provisioning', async () => {
  const h = await prepare()
  const operation = h.submit(); await settle()
  const mutation = h.mutations[0]
  assert.match(mutation.values.id, /^[a-f0-9-]{36}$/)
  assert.equal(mutation.values.name, 'Projeto fictício')
  assert.deepEqual(Object.keys(mutation.values).sort(), ['id', 'name'])
  mutation.resolve({ data: [{ ...mutation.values, created_at: existing.created_at }], error: null })
  await operation; await h.flush()
  assert.equal(h.nodes(n => n.type === 'form').length, 0)
  assert.equal(h.nodes(n => n.type === 'h3').length, 2)
  assert.match(h.text(), /não cria conta de acesso nem perfil/)
  h.click('Novo Projeto (Tenant)')
  assert.equal(formName(h), '')
  safe(h.text()); h.unmount()
})

test('blank name never dispatches; null data now reports uncertainty and preserves form', async () => {
  const blank = await prepare('   ')
  await blank.submit(); await blank.flush()
  assert.equal(blank.mutations.length, 0)
  assert.equal(formName(blank), '   ')
  blank.unmount()
  const h = await prepare()
  const operation = h.submit(); await settle()
  h.mutations[0].resolve({ data: null, error: null })
  await operation; await h.flush()
  assert.equal(formName(h), '  Projeto fictício  ')
  assert.match(h.text(), /Não foi possível confirmar a alteração/)
  assert.equal(submitButton(h).props.disabled, true)
  safe(h.text()); h.unmount()
})

test('double submit and rejected promise preserve a durable pending marker without retry', async () => {
  const h = await prepare()
  const first = h.submit(), second = h.submit()
  await settle(); assert.equal(h.mutations.length, 1)
  h.mutations[0].reject(Error('private-token raw-backend-detail'))
  await Promise.all([first, second]); await h.flush()
  assert.equal(formName(h), '  Projeto fictício  ')
  assert.match(h.text(), /Não foi possível confirmar a alteração/)
  assert.equal(submitButton(h).props.disabled, true)
  await h.submit(); await h.flush()
  assert.equal(h.mutations.length, 1)
  safe(h.text()); h.unmount()
})

test('delete requires named confirmation and zero-row response never removes card', async () => {
  const cancelled = await prepare('Name', { confirm: false })
  cancelled.click('Excluir projeto ' + existing.name); await cancelled.flush()
  assert.equal(cancelled.mutations.length, 0)
  assert.match(cancelled.confirms[0], /Projeto existente.*target-a.*dados vinculados/)
  cancelled.unmount()
  const h = await prepare()
  h.click('Excluir projeto ' + existing.name); await settle()
  assert.equal(h.mutations.length, 1)
  const mutation = h.mutations[0]
  assert.equal(mutation.kind, 'delete')
  assert.deepEqual(JSON.parse(JSON.stringify(mutation.filters)), [['id', existing.id], ['name', existing.name], ['created_at', existing.created_at]])
  mutation.resolve({ data: [], error: null }); await h.flush()
  assert.ok(h.text().includes(existing.name))
  assert.match(h.text(), /Não foi possível confirmar a alteração/)
  h.unmount()
})

test('failed initial query is unavailable, while a failed refresh preserves last confirmed list', async () => {
  const h = harness('AdminProjects')
  h.readQueue.push({ data: null, error: { code: '42501', message: 'raw-backend-detail' }, count: null })
  await h.flush()
  assert.match(h.text(), /Lista indisponível/)
  assert.doesNotMatch(h.text(), /0 projetos/)
  safe(h.text())
  h.click('Atualizar projetos'); await h.flush()
  assert.ok(h.text().includes(existing.name))
  h.readQueue.push(Promise.reject(Error('private-token')))
  h.click('Atualizar projetos'); await h.flush()
  assert.ok(h.text().includes(existing.name))
  assert.match(h.text(), /última leitura confirmada/)
  safe(h.text()); h.unmount()
})
