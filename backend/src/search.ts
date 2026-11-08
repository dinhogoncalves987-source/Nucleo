import express from 'express'
import axios from 'axios'
import { createSearchHandlers } from './public-search'
import type { SearchEnv, Transport } from './public-search'

// server.ts verifies JWT and resolves tenant before mounting this router.
// Handlers also fail closed without that trusted authentication context.
export function createSearchRouter(options: { env?: SearchEnv; transport?: Transport } = {}) {
  const router = express.Router()
  const handlers = createSearchHandlers({
    env: options.env || process.env,
    transport: options.transport || ((url, config) => axios.get(url, config))
  })
  router.use(handlers.guard)
  router.get('/capabilities', handlers.capabilities)
  router.post('/', handlers.search)
  return router
}
export const router = createSearchRouter()
