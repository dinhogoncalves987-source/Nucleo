// One Vercel entrypoint for the existing generation routes. Each handler retains
// its own auth and method guards; no provider is imported for an unknown route.
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Use the URL path, never client-supplied query/body fields, for dispatch.
  const path = (req.url ?? '').split('?')[0].replace(/\/$/, '')
  switch (path) {
    case '/api/james/generate/affiliate-opportunities':
      return (await import('../../../server-handlers/generate/affiliate-opportunities')).default(req, res)
    case '/api/james/generate/batch-messages':
      return (await import('../../../server-handlers/generate/batch-messages')).default(req, res)
    case '/api/james/generate/extract-contact':
      return (await import('../../../server-handlers/generate/extract-contact')).default(req, res)
    case '/api/james/generate/health':
      return (await import('../../../server-handlers/generate/health')).default(req, res)
    case '/api/james/generate/promo-suggestion':
      return (await import('../../../server-handlers/generate/promo-suggestion')).default(req, res)
    case '/api/james/generate/rescue-message':
      return (await import('../../../server-handlers/generate/rescue-message')).default(req, res)
    default:
      return res.status(404).json({ error: 'Not found' })
  }
}
