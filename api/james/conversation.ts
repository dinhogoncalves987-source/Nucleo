import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { configuredHandler } from '../../shared/james-integration.cjs'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const result = await configuredHandler({ env: process.env, createClient })(req)
  res.status(result.status).json(result.body)
}
