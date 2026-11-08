-- Offline deliverable. Apply only after baseline/RLS review and isolated SQL tests.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $$ BEGIN
 IF to_regclass('public.profiles') IS NULL OR to_regclass('public.leads') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.jwt()') IS NULL THEN
   RAISE EXCEPTION 'lead_import_missing_baseline';
 END IF;
 IF to_regnamespace('nucleo_intake') IS NOT NULL THEN
   RAISE EXCEPTION 'lead_import_already_installed';
 END IF;
 -- Fail before DDL when the known baseline contract does not exist.
 PERFORM id,tenant_id,role FROM public.profiles LIMIT 0;
 PERFORM id,tenant_id,name,phone,source,status,validation_status,created_at FROM public.leads LIMIT 0;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
   WHERE attrelid IN ('public.profiles'::regclass,'public.leads'::regclass)
   AND attname IN ('id','tenant_id') AND atttypid<>'uuid'::regtype AND NOT attisdropped) THEN
   RAISE EXCEPTION 'lead_import_incompatible_identity_types';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.profiles'::regclass
   AND (pg_has_role('authenticated',relowner,'MEMBER') OR pg_has_role('anon',relowner,'MEMBER'))) THEN
   RAISE EXCEPTION 'lead_import_unsafe_profile_owner';
 END IF;
