-- Run only after lead-import-db-fixture.sql + migration in a proved isolated cluster.
-- Deliberately rolls back synthetic tests. This does NOT verify restart durability/concurrency.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE legacy_snapshot AS SELECT * FROM public.leads;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"is_anonymous":false}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE tenant uuid:='00000000-0000-4000-8000-000000000010';
 request uuid:='00000000-0000-4000-8000-000000000201';
 source jsonb:=jsonb_build_object('format','csv','file_name','synthetic.csv','sha256',repeat('a',64),
 'record_count',2,'authorization','user_import_for_qualification');
 contacts jsonb:='[{"name":"Existing","phone":"+5511999990004","record_numbers":[1]},
 {"name":"New","phone":"+5511999990002","record_numbers":[2]}]';
 first_result jsonb; replay jsonb;
BEGIN
 first_result:=public.nucleo_import_leads_v1(request,tenant,source,contacts);
 IF (first_result->>'imported')::int<>1 OR (first_result->>'existing')::int<>1 THEN RAISE EXCEPTION 'wrong counts'; END IF;
 replay:=public.nucleo_import_leads_v1(request,tenant,source,contacts);
 IF replay IS DISTINCT FROM first_result THEN RAISE EXCEPTION 'replay mismatch'; END IF;
 IF public.nucleo_get_lead_import_v1(request,tenant) IS DISTINCT FROM first_result THEN RAISE EXCEPTION 'lookup mismatch'; END IF;
 BEGIN
  PERFORM public.nucleo_import_leads_v1(request,tenant,source||'{"file_name":"other.csv"}',contacts);
  RAISE EXCEPTION 'conflict accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN
  PERFORM public.nucleo_import_leads_v1(request,'00000000-0000-4000-8000-000000000020',source,contacts);
  RAISE EXCEPTION 'tenant mismatch accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM count(*) FROM nucleo_intake.receipts;
  RAISE EXCEPTION 'private receipt readable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO nucleo_intake.provenance(request_id,lead_id,phone,record_numbers,outcome)
  VALUES(request,request,'+5511999990003','[1]','imported');
  RAISE EXCEPTION 'provenance forgery accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims','{"is_anonymous":true}',true);
 BEGIN
  PERFORM public.nucleo_import_leads_v1(request,tenant,source,contacts);
  RAISE EXCEPTION 'anonymous accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
  PERFORM public.nucleo_get_lead_import_v1(request,tenant);
  RAISE EXCEPTION 'null auth accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.leads)<>4 THEN RAISE EXCEPTION 'wrong lead count'; END IF;
 IF EXISTS(SELECT * FROM legacy_snapshot EXCEPT SELECT * FROM public.leads) THEN RAISE EXCEPTION 'legacy rewritten'; END IF;
 IF (SELECT count(*) FROM nucleo_intake.provenance)<>2 THEN RAISE EXCEPTION 'missing provenance'; END IF;
 IF EXISTS(SELECT 1 FROM public.leads WHERE source='csv' AND (status<>'new' OR validation_status<>'pending')) THEN RAISE EXCEPTION 'unsafe defaults'; END IF;
 IF has_function_privilege('anon','public.nucleo_import_leads_v1(uuid,uuid,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'anon execute'; END IF;
END $$;
-- Fail only after a successful lead INSERT and receipt/provenance writes begin.
CREATE FUNCTION public.synthetic_fail_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic_storage_failure' USING ERRCODE='23514'; END $$;
CREATE TRIGGER synthetic_fail BEFORE INSERT ON nucleo_intake.provenance
FOR EACH ROW EXECUTE FUNCTION public.synthetic_fail_provenance();
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.nucleo_import_leads_v1('00000000-0000-4000-8000-000000000202',
   '00000000-0000-4000-8000-000000000010',
   jsonb_build_object('format','vcard','file_name','failure.vcf','sha256',repeat('b',64),
    'record_count',1,'authorization','user_import_for_qualification'),
   '[{"name":"Fail","phone":"+5521999990003","record_numbers":[1]}]');
  RAISE EXCEPTION 'false success';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.leads)<>4 THEN RAISE EXCEPTION 'partial lead survived'; END IF;
 IF (SELECT count(*) FROM nucleo_intake.receipts)<>1 THEN RAISE EXCEPTION 'partial receipt survived'; END IF;
 IF (SELECT count(*) FROM nucleo_intake.provenance)<>2 THEN RAISE EXCEPTION 'partial provenance survived'; END IF;
END $$;
ROLLBACK;
\echo Synthetic assertions passed; concurrency and restart NOT covered.
