// ============================================================
// asaas.ts — Gateway de Pagamento Asaas (FINTECH MODE)
// Regra dos 3%: 1% Afiliado + 1% Cashback + 1% Plataforma
// Idempotência: cada payment_id processado apenas UMA vez
// ============================================================

import { supabase } from './supabase'

// ─── Constantes financeiras ───────────────────────────────────
export const RATES = {
  AFFILIATE:   0.01,  // 1% para o afiliado originador
  CASHBACK:    0.01,  // 1% para o cliente (fidelização)
  PLATFORM:    0.01,  // 1% para a Plataforma Beauty Hub
} as const

// ─── Types ────────────────────────────────────────────────────
export interface AsaasPayment {
  id: string            // Asaas payment ID (ex: "pay_abc123")
  customer: string      // Asaas customer ID
  value: number         // valor em BRL
  status: 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'OVERDUE' | 'REFUNDED' | 'CANCELLED'
  paymentDate: string   // YYYY-MM-DD
  dueDate: string
  description?: string
  externalReference?: string  // formato: "tenant_id:client_bubble_id"
}

export interface AsaasWebhookEvent {
  event: 'PAYMENT_RECEIVED' | 'PAYMENT_CONFIRMED' | 'PAYMENT_UPDATED' | 'PAYMENT_DELETED' | 'PAYMENT_OVERDUE'
  payment: AsaasPayment
}

export interface ProcessResult {
  success: boolean
  idempotent?: boolean      // true = já foi processado antes
  affiliateCommission: number
  clientCashback: number
  platformFee: number
  message: string
}

// ─── Idempotência: verifica se já processamos esse pagamento ──
async function isAlreadyProcessed(asaasId: string): Promise<boolean> {
  const { data } = await supabase
    .from('asaas_payments')
    .select('id, processed')
    .eq('asaas_id', asaasId)
    .maybeSingle()
  return data?.processed === true
}

// ─── Core: Processa evento de pagamento confirmado ────────────
export async function processAsaasPayment(event: AsaasWebhookEvent): Promise<ProcessResult> {
  const { payment } = event
  const zero = { affiliateCommission: 0, clientCashback: 0, platformFee: 0 }

  // Só processa confirmações de pagamento
  if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event.event)) {
    return { success: true, ...zero, message: `Evento ${event.event} ignorado.` }
  }

  // IDEMPOTÊNCIA: verifica antes de qualquer operação
  if (await isAlreadyProcessed(payment.id)) {
    return {
      success: true,
      idempotent: true,
      ...zero,
      message: `Pagamento ${payment.id} já foi processado. Operação ignorada.`,
    }
  }

  // 1) Registra o evento RAW (not processed yet)
  await supabase.from('asaas_payments').upsert({
    asaas_id:    payment.id,
    amount:      payment.value,
    status:      payment.status,
    payment_date: payment.paymentDate,
    processed:   false,
    raw_data:    payment,
  }, { onConflict: 'asaas_id' })

  // 2) Parse externalReference → tenant_id:client_bubble_id
  const ref = payment.externalReference ?? ':'
  const colonIdx = ref.indexOf(':')
  const tenantId       = colonIdx >= 0 ? ref.slice(0, colonIdx) : ''
  const clientBubbleId = colonIdx >= 0 ? ref.slice(colonIdx + 1) : ''

  const amount = payment.value
  const affiliateCommission = amount * RATES.AFFILIATE
  const clientCashback      = amount * RATES.CASHBACK
  const platformFee         = amount * RATES.PLATFORM

  // 3) Atualiza cashback do cliente (1%)
  if (clientBubbleId) {
    const { data: cb } = await supabase
      .from('cashback_balances')
      .select('id, balance, total_earned')
      .eq('client_bubble_id', clientBubbleId)
      .maybeSingle()

    if (cb) {
      await supabase.from('cashback_balances').update({
        balance:      Number(cb.balance)      + clientCashback,
        total_earned: Number(cb.total_earned) + clientCashback,
        updated_at:   new Date().toISOString(),
      }).eq('id', cb.id)
    } else {
      await supabase.from('cashback_balances').insert({
        client_bubble_id: clientBubbleId,
        tenant_id: tenantId || null,
        balance:     clientCashback,
        total_earned: clientCashback,
      })
    }
  }

  // 4) Verifica se cliente veio via afiliado → crédita comissão (1%)
  if (clientBubbleId) {
    const { data: affClient } = await supabase
      .from('affiliate_clients')
      .select('id, affiliate_id, referred_by_tenant_id')
      .eq('client_bubble_id', clientBubbleId)
      .maybeSingle()

    if (affClient) {
      // Comissão de 1% para o afiliado
      await supabase.from('affiliate_commissions').insert({
        affiliate_id:        affClient.affiliate_id,
        affiliate_client_id: affClient.id,
        payment_amount:      amount,
        commission_amount:   affiliateCommission,
        platform_fee:        platformFee,
        status:              'pending',
        asaas_payment_id:    payment.id,
      })

      // Incrementa GMV do afiliado atomicamente
      await supabase.rpc('increment_affiliate_gmv', {
        p_affiliate_id: affClient.affiliate_id,
        p_amount:       amount,
      })
    }
  }

  // 5) Marca como processado — garante que futuras chamadas sejam idempotentes
  await supabase
    .from('asaas_payments')
    .update({ processed: true, tenant_id: tenantId || null, client_bubble_id: clientBubbleId || null })
    .eq('asaas_id', payment.id)

  return {
    success: true,
    affiliateCommission,
    clientCashback,
    platformFee,
    message: `✅ Pay ${payment.id} · Afiliado: R$${affiliateCommission.toFixed(2)} · Cashback: R$${clientCashback.toFixed(2)} · Taxa: R$${platformFee.toFixed(2)}`,
  }
}

// ─── Consulta saldo de cashback ───────────────────────────────
export async function getCashbackBalance(clientBubbleId: string): Promise<number> {
  const { data } = await supabase
    .from('cashback_balances')
    .select('balance')
    .eq('client_bubble_id', clientBubbleId)
    .maybeSingle()
  return Number(data?.balance ?? 0)
}

// ─── Criação de evento de teste (dev/demo) ────────────────────
export function createMockAsaasEvent(
  tenantId: string,
  clientBubbleId: string,
  amount: number
): AsaasWebhookEvent {
  return {
    event: 'PAYMENT_CONFIRMED',
    payment: {
      id:          `pay_demo_${Date.now()}`,
      customer:    'cus_demo',
      value:       amount,
      status:      'CONFIRMED',
      paymentDate: new Date().toISOString().slice(0, 10),
      dueDate:     new Date().toISOString().slice(0, 10),
      description: 'Agendamento Beauty Hub',
      externalReference: `${tenantId}:${clientBubbleId}`,
    },
  }
}
