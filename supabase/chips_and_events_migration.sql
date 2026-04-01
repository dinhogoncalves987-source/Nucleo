-- =====================================================
-- Migration: Chips + System Events
-- Execute no Supabase SQL Editor
-- =====================================================

-- -------------------------------------------------------
-- CHIPS: controle local de instâncias WhatsApp
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS chips (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'paused'
                    CHECK (status IN ('active','alert','paused','critical','warming','connecting','banned')),
  phone             TEXT DEFAULT '',
  warmup_day        INTEGER DEFAULT 0,
  messages_used     INTEGER DEFAULT 0,
  messages_limit    INTEGER DEFAULT 5000,
  temperature_level INTEGER DEFAULT 0,
  last_activity     TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE chips ENABLE ROW LEVEL SECURITY;

-- Política: service role tem acesso total (backend via service key)
CREATE POLICY "Service role full access on chips"
  ON chips FOR ALL
  USING (true)
  WITH CHECK (true);

-- Índices
CREATE INDEX IF NOT EXISTS idx_chips_tenant ON chips(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chips_status ON chips(status);

-- -------------------------------------------------------
-- SYSTEM_EVENTS: event logs do scheduler, warmup, etc.
-- Separado de system_metrics (CPU/RAM) que é para dados de monitoramento
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event      TEXT NOT NULL,
  meta       JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on system_events"
  ON system_events FOR ALL
  USING (true)
  WITH CHECK (true);

-- Índice por evento e data
CREATE INDEX IF NOT EXISTS idx_system_events_event ON system_events(event);
CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events(created_at DESC);

-- -------------------------------------------------------
-- Seed: chips de exemplo para desenvolvimento
-- -------------------------------------------------------
INSERT INTO chips (tenant_id, name, status, messages_used, messages_limit, temperature_level)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Chip Alpha-01',   'active',   3200, 5000, 38),
  ('00000000-0000-0000-0000-000000000001', 'Chip Beta-04',    'alert',    4600, 5000, 72),
  ('00000000-0000-0000-0000-000000000001', 'Chip Gamma-07',   'active',   1800, 5000, 41),
  ('00000000-0000-0000-0000-000000000001', 'Chip Delta-12',   'paused',   5000, 5000, 55),
  ('00000000-0000-0000-0000-000000000001', 'Chip Epsilon-03', 'critical', 4980, 5000, 89),
  ('00000000-0000-0000-0000-000000000001', 'Chip Zeta-08',    'active',   2100, 5000, 44)
ON CONFLICT DO NOTHING;
