import {
  isAuthError,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from '@supabase/supabase-js'
import type { JwtVerificationFailure, JwtVerifier } from './jwt-auth'

type ClaimsAuthClient = Pick<SupabaseClient['auth'], 'getClaims'>

function classifyAuthFailure(error: { message: string; status?: number }): JwtVerificationFailure {
  if (isAuthRetryableFetchError(error) || (error.status !== undefined && error.status >= 500)) {
    return 'unavailable'
  }

  return /expir/i.test(error.message) ? 'expired' : 'invalid'
}

export function createSupabaseClaimsVerifier(auth: ClaimsAuthClient): JwtVerifier {
  return async token => {
    try {
      const { data, error } = await auth.getClaims(token)

      if (error) {
        return { ok: false, reason: classifyAuthFailure(error) }
      }
      if (!data?.claims) {
        return { ok: false, reason: 'invalid' }
      }

      return { ok: true, claims: data.claims }
    } catch (error: unknown) {
      if (isAuthError(error)) {
        return { ok: false, reason: classifyAuthFailure(error) }
      }
      return { ok: false, reason: 'unavailable' }
    }
  }
}
