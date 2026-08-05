import type { VerifiedAuthIdentity } from '../auth/jwt-auth'

declare global {
  namespace Express {
    interface Request {
      auth?: VerifiedAuthIdentity
    }
  }
}

export {}
