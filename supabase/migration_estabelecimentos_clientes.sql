-- =====================================================
-- Migração: campos para suportar Estabelecimentos e Clientes
-- Execute no Supabase SQL Editor
-- =====================================================

-- TENANTS → Estabelecimentos (campos extras)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone   TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS segment TEXT DEFAULT 'salao'
  CHECK (segment IN ('salao','clinica','barbearia','estetica','outro'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status  TEXT DEFAULT 'pendente'
  CHECK (status IN ('pendente','ativo','inativo'));

-- CONTACTS → Clientes (campos extras)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email         TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tenant_origin UUID REFERENCES tenants(id);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'novo'
  CHECK (status IN ('novo','ativo','recorrente','inativo'));
