-- =====================================================
-- Beauty Hub OS — Schema de Afiliados + Asaas
-- Execute no Supabase SQL Editor APÓS fix_rls.sql
-- =====================================================

-- ─── AFFILIATES: tenant referenciador ────────────────────────
CREATE TABLE IF NOT EXISTS affiliates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug          TEXT UNIQUE NOT NULL,
  commission_rate NUMERIC(5,4) DEFAULT 0.01,  -- 1%
  total_referrals INTEGER DEFAULT 0,
  total_gmv     NUMERIC(14,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── AFFILIATE_CLIENTS: clientes vindos via link ─────────────
CREATE TABLE IF NOT EXISTS affiliate_clients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id      UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  client_bubble_id  TEXT NOT NULL,
  client_name       TEXT,
  target_tenant_id  UUID REFERENCES tenants(id),
  joined_at         TIMESTAMPTZ DEFAULT now()
);

-- ─── AFFILIATE_COMMISSIONS: comissões geradas ─────────────────
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id        UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  affiliate_client_id UUID REFERENCES affiliate_clients(id),
  payment_amount      NUMERIC(12,2) NOT NULL,
  commission_amount   NUMERIC(12,2) NOT NULL,
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  asaas_payment_id    TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ─── CASHBACK_BALANCES: saldo por cliente Bubble ─────────────
CREATE TABLE IF NOT EXISTS cashback_balances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_bubble_id TEXT UNIQUE NOT NULL,
  tenant_id       UUID REFERENCES tenants(id),
  balance         NUMERIC(12,2) DEFAULT 0,
  total_earned    NUMERIC(12,2) DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ─── ASAAS_PAYMENTS: eventos do gateway ──────────────────────
CREATE TABLE IF NOT EXISTS asaas_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asaas_id      TEXT UNIQUE NOT NULL,
  tenant_id     UUID REFERENCES tenants(id),
  client_bubble_id TEXT,
  amount        NUMERIC(12,2),
  status        TEXT,
  payment_date  TIMESTAMPTZ,
  processed     BOOLEAN DEFAULT false,
  raw_data      JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── RLS: acesso autenticado ──────────────────────────────────
ALTER TABLE affiliates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_clients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashback_balances    ENABLE ROW LEVEL SECURITY;
ALTER TABLE asaas_payments       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT; pname TEXT;
BEGIN
  FOR tbl, pname IN VALUES
    ('affiliates',            'auth_affiliates'),
    ('affiliate_clients',     'auth_affiliate_clients'),
    ('affiliate_commissions', 'auth_affiliate_commissions'),
    ('cashback_balances',     'auth_cashback_balances'),
    ('asaas_payments',        'auth_asaas_payments')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pname, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
      pname, tbl
    );
  END LOOP;
END $$;

-- ─── FUNCTION: increment affiliate GMV atomically ────────────
CREATE OR REPLACE FUNCTION increment_affiliate_gmv(
  p_affiliate_id UUID,
  p_amount NUMERIC
) RETURNS void AS $$
BEGIN
  UPDATE affiliates
  SET total_gmv = total_gmv + p_amount
  WHERE id = p_affiliate_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── SEED: afiliados iniciais ─────────────────────────────────
INSERT INTO affiliates (tenant_id, slug, commission_rate)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'the-beauty-hub', 0.01),
  ('00000000-0000-0000-0000-000000000002', 'lavoo',           0.01)
ON CONFLICT (slug) DO NOTHING;
