-- Isolamento multi-tenant da Demo 0. O tenant sempre vem de public.profiles,
-- nunca de metadata editavel do usuario nem de valores enviados pelo cliente.

DO $policies$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tenants','knowledge_bases','api_keys','campaigns','contacts','leads',
    'sales_funnel_stages','lead_funnel_progress','finances','system_metrics',
    'activation_metrics','chips','system_events','james_memories','affiliates',
    'affiliate_clients','affiliate_commissions','cashback_balances','asaas_payments',
    'james_sessions'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      FOR pol IN SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, tbl);
      END LOOP;
    END IF;
  END LOOP;
END;
$policies$;

CREATE POLICY tenant_own_select ON public.tenants FOR SELECT TO authenticated
USING (id = (SELECT tenant_id FROM public.profiles WHERE id = (SELECT auth.uid())));

DO $tenant_tables$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'knowledge_bases','campaigns','contacts','leads','sales_funnel_stages',
    'finances','system_metrics','chips','james_memories','affiliates',
    'cashback_balances','asaas_payments'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO authenticated '
        'USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = (SELECT auth.uid()))) '
        'WITH CHECK (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = (SELECT auth.uid())))', tbl
      );
    END IF;
  END LOOP;
END;
$tenant_tables$;

-- Segredos de integracao: somente administradores do proprio tenant.
CREATE POLICY tenant_admin_api_keys ON public.api_keys FOR ALL TO authenticated
USING (
  tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = (SELECT auth.uid()))
  AND (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) IN ('superadmin','manager')
)
WITH CHECK (
  tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = (SELECT auth.uid()))
  AND (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) IN ('superadmin','manager')
);

CREATE POLICY tenant_lead_progress ON public.lead_funnel_progress FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.tenant_id =
  (SELECT tenant_id FROM public.profiles WHERE id = (SELECT auth.uid()))))
WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.tenant_id =
  (SELECT tenant_id FROM public.profiles WHERE id = (SELECT auth.uid()))));

CREATE POLICY tenant_activation_metrics ON public.activation_metrics FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.tenant_id =
  (SELECT tenant_id FROM public.profiles WHERE id = (SELECT auth.uid()))))
WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.tenant_id =
  (SELECT tenant_id FROM public.profiles WHERE id = (SELECT auth.uid()))));

-- Tabelas sem tenant direto permanecem backend-only no piloto.
DO $backend_only$
BEGIN
  IF to_regclass('public.system_events') IS NOT NULL THEN
    REVOKE ALL ON public.system_events FROM anon, authenticated;
  END IF;
  IF to_regclass('public.james_sessions') IS NOT NULL THEN
    REVOKE ALL ON public.james_sessions FROM anon, authenticated;
  END IF;
  IF to_regprocedure('public.search_james_memories(text,integer)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.search_james_memories(text, int) FROM PUBLIC, anon, authenticated;
  END IF;
END;
$backend_only$;
