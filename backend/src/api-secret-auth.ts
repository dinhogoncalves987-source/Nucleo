import { timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'

const unauthorized = { error: 'Unauthorized' }
const unavailable = { error: 'Service unavailable' }

export function createApiSecretAuth(configuredSecret: string | undefined): RequestHandler {
  const configured = configuredSecret ? Buffer.from(configuredSecret, 'utf8') : null

  return (req, res, next) => {
    if (!configured?.length) {
      res.status(503).json(unavailable)
      return
    }

    const receivedSecret = req.get('x-api-secret')
    if (!receivedSecret) {
      res.status(401).json(unauthorized)
      return
    }

    const received = Buffer.from(receivedSecret, 'utf8')
    if (received.length !== configured.length || !timingSafeEqual(received, configured)) {
      res.status(401).json(unauthorized)
      return
    }

    next()
  }
}
