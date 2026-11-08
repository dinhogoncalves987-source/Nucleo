-- LOCAL ONLY: upgrade phase6 without rewriting its migration or discarding receipts.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE nucleo_budget.model_bounds (
 id uuid PRIMARY KEY,
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 100),
 version text NOT NULL CHECK(length(version) BETWEEN 1 AND 100),
 payload_contract text NOT NULL CHECK(payload_contract='responses_text_only_v1'),
 -- A reviewed absolute BILLABLE maximum, not a chosen prompt allowance or tokenizer estimate.
 absolute_billable_input bigint NOT NULL CHECK(absolute_billable_input BETWEEN 1 AND 10000000),
 absolute_billable_output bigint NOT NULL CHECK(absolute_billable_output BETWEEN 600 AND 1000000),
 max_payload_bytes integer NOT NULL CHECK(max_payload_bytes BETWEEN 1 AND 1000000),
 evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 300),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 valid_from timestamptz NOT NULL,
 valid_until timestamptz NOT NULL CHECK(valid_until>valid_from),
 approved boolean NOT NULL DEFAULT false,
 UNIQUE(model,version)
);
ALTER TABLE nucleo_budget.model_bounds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nucleo_budget.model_bounds FROM PUBLIC,anon,authenticated;
GRANT SELECT ON nucleo_budget.model_bounds TO service_role;
CREATE TRIGGER immutable_bound BEFORE UPDATE OR DELETE ON nucleo_budget.model_bounds FOR EACH ROW EXECUTE FUNCTION nucleo_budget.immutable_price();
-- Existing prices have no bound certification and are blocked for NEW dispatch.
-- Existing dispatched receipts can still settle using their original immutable rates.
ALTER TABLE nucleo_budget.prices ADD COLUMN bound_id uuid REFERENCES nucleo_budget.model_bounds(id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION public.nucleo_budget_v1(p_action text,p_user uuid,p_tenant uuid,p_session uuid,p_contact uuid,p_request uuid,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE g nucleo_budget.allowances; t nucleo_budget.allowances; r nucleo_budget.receipts;
 p nucleo_budget.prices; b nucleo_budget.model_bounds; cost bigint; actual bigint; tk text; active uuid;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('reserve','dispatch','settle','uncertain','cancel') OR p_request IS NULL THEN
   RETURN jsonb_build_object('ok',false,'code','budget_invalid'); END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('ok',false,'code','budget_invalid'); END IF;
 IF p_action='reserve' THEN
  IF jsonb_typeof(p_data->'bytes') IS DISTINCT FROM 'number' OR COALESCE(p_data->>'bytes','') !~ '^[1-9][0-9]{0,6}$'
   OR jsonb_typeof(p_data->'maxOutput') IS DISTINCT FROM 'number' OR (p_data->>'maxOutput') IS DISTINCT FROM '600'
   OR jsonb_typeof(p_data->'model') IS DISTINCT FROM 'string' OR length(COALESCE(p_data->>'model','')) NOT BETWEEN 1 AND 100
   OR jsonb_typeof(p_data->'fingerprint') IS DISTINCT FROM 'string' OR COALESCE(p_data->>'fingerprint','') !~ '^[a-f0-9]{64}$'
   OR (p_data->>'payloadContract') IS DISTINCT FROM 'responses_text_only_v1'
   THEN RETURN jsonb_build_object('ok',false,'code','budget_invalid'); END IF;
 END IF;
 IF p_action='settle' THEN
  IF jsonb_typeof(p_data->'input') IS DISTINCT FROM 'number' OR COALESCE(p_data->>'input','') !~ '^[0-9]{1,10}$'
   OR jsonb_typeof(p_data->'output') IS DISTINCT FROM 'number' OR COALESCE(p_data->>'output','') !~ '^[0-9]{1,10}$'
   OR jsonb_typeof(p_data->'response') IS DISTINCT FROM 'object'
   THEN RETURN jsonb_build_object('ok',false,'code','budget_invalid_usage'); END IF;
 END IF;
 PERFORM 1 FROM nucleo_private.memberships WHERE user_id=p_user AND tenant_id=p_tenant FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','budget_forbidden'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_user AND tenant_id=p_tenant FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','budget_forbidden'); END IF;
 IF p_contact IS NOT NULL THEN
  PERFORM 1 FROM nucleo_private.contact_scopes WHERE contact_id=p_contact AND tenant_id=p_tenant FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','budget_forbidden'); END IF;
  PERFORM 1 FROM public.contacts WHERE id=p_contact AND tenant_id=p_tenant FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','budget_forbidden'); END IF;
 END IF;
 PERFORM 1 FROM nucleo_private.sessions WHERE id=p_session AND user_id=p_user AND tenant_id=p_tenant AND contact_id IS NOT DISTINCT FROM p_contact;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','budget_forbidden'); END IF;
 -- Global row serializes admission across ALL tenants and processes. Always same lock order.
 SELECT * INTO g FROM nucleo_budget.allowances WHERE scope='global' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','budget_unconfigured'); END IF;
 tk:='tenant:'||p_tenant::text;
 SELECT * INTO t FROM nucleo_budget.allowances WHERE scope=tk FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','budget_unconfigured'); END IF;
 SELECT * INTO r FROM nucleo_budget.receipts WHERE request_id=p_request FOR UPDATE;
 IF FOUND THEN
  IF r.user_id<>p_user OR r.tenant_id<>p_tenant OR r.session_id<>p_session OR r.contact_id IS DISTINCT FROM p_contact THEN
   RETURN jsonb_build_object('ok',false,'code','budget_forbidden'); END IF;
  SELECT * INTO p FROM nucleo_budget.prices WHERE id=r.price_id;
  IF p_action='reserve' THEN
   IF r.fingerprint IS DISTINCT FROM p_data->>'fingerprint' THEN RETURN jsonb_build_object('ok',false,'code','budget_conflict'); END IF;
   IF r.state='completed' THEN RETURN jsonb_build_object('ok',true,'state','completed','response',r.response); END IF;
   IF r.state='reserved' THEN RETURN jsonb_build_object('ok',true,'state','reserved'); END IF;
   RETURN jsonb_build_object('ok',false,'code','budget_uncertain');
  END IF;
 ELSE
  IF p_action<>'reserve' THEN RETURN jsonb_build_object('ok',false,'code','budget_not_found'); END IF;
  IF NOT g.enabled OR NOT t.enabled THEN RETURN jsonb_build_object('ok',false,'code','budget_disabled'); END IF;
  SELECT price_id INTO active FROM nucleo_budget.active_prices WHERE model=p_data->>'model' FOR SHARE;
  SELECT * INTO p FROM nucleo_budget.prices WHERE id=active AND model=p_data->>'model';
  IF NOT FOUND OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until OR p.currency<>g.currency OR p.currency<>t.currency THEN
   RETURN jsonb_build_object('ok',false,'code','budget_price_unapproved'); END IF;
  SELECT * INTO b FROM nucleo_budget.model_bounds WHERE id=p.bound_id;
  IF NOT FOUND OR NOT b.approved OR b.model<>p.model OR clock_timestamp()<b.valid_from OR clock_timestamp()>=b.valid_until
    OR p.max_input<b.absolute_billable_input OR p.max_output<b.absolute_billable_output
    THEN RETURN jsonb_build_object('ok',false,'code','budget_bound_unapproved'); END IF;
  IF (p_data->>'bytes')::bigint>p.max_bytes OR (p_data->>'bytes')::bigint>b.max_payload_bytes
    THEN RETURN jsonb_build_object('ok',false,'code','budget_invalid'); END IF;
  cost:=p.max_input*p.input_micro+p.max_output*p.output_micro;
  IF cost>g.request_limit_micro OR cost>t.request_limit_micro OR g.spent_micro+g.held_micro+cost>g.limit_micro
     OR t.spent_micro+t.held_micro+cost>t.limit_micro OR g.inflight>=g.max_inflight OR t.inflight>=t.max_inflight THEN
   RETURN jsonb_build_object('ok',false,'code','budget_exhausted'); END IF;
  INSERT INTO nucleo_budget.receipts(request_id,session_id,user_id,tenant_id,contact_id,fingerprint,price_id,held_micro,state)
    VALUES(p_request,p_session,p_user,p_tenant,p_contact,p_data->>'fingerprint',p.id,cost,'reserved');
  UPDATE nucleo_budget.allowances SET held_micro=held_micro+cost,inflight=inflight+1 WHERE scope IN ('global',tk);
  RETURN jsonb_build_object('ok',true,'state','reserved');
 END IF;
 IF p_action='dispatch' THEN
  IF r.state<>'reserved' THEN RETURN jsonb_build_object('ok',false,'code','budget_uncertain'); END IF;
  SELECT price_id INTO active FROM nucleo_budget.active_prices WHERE model=p.model FOR SHARE;
  SELECT * INTO b FROM nucleo_budget.model_bounds WHERE id=p.bound_id;
  IF NOT FOUND OR NOT b.approved OR b.model<>p.model OR clock_timestamp()<b.valid_from OR clock_timestamp()>=b.valid_until
    OR p.max_input<b.absolute_billable_input OR p.max_output<b.absolute_billable_output
    THEN RETURN jsonb_build_object('ok',false,'code','budget_bound_unapproved'); END IF;
  IF NOT g.enabled OR NOT t.enabled OR active IS DISTINCT FROM p.id OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until
     OR g.spent_micro+g.held_micro>g.limit_micro OR t.spent_micro+t.held_micro>t.limit_micro
     OR r.held_micro>g.request_limit_micro OR r.held_micro>t.request_limit_micro
     OR g.inflight>g.max_inflight OR t.inflight>t.max_inflight THEN
   RETURN jsonb_build_object('ok',false,'code','budget_disabled'); END IF;
  UPDATE nucleo_budget.receipts SET state='dispatched' WHERE request_id=p_request;
  RETURN jsonb_build_object('ok',true,'state','dispatched');
 END IF;
 IF p_action='cancel' THEN
  IF r.state<>'reserved' THEN RETURN jsonb_build_object('ok',false,'code','budget_uncertain'); END IF;
  UPDATE nucleo_budget.allowances SET held_micro=held_micro-r.held_micro,inflight=inflight-1 WHERE scope IN ('global',tk);
  UPDATE nucleo_budget.receipts SET state='cancelled' WHERE request_id=p_request;
  RETURN jsonb_build_object('ok',true,'state','cancelled');
 END IF;
 IF p_action='uncertain' THEN
  IF r.state='dispatched' THEN UPDATE nucleo_budget.receipts SET state='uncertain' WHERE request_id=p_request; END IF;
  RETURN jsonb_build_object('ok',true,'state',CASE WHEN r.state='dispatched' THEN 'uncertain' ELSE r.state END);
 END IF;
 IF p_action='settle' THEN
  IF r.state='completed' AND r.response=p_data->'response' THEN RETURN jsonb_build_object('ok',true,'state','completed'); END IF;
  IF r.state NOT IN ('dispatched','uncertain') THEN RETURN jsonb_build_object('ok',false,'code','budget_uncertain'); END IF;
  IF NOT (p_data ?& ARRAY['input','output','response']) OR (p_data->>'input') !~ '^\d{1,10}$' OR (p_data->>'output') !~ '^\d{1,10}$'
     OR jsonb_typeof(p_data->'response')<>'object' OR octet_length((p_data->'response')::text)>200000 THEN
   RETURN jsonb_build_object('ok',false,'code','budget_invalid_usage'); END IF;
  actual:=(p_data->>'input')::bigint*p.input_micro+(p_data->>'output')::bigint*p.output_micro;
  -- Record actual even if bounds were wrong; disable both allowances instead of hiding overrun.
  UPDATE nucleo_budget.allowances SET held_micro=held_micro-r.held_micro,spent_micro=spent_micro+actual,inflight=inflight-1,
    enabled=enabled AND actual<=r.held_micro AND (p_data->>'input')::bigint<=p.max_input AND (p_data->>'output')::bigint<=p.max_output
      AND spent_micro+held_micro-r.held_micro+actual<=limit_micro WHERE scope IN ('global',tk);
  IF actual>r.held_micro OR (p_data->>'input')::bigint>p.max_input OR (p_data->>'output')::bigint>p.max_output THEN
   UPDATE nucleo_budget.receipts SET state='overrun',actual_micro=actual WHERE request_id=p_request;
   RETURN jsonb_build_object('ok',false,'code','budget_overrun');
  END IF;
  UPDATE nucleo_budget.receipts SET state='completed',actual_micro=actual,response=p_data->'response' WHERE request_id=p_request;
  RETURN jsonb_build_object('ok',true,'state','completed');
 END IF;
 RETURN jsonb_build_object('ok',false,'code','budget_invalid');
END $$;
REVOKE ALL ON FUNCTION public.nucleo_budget_v1(text,uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nucleo_budget_v1(text,uuid,uuid,uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;
