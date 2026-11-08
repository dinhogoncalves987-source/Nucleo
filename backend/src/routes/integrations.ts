import { Router } from 'express'
import axios from 'axios'
import { supabase } from '../server'

export const router = Router()
const allowedServices = new Set(['whatsapp', 'bubble', 'openai'])

router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('api_keys')
    .select('service_name, webhook_url').eq('tenant_id', req.auth!.tenantId!)
  if (error) { res.status(500).json({ error: 'Falha ao consultar integracoes' }); return }
  res.json((data ?? []).map(row => ({ ...row, configured: true })))
})

router.put('/:service', async (req, res) => {
  if (!['superadmin', 'manager'].includes(req.auth?.appRole ?? '')) {
    res.status(403).json({ error: 'Permissao insuficiente' }); return
  }
  const service = req.params.service
  if (!allowedServices.has(service)) { res.status(400).json({ error: 'Integracao invalida' }); return }
  const { apiKey, webhookUrl } = req.body as { apiKey?: string; webhookUrl?: string }
  if (!apiKey?.trim()) { res.status(400).json({ error: 'Chave obrigatoria' }); return }
  const { error } = await supabase.from('api_keys').upsert({
    tenant_id: req.auth!.tenantId!, service_name: service,
    api_key: apiKey.trim(), webhook_url: webhookUrl?.trim() || null,
  }, { onConflict: 'tenant_id,service_name' })
  if (error) { res.status(500).json({ error: 'Falha ao salvar integracao' }); return }
  res.json({ service, configured: true })
})

router.all('/bubble/*', async (req, res) => {
  const suffix = (req.params as Record<string, string>)['0'] ?? ''
  if (!/^(obj|wf|meta)(\/[-A-Za-z0-9_]+)*$/.test(suffix)) {
    res.status(400).json({ error: 'Caminho Bubble invalido' }); return
  }
  const { data } = await supabase.from('api_keys').select('api_key')
    .eq('tenant_id', req.auth!.tenantId!).eq('service_name', 'bubble').maybeSingle()
  const token = data?.api_key || process.env.BUBBLE_API_TOKEN
  if (!token) { res.status(503).json({ error: 'Bubble nao configurado' }); return }
  try {
    const response = await axios.request({
      method: req.method, url: `${process.env.BUBBLE_API_URL ?? 'https://thebeautyhub.com.br/api/1.1'}/${suffix}`,
      params: req.query, data: req.body, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
    })
    res.status(response.status).json(response.data)
  } catch { res.status(502).json({ error: 'Falha na integracao Bubble' }) }
})
