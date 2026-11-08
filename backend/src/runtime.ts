import type { RequestHandler } from 'express'

// Fail-safe: operacao real so e habilitada por uma escolha explicita.
export const isDemoMode = process.env.DEMO_MODE !== 'false'

const blocked = { error: 'Acao bloqueada no modo demo', demo: true }

export const demoMutationGuard: RequestHandler = (req, res, next) => {
  if (!isDemoMode || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return }
  const blockedPrefixes = ['/api/asaas', '/api/chips', '/api/queue', '/api/scheduler', '/api/integrations/bubble/wf']
  if (blockedPrefixes.some(prefix => req.path.startsWith(prefix))) {
    res.status(423).json(blocked); return
  }
  next()
}
