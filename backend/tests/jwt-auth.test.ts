import assert from 'node:assert/strict'
import test from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import {
  createSupabaseJwtAuth,
  type JwtVerifier,
} from '../src/auth/jwt-auth'

const validUserId = '123e4567-e89b-12d3-a456-426614174000'
const inertToken = 'synthetic.token.value'

interface InvocationResult {
  status?: number
  body?: unknown
  continued: boolean
  auth: Request['auth']
}

function verifiedClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: validUserId,
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
}

async function invoke(
  authorizationValues: readonly string[],
  verifier: JwtVerifier,
  extraHeaders: readonly string[] = [],
): Promise<InvocationResult> {
  const rawHeaders = authorizationValues.flatMap(value => ['Authorization', value])
  rawHeaders.push(...extraHeaders)

  const req = { rawHeaders } as Request
  const result: InvocationResult = { continued: false, auth: undefined }
  const res = {
    status(code: number) {
      result.status = code
      return this
    },
    json(body: unknown) {
      result.body = body
      return this
    },
  } as Response
  const next: NextFunction = () => {
    result.continued = true
  }

  await createSupabaseJwtAuth(verifier)(req, res, next)
  result.auth = req.auth
  return result
}

const validVerifier: JwtVerifier = async () => ({ ok: true, claims: verifiedClaims() })

test('1. Authorization ausente retorna 401', async () => {
  assert.equal((await invoke([], validVerifier)).status, 401)
})

test('2. esquema diferente de Bearer retorna 401', async () => {
  assert.equal((await invoke([`Basic ${inertToken}`], validVerifier)).status, 401)
})

test('3. Bearer vazio retorna 401', async () => {
  assert.equal((await invoke(['Bearer '], validVerifier)).status, 401)
})

test('4. Authorization duplicado retorna 401', async () => {
  assert.equal((await invoke([`Bearer ${inertToken}`, `Bearer ${inertToken}`], validVerifier)).status, 401)
})

test('5. token inválido retorna 401', async () => {
  const verifier: JwtVerifier = async () => ({ ok: false, reason: 'invalid' })
  assert.equal((await invoke([`Bearer ${inertToken}`], verifier)).status, 401)
})

test('6. token expirado retorna 401', async () => {
  const verifier: JwtVerifier = async () => ({ ok: false, reason: 'expired' })
  assert.equal((await invoke([`Bearer ${inertToken}`], verifier)).status, 401)
})

test('7. claims sem sub retornam 401', async () => {
  const verifier: JwtVerifier = async () => ({ ok: true, claims: verifiedClaims({ sub: undefined }) })
  assert.equal((await invoke([`Bearer ${inertToken}`], verifier)).status, 401)
})

test('8. sub inválido retorna 401', async () => {
  const verifier: JwtVerifier = async () => ({ ok: true, claims: verifiedClaims({ sub: 'not-a-uuid' }) })
  assert.equal((await invoke([`Bearer ${inertToken}`], verifier)).status, 401)
})

test('9. falha interna do verificador retorna 503', async () => {
  const verifier: JwtVerifier = async () => { throw new Error('synthetic failure') }
  assert.equal((await invoke([`Bearer ${inertToken}`], verifier)).status, 503)
})

test('10. token válido anexa identidade e chama next', async () => {
  const result = await invoke([`Bearer ${inertToken}`], validVerifier)
  assert.equal(result.continued, true)
  assert.equal(result.auth?.userId, validUserId)
  assert.equal(result.auth?.claims.sub, validUserId)
})

test('11. x-api-secret não funciona como fallback', async () => {
  const result = await invoke([], validVerifier, ['x-api-secret', 'synthetic-inert-secret'])
  assert.equal(result.status, 401)
  assert.equal(result.continued, false)
})
