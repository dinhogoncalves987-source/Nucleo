-- =====================================================
-- Beauty Hub OS — Correção de Políticas RLS
-- Execute este SQL no Supabase SQL Editor
-- (Project: oehjrasezdqsklhwscza → SQL Editor → New Query)
-- =====================================================

-- Permite que usuários autenticados acessem/escrevam dados de qualquer tenant.
-- Para produção, trocar USING(true) por USING(tenant_id = auth.jwt()->>'tenant_id'::uuid)

DO $$
DECLARE
  tbl TEXT;
  pname TEXT;
BEGIN
  FOR tbl, pname IN VALUES
    ('leads',                    'allow_auth_leads'),
    ('campaigns',                'allow_auth_campaigns'),
    ('knowledge_bases',          'allow_auth_knowledge_bases'),
    ('api_keys',                 'allow_auth_api_keys'),
    ('contacts',                 'allow_auth_contacts'),
    ('finances',                 'allow_auth_finances'),
    ('sales_funnel_stages',      'allow_auth_sales_funnel_stages'),
    ('lead_funnel_progress',     'allow_auth_lead_funnel_progress'),
    ('system_metrics',           'allow_auth_system_metrics'),
    ('activation_metrics',       'allow_auth_activation_metrics')
  LOOP
    -- Verifica se a tabela existe antes de aplicar a policy
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pname, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
        pname, tbl
      );
      RAISE NOTICE 'Policy aplicada: % → %', tbl, pname;
    ELSE
      RAISE NOTICE 'Tabela não existe (ignorada): %', tbl;
    END IF;
  END LOOP;
END $$;

-- Tenants: acesso de leitura público (necessário para login e busca de projetos)
DROP POLICY IF EXISTS "allow_auth_tenants" ON tenants;
CREATE POLICY "allow_auth_tenants" ON tenants
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Profiles: usuário só acessa o próprio perfil
DROP POLICY IF EXISTS "allow_own_profile" ON profiles;
CREATE POLICY "allow_own_profile" ON profiles
  FOR ALL TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Verificar resultado
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
