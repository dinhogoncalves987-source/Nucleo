import type { NextFunction, Request, RequestHandler, Response } from 'express'

export type JwtVerificationFailure = 'invalid' | 'expired' | 'unavailable'

export interface VerifiedJwtClaims {
  sub: string
  role: 'authenticated'
  aud: string | string[]
  exp: number
}

export interface VerifiedAuthIdentity {
  userId: string
  claims: VerifiedJwtClaims
}

export type JwtVerificationResult =
  | { ok: true; claims: unknown }
  | { ok: false; reason: JwtVerificationFailure }

export type JwtVerifier = (token: string) => Promise<JwtVerificationResult>

const unauthorized = { error: 'Unauthorized' }
const unavailable = { error: 'Service unavailable' }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseBearerAuthorization(values: readonly string[]): string | null {
  if (values.length !== 1) return null

  const match = /^Bearer ([^\s,]+)$/.exec(values[0] ?? '')
  return match?.[1] ?? null
}

function authorizationHeaderValues(req: Request): string[] {
  const values: string[] = []

  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === 'authorization') {
      values.push(req.rawHeaders[index + 1] ?? '')
    }
  }

  return values
}

function validatedClaims(value: unknown): VerifiedJwtClaims | null {
  if (!value || typeof value !== 'object') return null

  const claims = value as Record<string, unknown>
  const audience = claims.aud
  const hasExpectedAudience = audience === 'authenticated'
    || (Array.isArray(audience) && audience.includes('authenticated'))

  if (
    typeof claims.sub !== 'string'
    || !uuidPattern.test(claims.sub)
    || claims.role !== 'authenticated'
    || !hasExpectedAudience
    || typeof claims.exp !== 'number'
    || !Number.isFinite(claims.exp)
    || claims.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null
  }

  return {
    sub: claims.sub,
    role: claims.role,
    aud: audience,
    exp: claims.exp,
  }
}

export function createSupabaseJwtAuth(verifier: JwtVerifier): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = parseBearerAuthorization(authorizationHeaderValues(req))
    if (!token) {
      res.status(401).json(unauthorized)
      return
    }

    let result: JwtVerificationResult
    try {
      result = await verifier(token)
    } catch {
      res.status(503).json(unavailable)
      return
    }

    if (!result.ok) {
      res.status(result.reason === 'unavailable' ? 503 : 401)
        .json(result.reason === 'unavailable' ? unavailable : unauthorized)
      return
    }

    const claims = validatedClaims(result.claims)
    if (!claims) {
      res.status(401).json(unauthorized)
      return
    }

    req.auth = {
      userId: claims.sub,
      claims,
    }
    next()
  }
}
