-- Tabela para persistir sessões do James em ambiente serverless (Vercel)
-- A tabela original usava RAM no Express, mas serverless é stateless.
CREATE TABLE IF NOT EXISTS james_sessions (
  session_id TEXT PRIMARY KEY,
  turns JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index para cleanup de sessões expiradas
CREATE INDEX IF NOT EXISTS idx_james_sessions_updated_at ON james_sessions (updated_at);

-- Comentário na tabela
COMMENT ON TABLE james_sessions IS 'Sessões de conversa do James para environment serverless (Vercel). Cada sessão contém array de turns (user/assistant).';
