-- ============================================================
-- james_memories: memória persistente do James
-- Guarda cada interação para aprendizado contínuo
-- ============================================================
CREATE TABLE IF NOT EXISTS james_memories (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  timestamptz DEFAULT now(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  speaker     text NOT NULL CHECK (speaker IN ('edson','cliente','estabelecimento','sistema')),
  category    text, -- 'negociacao','cliente','operacao','aprendizado','mercado' etc.
  input       text NOT NULL,   -- o que foi dito/perguntado
  response    text NOT NULL,   -- o que James respondeu
  tags        text[],          -- ['beleza','contrato','ingles','calculo'] etc.
  important   boolean DEFAULT false  -- marcado quando Edson disser "lembra disso"
);

-- Índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_james_memories_created  ON james_memories (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_james_memories_tenant   ON james_memories (tenant_id);
CREATE INDEX IF NOT EXISTS idx_james_memories_category ON james_memories (category);
CREATE INDEX IF NOT EXISTS idx_james_memories_important ON james_memories (important) WHERE important = true;

-- Busca por texto livre (para buscar memórias relevantes)
CREATE INDEX IF NOT EXISTS idx_james_memories_text ON james_memories
  USING gin(to_tsvector('portuguese', input || ' ' || response));

-- RLS
ALTER TABLE james_memories ENABLE ROW LEVEL SECURITY;

-- Since tenants table has no user_id column, allow access to authenticated users only
-- (tighten this once user-tenant linkage is established)
CREATE POLICY "james_memories_auth" ON james_memories
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Função para buscar memórias relevantes por texto
CREATE OR REPLACE FUNCTION search_james_memories(query text, limit_count int DEFAULT 5)
RETURNS TABLE(input text, response text, category text, created_at timestamptz) AS $$
  SELECT m.input, m.response, m.category, m.created_at
  FROM james_memories m
  WHERE to_tsvector('portuguese', m.input || ' ' || m.response) @@ plainto_tsquery('portuguese', query)
  ORDER BY m.important DESC, m.created_at DESC
  LIMIT limit_count;
$$ LANGUAGE sql SECURITY DEFINER;
