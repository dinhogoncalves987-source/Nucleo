-- Synthetic, fresh local database only. Never apply this fixture remotely.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.tenants(id uuid PRIMARY KEY);
-- Model permissive legacy parent cascades, so private RESTRICT is the actual guard.
CREATE TABLE public.profiles(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE);
CREATE TABLE public.contacts(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE);
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT SELECT,UPDATE ON public.profiles,public.contacts TO service_role;
INSERT INTO public.tenants VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
INSERT INTO public.profiles VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222');
INSERT INTO public.contacts VALUES
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111'),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','22222222-2222-4222-8222-222222222222');