END $$;
CREATE SCHEMA nucleo_intake;
REVOKE ALL ON SCHEMA nucleo_intake FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA nucleo_intake TO authenticated;
-- Explicit Unicode case mapping, independent of a database's C/ASCII locale.
-- Absence of ICU fails the migration closed instead of weakening name checks.
CREATE COLLATION nucleo_intake.name_case (provider=icu,locale='und',deterministic=true);
-- ECMAScript whitespace set, including NBSP and BOM, matching the file parser.
CREATE FUNCTION nucleo_intake.normalized_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT lower(btrim(regexp_replace(normalize(p_name,NFC),
   U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')) COLLATE nucleo_intake.name_case);
$$;
CREATE TABLE nucleo_intake.receipts (
 request_id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 source jsonb NOT NULL,
 contacts jsonb NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nucleo_intake.provenance (
 request_id uuid NOT NULL REFERENCES nucleo_intake.receipts(request_id),
 lead_id uuid NOT NULL,
 phone text NOT NULL,
 record_numbers jsonb NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('imported','existing')),
 whatsapp text NOT NULL DEFAULT 'unknown' CHECK(whatsapp='unknown'),
 activity text NOT NULL DEFAULT 'unknown' CHECK(activity='unknown'),
 contact_permission text NOT NULL DEFAULT 'not_established' CHECK(contact_permission='not_established'),
 PRIMARY KEY(request_id,phone)
);
ALTER TABLE nucleo_intake.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE nucleo_intake.provenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA nucleo_intake FROM PUBLIC, anon, authenticated;

-- Legacy profiles may have a self-service FOR ALL policy. Identity is an admin
-- provisioned boundary, never a field the signed-in user may change. Preserve
-- ordinary UPDATE of display name and other non-authority fields.
CREATE FUNCTION nucleo_intake.protect_profile_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user IN ('anon','authenticated')
    OR current_setting('role',true) IN ('anon','authenticated') OR auth.uid() IS NOT NULL THEN
   IF TG_OP IN ('INSERT','DELETE','TRUNCATE') THEN
     RAISE EXCEPTION 'lead_import_profile_identity_protected' USING ERRCODE='42501';
   END IF;
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.role IS DISTINCT FROM OLD.role THEN
     RAISE EXCEPTION 'lead_import_profile_identity_protected' USING ERRCODE='42501';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nucleo_intake_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION nucleo_intake.protect_profile_identity();
CREATE TRIGGER nucleo_intake_identity_truncate_guard BEFORE TRUNCATE ON public.profiles
FOR EACH STATEMENT EXECUTE FUNCTION nucleo_intake.protect_profile_identity();
REVOKE TRIGGER ON public.profiles FROM PUBLIC,anon,authenticated;

-- No credential, JWT user_metadata or caller-supplied tenant grants authority.
-- Lock membership for the transaction, including receipt recovery.
CREATE FUNCTION nucleo_intake.authorize(p_expected_tenant uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid := auth.uid(); tenant uuid;
BEGIN
 IF actor IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
   RAISE EXCEPTION 'lead_import_unauthenticated' USING ERRCODE='42501';
 END IF;
 SELECT tenant_id INTO tenant FROM public.profiles
 WHERE id=actor AND role::text IN ('superadmin','manager','operator') FOR SHARE;
 IF tenant IS NULL OR tenant IS DISTINCT FROM p_expected_tenant THEN
   RAISE EXCEPTION 'lead_import_forbidden' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

CREATE FUNCTION nucleo_intake.import_v1(p_request_id uuid,p_expected_tenant uuid,p_source jsonb,p_contacts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE actor uuid; previous nucleo_intake.receipts; contact jsonb; n jsonb;
 lead uuid; legacy_name text; candidates integer; outcome text; imported integer:=0; existing integer:=0;
 items jsonb:='[]'; v_response jsonb; count_records integer; numbers integer[]:='{}';
BEGIN
 actor:=nucleo_intake.authorize(p_expected_tenant);
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'lead_import_invalid_request'; END IF;
 IF jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR jsonb_typeof(p_contacts) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'lead_import_invalid_payload'; END IF;
 IF octet_length(p_source::text)+octet_length(p_contacts::text)>2000000 THEN
   RAISE EXCEPTION 'lead_import_too_large'; END IF;
 IF (p_source - ARRAY['format','file_name','sha256','record_count','authorization']) <> '{}'::jsonb
   OR coalesce(p_source->>'format','') NOT IN ('csv','vcard')
   OR jsonb_typeof(p_source->'file_name') IS DISTINCT FROM 'string'
   OR length(btrim(coalesce(p_source->>'file_name',''))) NOT BETWEEN 1 AND 255
   OR jsonb_typeof(p_source->'sha256') IS DISTINCT FROM 'string'
   OR coalesce(p_source->>'sha256','') !~ '^[a-f0-9]{64}$'
   OR (p_source->>'authorization') IS DISTINCT FROM 'user_import_for_qualification'
   OR jsonb_typeof(p_source->'record_count') IS DISTINCT FROM 'number'
   OR coalesce(p_source->>'record_count','') !~ '^[1-9][0-9]{0,4}$'
   OR jsonb_array_length(p_contacts) NOT BETWEEN 1 AND 5000 THEN
   RAISE EXCEPTION 'lead_import_invalid_source'; END IF;
 count_records:=(p_source->>'record_count')::integer;
 IF count_records>10000 THEN RAISE EXCEPTION 'lead_import_too_large'; END IF;
 FOR contact IN SELECT value FROM jsonb_array_elements(p_contacts) LOOP
   -- One vCard may contain several TEL fields: records can belong to multiple phones.
   numbers:='{}';
   IF jsonb_typeof(contact) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'lead_import_invalid_contact'; END IF;
   IF (contact - ARRAY['name','phone','record_numbers']) <> '{}'::jsonb
     OR jsonb_typeof(contact->'name') IS DISTINCT FROM 'string'
     OR length(btrim(coalesce(contact->>'name',''))) NOT BETWEEN 1 AND 200
     OR length(nucleo_intake.normalized_name(contact->>'name'))=0
     OR coalesce(contact->>'phone','') !~ '^\+55[1-9][0-9]([2-5][0-9]{7}|9[0-9]{8})$'
     OR jsonb_typeof(contact->'record_numbers') IS DISTINCT FROM 'array' THEN
     RAISE EXCEPTION 'lead_import_invalid_contact'; END IF;
   IF jsonb_array_length(contact->'record_numbers') NOT BETWEEN 1 AND 10000 THEN
     RAISE EXCEPTION 'lead_import_invalid_records'; END IF;
   FOR n IN SELECT value FROM jsonb_array_elements(contact->'record_numbers') LOOP
     IF jsonb_typeof(n) IS DISTINCT FROM 'number' OR n::text !~ '^[1-9][0-9]{0,4}$' THEN
       RAISE EXCEPTION 'lead_import_invalid_records'; END IF;
     IF n::text::integer>count_records OR n::text::integer=ANY(numbers) THEN
       RAISE EXCEPTION 'lead_import_invalid_records'; END IF;
     numbers:=array_append(numbers,n::text::integer);
   END LOOP;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'phone') FROM jsonb_array_elements(p_contacts))<>jsonb_array_length(p_contacts) THEN
   RAISE EXCEPTION 'lead_import_duplicate_payload_phone'; END IF;
 -- Serializes request keys globally, even across tenants. Hash collisions only wait.
 PERFORM pg_advisory_xact_lock(hashtextextended('lead-import:'||p_request_id::text,0));
 SELECT * INTO previous FROM nucleo_intake.receipts WHERE request_id=p_request_id;
 IF FOUND THEN
   IF previous.actor_id<>actor OR previous.tenant_id<>p_expected_tenant THEN
     RAISE EXCEPTION 'lead_import_forbidden' USING ERRCODE='42501'; END IF;
   IF previous.source IS DISTINCT FROM p_source OR previous.contacts IS DISTINCT FROM p_contacts THEN
     RAISE EXCEPTION 'lead_import_request_conflict' USING ERRCODE='22023'; END IF;
   RETURN previous.response;
 END IF;
 -- No unique index imposed on duplicate legacy rows. This short lock also serializes
 -- non-RPC INSERT/UPDATE writers while checking existing phones. It does not prevent
 -- unrelated legacy writers creating future duplicates after this transaction.
 LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;
 INSERT INTO nucleo_intake.receipts(request_id,tenant_id,actor_id,source,contacts,response)
 VALUES(p_request_id,p_expected_tenant,actor,p_source,p_contacts,'{}');
 FOR contact IN SELECT value FROM jsonb_array_elements(p_contacts) LOOP
   lead:=NULL;
   SELECT count(*) INTO candidates FROM public.leads
   WHERE tenant_id=p_expected_tenant AND
     CASE WHEN length(regexp_replace(phone,'[^0-9]','','g')) IN (10,11)
          THEN '55'||regexp_replace(phone,'[^0-9]','','g')
          ELSE regexp_replace(phone,'[^0-9]','','g') END = substring(contact->>'phone' FROM 2)
   ;
   IF candidates>1 THEN RAISE EXCEPTION 'lead_import_ambiguous_legacy' USING ERRCODE='22023'; END IF;
   IF candidates=1 THEN
     SELECT id,name INTO lead,legacy_name FROM public.leads
     WHERE tenant_id=p_expected_tenant AND
       CASE WHEN length(regexp_replace(phone,'[^0-9]','','g')) IN (10,11)
            THEN '55'||regexp_replace(phone,'[^0-9]','','g')
            ELSE regexp_replace(phone,'[^0-9]','','g') END = substring(contact->>'phone' FROM 2);
     IF nucleo_intake.normalized_name(legacy_name)
        IS DISTINCT FROM nucleo_intake.normalized_name(contact->>'name') THEN
       RAISE EXCEPTION 'lead_import_name_conflict' USING ERRCODE='22023';
     END IF;
   END IF;
   IF lead IS NULL THEN
     INSERT INTO public.leads(id,tenant_id,name,phone,source,status,validation_status)
     VALUES(gen_random_uuid(),p_expected_tenant,btrim(contact->>'name'),contact->>'phone','csv','new','pending') RETURNING id INTO lead;
     imported:=imported+1; outcome:='imported';
   ELSE existing:=existing+1; outcome:='existing'; END IF;
   INSERT INTO nucleo_intake.provenance(request_id,lead_id,phone,record_numbers,outcome)
   VALUES(p_request_id,lead,contact->>'phone',contact->'record_numbers',outcome);
   items:=items||jsonb_build_array(jsonb_build_object('lead_id',lead,'phone',contact->>'phone','outcome',outcome));
 END LOOP;
 v_response:=jsonb_build_object('ok',true,'request_id',p_request_id,'tenant_id',p_expected_tenant,
   'imported',imported,'existing',existing,'total',jsonb_array_length(p_contacts),'items',items,
   'state',jsonb_build_object('whatsapp','unknown','activity','unknown','contact_permission','not_established'));
 UPDATE nucleo_intake.receipts SET response=v_response WHERE request_id=p_request_id;
 RETURN v_response;
 -- No exception swallowing: any write failure rolls back leads, provenance and receipt.
END $$;

CREATE FUNCTION nucleo_intake.get_v1(p_request_id uuid,p_expected_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE actor uuid; result jsonb;
BEGIN
 actor:=nucleo_intake.authorize(p_expected_tenant);
 SELECT response INTO result FROM nucleo_intake.receipts
 WHERE request_id=p_request_id AND tenant_id=p_expected_tenant AND actor_id=actor;
 RETURN result;
END $$;
CREATE FUNCTION public.nucleo_import_leads_v1(p_request_id uuid,p_expected_tenant uuid,p_source jsonb,p_contacts jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT nucleo_intake.import_v1(p_request_id,p_expected_tenant,p_source,p_contacts);
$$;
CREATE FUNCTION public.nucleo_get_lead_import_v1(p_request_id uuid,p_expected_tenant uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT nucleo_intake.get_v1(p_request_id,p_expected_tenant);
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nucleo_intake FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION nucleo_intake.import_v1(uuid,uuid,jsonb,jsonb),nucleo_intake.get_v1(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.nucleo_import_leads_v1(uuid,uuid,jsonb,jsonb),public.nucleo_get_lead_import_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nucleo_import_leads_v1(uuid,uuid,jsonb,jsonb),public.nucleo_get_lead_import_v1(uuid,uuid) TO authenticated;
COMMIT;
