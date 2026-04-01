// ============================================================
// asaas.ts — Integração Asaas (Subcontas + Split + Cashback)
// Beauty Hub OS Backend
// ============================================================
import 'dotenv/config'
import express from 'express'
import axios, { AxiosInstance } from 'axios'
import { createClient } from '@supabase/supabase-js'
import { logger } from './logger'

export const router = express.Router()

// ── Supabase (service key para operações privilegiadas) ────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Asaas API client ───────────────────────────────────────────
const ASAAS_BASE = process.env.ASAAS_SANDBOX === 'true'
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/api/v3'

const PLATFORM_FEE    = Number(process.env.ASAAS_PLATFORM_FEE  ?? 0.10) // 10%
const CASHBACK_RATE   = Number(process.env.ASAAS_CASHBACK_RATE ?? 0.03) // 3%

function asaasClient(apiKey?: string): AxiosInstance {
  return axios.create({
    baseURL: ASAAS_BASE,
    headers: {
      'access_token': apiKey ?? process.env.ASAAS_API_KEY!,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  })
}

// ────────────────────────────────────────────────────────────────
// HELPER: busca a subconta do tenant no Supabase
// ────────────────────────────────────────────────────────────────
async function getTenantAsaasId(tenantId: string): Promise<string | null> {
  const { data } = await supabase
    .from('asaas_accounts')
    .select('asaas_account_id')
    .eq('tenant_id', tenantId)
    .single()
  return data?.asaas_account_id ?? null
}

// ────────────────────────────────────────────────────────────────
// POST /api/asaas/accounts — Cria subconta para estabelecimento
// Body: { tenantId, name, cpfCnpj, email, phone?, mobilePhone? }
// ────────────────────────────────────────────────────────────────
router.post('/accounts', async (req, res) => {
  const { tenantId, name, cpfCnpj, email, phone, mobilePhone } = req.body

  if (!tenantId || !name || !cpfCnpj || !email) {
    res.status(400).json({ error: 'tenantId, name, cpfCnpj e email são obrigatórios' })
    return
  }

  try {
    // Verificar se já existe
    const existing = await getTenantAsaasId(tenantId)
    if (existing) {
      res.json({ success: true, asaasAccountId: existing, alreadyExists: true })
      return
    }

    const client = asaasClient()
    const { data: account } = await client.post('/accounts', {
      name,
      cpfCnpj: cpfCnpj.replace(/\D/g, ''),
      email,
      phone,
      mobilePhone,
      companyType: 'MEI', // sobrescrito pelo usuário se precisar
    })

    // Salvar no Supabase
    const { error } = await supabase.from('asaas_accounts').insert({
      tenant_id:         tenantId,
      asaas_account_id:  account.id,
      wallet_id:         account.walletId,
      api_key:           account.apiKey, // subconta tem chave própria
    })

    if (error) throw error

    logger.info('Subconta Asaas criada', { tenantId, asaasId: account.id })
    res.json({ success: true, asaasAccountId: account.id, walletId: account.walletId })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Erro ao criar subconta Asaas', { err: msg, tenantId })
    res.status(500).json({ error: msg })
  }
})

// ────────────────────────────────────────────────────────────────
// POST /api/asaas/charges — Cria cobrança com split automático
// Body: {
//   tenantId, clientBubbleId, amount, billingType,
//   dueDate?, description?, affiliateSlug?,
//   customerName, customerCpfCnpj, customerEmail
// }
// ────────────────────────────────────────────────────────────────
router.post('/charges', async (req, res) => {
  const {
    tenantId, clientBubbleId, amount, billingType = 'PIX',
    dueDate, description, affiliateSlug,
    customerName, customerCpfCnpj, customerEmail,
  } = req.body

  if (!tenantId || !clientBubbleId || !amount || !customerCpfCnpj) {
    res.status(400).json({ error: 'tenantId, clientBubbleId, amount, customerCpfCnpj são obrigatórios' })
    return
  }

  try {
    const client = asaasClient()

    // 1. Criar/buscar customer no Asaas
    const { data: customerSearch } = await client.get('/customers', {
      params: { cpfCnpj: customerCpfCnpj.replace(/\D/g, '') },
    })

    let customerId: string
    if (customerSearch.data?.length > 0) {
      customerId = customerSearch.data[0].id
    } else {
      const { data: newCustomer } = await client.post('/customers', {
        name:     customerName ?? 'Cliente Beauty Hub',
        cpfCnpj:  customerCpfCnpj.replace(/\D/g, ''),
        email:    customerEmail,
      })
      customerId = newCustomer.id
    }

    // 2. Calcular split
    const platformAmount = +(amount * PLATFORM_FEE).toFixed(2)
    let   affiliateAmount = 0

    // Buscar comissão do afiliado se informado
    if (affiliateSlug) {
      const { data: aff } = await supabase
        .from('affiliates')
        .select('id, commission_rate')
        .eq('slug', affiliateSlug)
        .single()
      if (aff) {
        affiliateAmount = +(amount * Number(aff.commission_rate)).toFixed(2)
      }
    }

    // 3. Buscar walletId da plataforma principal (conta master)
    // Asaas split: definido via "split" array na cobrança
    const splits = [
      {
        walletId:   process.env.ASAAS_PLATFORM_WALLET_ID!, // wallet master
        fixedValue: platformAmount,
      },
    ]

    // 4. Criar cobrança
    const chargePayload = {
      customer:    customerId,
      billingType, // PIX | CREDIT_CARD | BOLETO | DEBIT_CARD
      value:       amount,
      dueDate:     dueDate ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: description ?? 'Agendamento Beauty Hub',
      split:       splits,
      postalService: false,
    }

    const { data: charge } = await client.post('/payments', chargePayload)

    // 5. Registrar no Supabase
    await supabase.from('asaas_payments').insert({
      asaas_id:          charge.id,
      tenant_id:         tenantId,
      client_bubble_id:  clientBubbleId,
      amount:            amount,
      status:            charge.status,
      payment_date:      charge.dueDate,
      raw_data:          charge,
    })

    // 6. Registrar comissão pendente do afiliado
    if (affiliateSlug && affiliateAmount > 0) {
      const { data: aff } = await supabase
        .from('affiliates')
        .select('id')
        .eq('slug', affiliateSlug)
        .single()
      if (aff) {
        await supabase.from('affiliate_commissions').insert({
          affiliate_id:    aff.id,
          payment_amount:  amount,
          commission_amount: affiliateAmount,
          status:          'pending',
          asaas_payment_id: charge.id,
        })
      }
    }

    logger.info('Cobrança criada', { chargeId: charge.id, amount, billingType })

    // 7. Retornar link Pix / URL de pagamento
    res.json({
      success:   true,
      chargeId:  charge.id,
      status:    charge.status,
      paymentLink:    charge.invoiceUrl,
      pixQrCode:      charge.pix?.qrCode           ?? null,
      pixCopiaECola:  charge.pix?.payload           ?? null,
      boletoUrl:      charge.bankSlipUrl             ?? null,
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Erro ao criar cobrança', { err: msg, tenantId })
    res.status(500).json({ error: msg })
  }
})

// ────────────────────────────────────────────────────────────────
// GET /api/asaas/balance/:tenantId — Saldo da subconta
// ────────────────────────────────────────────────────────────────
router.get('/balance/:tenantId', async (req, res) => {
  const { tenantId } = req.params
  try {
    // Buscar api_key da subconta
    const { data: acc } = await supabase
      .from('asaas_accounts')
      .select('api_key')
      .eq('tenant_id', tenantId)
      .single()

    if (!acc) {
      res.status(404).json({ error: 'Subconta não encontrada para este tenant' })
      return
    }

    const client = asaasClient(acc.api_key)
    const { data: balance } = await client.get('/finance/balance')
    res.json({ tenantId, balance: balance.balance })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})

// ────────────────────────────────────────────────────────────────
// GET /api/asaas/cashback/:clientBubbleId — Saldo de cashback
// ────────────────────────────────────────────────────────────────
router.get('/cashback/:clientBubbleId', async (req, res) => {
  const { clientBubbleId } = req.params
  const { data } = await supabase
    .from('cashback_balances')
    .select('balance, total_earned')
    .eq('client_bubble_id', clientBubbleId)
    .single()
  res.json({ clientBubbleId, balance: data?.balance ?? 0, totalEarned: data?.total_earned ?? 0 })
})

// ────────────────────────────────────────────────────────────────
// POST /webhook/asaas — Recebe eventos do Asaas (sem auth, raw)
// Registrar em server.ts FORA do middleware de auth
// ────────────────────────────────────────────────────────────────
export async function handleAsaasWebhook(
  req: express.Request,
  res: express.Response
): Promise<void> {
  const { event, payment } = req.body

  if (!payment?.id) { res.json({ ok: true }); return }

  logger.info('Webhook Asaas', { event, paymentId: payment.id })

  // Idempotência
  const { data: existing } = await supabase
    .from('asaas_payments')
    .select('id, processed')
    .eq('asaas_id', payment.id)
    .single()

  if (!existing) { res.json({ ok: true }); return }
  if (existing.processed && event === 'PAYMENT_RECEIVED') {
    res.json({ ok: true, skipped: true }); return
  }

  // Atualizar status
  await supabase
    .from('asaas_payments')
    .update({ status: payment.status, processed: event === 'PAYMENT_RECEIVED' })
    .eq('asaas_id', payment.id)

  if (event === 'PAYMENT_RECEIVED') {
    // 1. Creditar cashback para o cliente
    const cashbackAmount = +(payment.value * CASHBACK_RATE).toFixed(2)

    if (existing && cashbackAmount > 0) {
      // Buscar clientBubbleId
      const { data: payRec } = await supabase
        .from('asaas_payments')
        .select('client_bubble_id, tenant_id')
        .eq('asaas_id', payment.id)
        .single()

      if (payRec?.client_bubble_id) {
        await supabase.rpc('upsert_cashback', {
          p_client_bubble_id: payRec.client_bubble_id,
          p_tenant_id:        payRec.tenant_id,
          p_amount:           cashbackAmount,
        })
        logger.info('Cashback creditado', { client: payRec.client_bubble_id, amount: cashbackAmount })
      }
    }

    // 2. Confirmar comissão do afiliado
    await supabase
      .from('affiliate_commissions')
      .update({ status: 'paid' })
      .eq('asaas_payment_id', payment.id)
      .eq('status', 'pending')

    logger.info('Pagamento processado', { paymentId: payment.id, value: payment.value })
  }

  if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK') {
    // Reverter cashback e comissão
    await supabase
      .from('affiliate_commissions')
      .update({ status: 'cancelled' })
      .eq('asaas_payment_id', payment.id)
    logger.warn('Pagamento estornado/chargeback', { paymentId: payment.id })
  }

  res.json({ ok: true, event, paymentId: payment.id })
}
