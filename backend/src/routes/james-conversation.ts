import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { configuredHandler } from '../../../shared/james-integration.cjs'

export const conversationRouter = Router()
conversationRouter.post('/conversation', async (req, res) => {
  const result = await configuredHandler({ env: process.env, createClient })(req)
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json(result.body)
})
