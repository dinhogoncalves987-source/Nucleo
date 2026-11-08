-- SYNTHETIC ONLY: fresh, isolated cluster with no existing public tables.
-- Not a bootstrap for a real Supabase deployment. Never run against remote data.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.profiles') IS NOT NULL OR to_regclass('public.leads') IS NOT NULL
 OR to_regnamespace('auth') IS NOT NULL THEN RAISE EXCEPTION 'fixture_requires_empty_database'; END IF;
END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,role text NOT NULL,display_name text);
CREATE TABLE public.leads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,name text NOT NULL,phone text NOT NULL,
 source text NOT NULL CHECK(source IN ('csv','manual')),status text NOT NULL,
 validation_status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
INSERT INTO public.profiles(id,tenant_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','operator'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000020','manager');
-- Deliberate duplicate legacy phones and non-default states must survive unchanged.
INSERT INTO public.leads(id,tenant_id,name,phone,source,status,validation_status) VALUES
 ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000010','Legacy A','(11) 99999-0001','manual','qualified','valid'),
 ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000010','Legacy B','+55 11 99999-0001','manual','lost','invalid'),
 ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000010','Existing','+55 11 99999-0004','manual','qualified','valid');
-- Deliberately permissive legacy baseline, guarded by the new migration.
GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.profiles TO authenticated;
CREATE POLICY insecure_legacy_self_all ON public.profiles FOR ALL TO authenticated
 USING (auth.uid()=id) WITH CHECK (auth.uid()=id);
COMMIT;
