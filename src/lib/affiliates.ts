// ============================================================
// affiliates.ts — Gerador de Links Dinâmicos de Afiliado
// Beauty Hub OS · O cérebro que comanda a rede Bubble
// ============================================================

import { supabase } from './supabase'

// URL base do Bubble onde os agendamentos acontecem
const BUBBLE_BASE_URL =
  import.meta.env.VITE_BUBBLE_APP_URL ?? 'https://thebeautyhub.com.br'

// ─── Types ────────────────────────────────────────────────────
export interface Affiliate {
  id: string
  tenant_id: string
  slug: string
  commission_rate: number
  total_referrals: number
  total_gmv: number
  created_at: string
}

export interface AffiliateClient {
  id: string
  affiliate_id: string
  client_bubble_id: string
  client_name: string | null
  target_tenant_id: string | null
  joined_at: string
}

export interface AffiliateCommission {
  id: string
  affiliate_id: string
  affiliate_client_id: string | null
  payment_amount: number
  commission_amount: number
  status: 'pending' | 'paid' | 'cancelled'
  asaas_payment_id: string | null
  created_at: string
}

// ─── Slug Generation ─────────────────────────────────────────
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

// ─── Get or Create Affiliate Slug for a Tenant ───────────────
export async function getOrCreateAffiliate(
  tenantId: string,
  tenantName: string
): Promise<Affiliate | null> {
  // Try to get existing
  const { data: existing } = await supabase
    .from('affiliates')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (existing) return existing as Affiliate

  // Create new
  const slug = toSlug(tenantName)
  const { data, error } = await supabase
    .from('affiliates')
    .insert({
      tenant_id: tenantId,
      slug,
      commission_rate: 0.01, // 1%
      total_referrals: 0,
      total_gmv: 0,
    })
    .select()
    .single()

  if (error || !data) return null
  return data as Affiliate
}

// ─── Generate Affiliate Link ──────────────────────────────────
export function generateAffiliateLink(
  slug: string,
  campaign?: string
): string {
  const params = new URLSearchParams({ ref: slug })
  if (campaign) params.set('utm_campaign', campaign)
  return `${BUBBLE_BASE_URL}/agendar?${params.toString()}`
}

// ─── Register Client via Affiliate ───────────────────────────
export async function registerAffiliateClient(
  affiliateId: string,
  clientBubbleId: string,
  clientName: string,
  targetTenantId?: string
): Promise<boolean> {
  const { error } = await supabase.from('affiliate_clients').insert({
    affiliate_id: affiliateId,
    client_bubble_id: clientBubbleId,
    client_name: clientName,
    target_tenant_id: targetTenantId ?? null,
  })
  return !error
}

// ─── Get Affiliate Audit Data (SuperAdmin) ────────────────────
export interface AffiliateAuditRow {
  tenant_name: string
  slug: string
  total_referrals: number
  total_gmv: number
  commission_earned: number // 1% of GMV
  commission_pending: number
}

export async function getAffiliateAuditData(): Promise<AffiliateAuditRow[]> {
  // Fetch affiliates joined with tenants
  const { data: affiliates } = await supabase
    .from('affiliates')
    .select(`
      id, slug, commission_rate, total_referrals, total_gmv,
      tenants!affiliates_tenant_id_fkey(name)
    `)
    .order('total_gmv', { ascending: false })

  if (!affiliates?.length) return []

  // Fetch commissions for each affiliate
  const { data: commissions } = await supabase
    .from('affiliate_commissions')
    .select('affiliate_id, commission_amount, status')

  const commMap: Record<string, { earned: number; pending: number }> = {}
  for (const c of (commissions ?? [])) {
    if (!commMap[c.affiliate_id]) commMap[c.affiliate_id] = { earned: 0, pending: 0 }
    if (c.status === 'paid') commMap[c.affiliate_id].earned += Number(c.commission_amount)
    else if (c.status === 'pending') commMap[c.affiliate_id].pending += Number(c.commission_amount)
  }

  return affiliates.map(a => {
    const tenantRaw = a.tenants as unknown
    const tenantObj = (Array.isArray(tenantRaw) ? tenantRaw[0] : tenantRaw) as { name?: string } | null
    return {
      tenant_name: tenantObj?.name ?? 'Desconhecido',
      slug: a.slug,
      total_referrals: a.total_referrals ?? 0,
      total_gmv: Number(a.total_gmv ?? 0),
      commission_earned: commMap[a.id]?.earned ?? 0,
      commission_pending: commMap[a.id]?.pending ?? 0,
    }
  })
}
