import assert from 'node:assert/strict'
import test from 'node:test'
import { BankerClient, BankerUnavailableError } from '../src/services/banker-client'
const baseUrl = 'http://banker.test'
test('status online', async () => {
  const client = new BankerClient({ baseUrl, fetchImpl: async () => Response.json({ status: 'online' }) })
  assert.deepEqual(await client.status(), { status: 'online' })
})
test('resposta valida normaliza entrada e usa llama3.2', async () => {
  let body = ''
  const client = new BankerClient({ baseUrl, fetchImpl: async (_url, init) => {
    body = String(init?.body)
    return Response.json({ agente: 'banker', modelo: 'llama3.2', resposta: ' resposta ' })
  } })
  assert.deepEqual(await client.chat(' mensagem '), { agente: 'banker', modelo: 'llama3.2', resposta: 'resposta' })
  assert.deepEqual(JSON.parse(body), { message: 'mensagem', modelo: 'llama3.2' })
})
test('timeout vira erro sanitizado', async () => {
  const client = new BankerClient({ baseUrl, timeoutMs: 5, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  }) })
  await assert.rejects(() => client.chat('mensagem'), BankerUnavailableError)
})
test('resposta invalida vira erro sanitizado', async () => {
  const client = new BankerClient({ baseUrl, fetchImpl: async () => Response.json({ resposta: 123 }) })
  await assert.rejects(() => client.chat('mensagem'), BankerUnavailableError)
})
test('Banker indisponivel vira erro sanitizado', async () => {
  const client = new BankerClient({ baseUrl, fetchImpl: async () => { throw new Error('detalhe sensivel de rede') } })
  await assert.rejects(() => client.chat('mensagem'), (error: unknown) => error instanceof BankerUnavailableError && error.message === 'Banker indisponivel')
})
