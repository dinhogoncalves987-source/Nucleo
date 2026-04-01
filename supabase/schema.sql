-- =====================================================
-- The Beauty Hub OS — Schema Multi-Tenant (Supabase)
-- Execute este SQL no Supabase SQL Editor
-- =====================================================

-- Enable RLS
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- -------------------------------------------------------
-- TENANTS: ambientes isolados para cada projeto
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- USERS: usuários com vínculo ao tenant
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('superadmin', 'manager', 'operator')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- KNOWLEDGE_BASES: documentos RAG por tenant
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_url    TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- API_KEYS: credenciais de integração por tenant
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,   -- 'whatsapp', 'bubble', 'openai'
  api_key      TEXT NOT NULL,
  webhook_url  TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, service_name)
);

-- -------------------------------------------------------
-- CAMPAIGNS: campanhas de convite WhatsApp
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_template       TEXT NOT NULL,
  send_interval_minutes  INTEGER NOT NULL DEFAULT 5,
  created_at             TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- CONTACTS: contatos importados (VCard / CSV)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT,
  phone      TEXT NOT NULL,
  source     TEXT DEFAULT 'manual',  -- 'vcard', 'csv', 'manual'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- LEADS: prospectos higienizados
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT,
  phone             TEXT NOT NULL,
  source            TEXT DEFAULT 'manual',  -- 'maps', 'instagram', 'csv', 'manual'
  status            TEXT DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','converted','lost')),
  validation_status TEXT DEFAULT 'pending' CHECK (validation_status IN ('pending','valid','invalid')),
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- SALES_FUNNEL_STAGES: etapas do funil por tenant
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_funnel_stages (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  "order"   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- LEAD_FUNNEL_PROGRESS: posição de cada lead no funil
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_funnel_progress (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id              UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sales_funnel_stage_id UUID NOT NULL REFERENCES sales_funnel_stages(id),
  stage_entry_date     TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- FINANCES: faturamento por tenant
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS finances (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount           NUMERIC(12, 2) NOT NULL,
  transaction_date TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- SYSTEM_METRICS: CPU / RAM por tenant
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_metrics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cpu_usage    NUMERIC(5, 2) NOT NULL,
  memory_usage NUMERIC(5, 2) NOT NULL,
  timestamp    TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- ACTIVATION_METRICS: métricas de campanha WhatsApp
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS activation_metrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  opened      BOOLEAN DEFAULT false,
  scheduled   BOOLEAN DEFAULT false,
  timestamp   TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) — Isolamento por tenant
-- -------------------------------------------------------
ALTER TABLE tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_bases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys         ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_funnel_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_funnel_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE finances         ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_metrics   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_metrics ENABLE ROW LEVEL SECURITY;

-- Política exemplo: cada usuário só vê dados do próprio tenant
-- (Requer configuração de auth.jwt() -> tenant_id no Supabase Auth)
-- CREATE POLICY tenant_isolation ON leads
--   USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- -------------------------------------------------------
-- SEED: dados iniciais de demonstração
-- -------------------------------------------------------
INSERT INTO tenants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'The Beauty Hub'),
  ('00000000-0000-0000-0000-000000000002', 'Lavoo')
ON CONFLICT DO NOTHING;
