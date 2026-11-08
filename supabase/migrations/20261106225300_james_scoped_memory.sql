-- LOCAL CANDIDATE. Requires server-only service_role and existing profiles/contacts.
-- No import of legacy james_sessions; their ownership is not proven.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.contacts') IS NULL
     OR to_regclass('public.tenants') IS NULL THEN RAISE EXCEPTION 'missing identity baseline'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolbypassrls)
     THEN RAISE EXCEPTION 'expected server service role'; END IF;
  IF NOT has_table_privilege('service_role','public.profiles','SELECT')
     OR NOT has_any_column_privilege('service_role','public.profiles','UPDATE')
     OR NOT has_table_privilege('service_role','public.contacts','SELECT')
     OR NOT has_any_column_privilege('service_role','public.contacts','UPDATE')
     THEN RAISE EXCEPTION 'missing server privileges for membership row locks'; END IF;
  IF to_regnamespace('nucleo_private') IS NOT NULL OR to_regprocedure('public.nucleo_memory_v1(text,uuid,uuid,uuid,uuid,uuid,text,text,uuid,boolean)') IS NOT NULL
     THEN RAISE EXCEPTION 'memory already installed: review instead of overwrite'; END IF;
END $$;
CREATE SCHEMA nucleo_private;
REVOKE ALL ON SCHEMA nucleo_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA nucleo_private TO service_role;

-- Trusted authorization registry, NOT automatically populated from legacy
-- profiles/contacts. Their browser policies may allow tenant reassignment.
-- Provision only through a separately reviewed server/admin process.
CREATE TABLE nucleo_private.memberships (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT
);
CREATE TABLE nucleo_private.contact_scopes (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT
);
ALTER TABLE nucleo_private.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE nucleo_private.contact_scopes ENABLE ROW LEVEL SECURITY;

CREATE TABLE nucleo_private.sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE RESTRICT,
  turns jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(turns)='array' AND jsonb_array_length(turns)<=12),
  closed boolean NOT NULL DEFAULT false,
  pending_request uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sessions_scope ON nucleo_private.sessions(tenant_id,user_id,contact_id,updated_at DESC);
CREATE TABLE nucleo_private.requests (
  session_id uuid NOT NULL REFERENCES nucleo_private.sessions(id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  message text NOT NULL CHECK(length(btrim(message)) BETWEEN 1 AND 2000),
  status text NOT NULL CHECK(status IN ('pending','completed','failed','uncertain')),
  lease uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  reply text CHECK(reply IS NULL OR length(reply) BETWEEN 1 AND 12000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(session_id,id)
);
ALTER TABLE nucleo_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nucleo_private.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA nucleo_private FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA nucleo_private TO service_role;
-- Preserve durable receipts across legacy deletes; intentional erasure requires a separately reviewed admin procedure.
GRANT DELETE ON nucleo_private.memberships,nucleo_private.contact_scopes TO service_role;
-- No browser policies: the only access path is the authenticated server route.
-- SECURITY INVOKER: no owner privilege escalation. service_role must already be
-- able to SELECT and row-lock profiles/contacts (PostgreSQL requires UPDATE
-- privilege for FOR SHARE); this migration never broadens those grants.
CREATE FUNCTION public.nucleo_memory_v1(
  p_action text, p_user uuid, p_tenant uuid, p_session uuid,
  p_contact uuid DEFAULT NULL, p_request uuid DEFAULT NULL, p_message text DEFAULT NULL,
  p_reply text DEFAULT NULL, p_lease uuid DEFAULT NULL, p_safe_failure boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE s nucleo_private.sessions; r nucleo_private.requests; next_turns jsonb;
BEGIN
  IF p_session IS NULL OR p_user IS NULL OR p_tenant IS NULL OR p_action IS NULL OR p_action NOT IN ('begin','complete','fail','load','close')
     THEN RETURN jsonb_build_object('ok',false,'code','invalid_scope'); END IF;
  PERFORM 1 FROM nucleo_private.memberships WHERE user_id=p_user AND tenant_id=p_tenant FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','session_not_found'); END IF;
  -- Server supplies p_user/p_tenant from verified identity, never browser fields.
  -- Recheck current membership and contact scope on EVERY operation, including commit.
  PERFORM 1 FROM public.profiles WHERE id=p_user AND tenant_id=p_tenant FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','session_not_found'); END IF;
  IF p_contact IS NOT NULL THEN
    PERFORM 1 FROM nucleo_private.contact_scopes WHERE contact_id=p_contact AND tenant_id=p_tenant FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','session_not_found'); END IF;
    PERFORM 1 FROM public.contacts WHERE id=p_contact AND tenant_id=p_tenant FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','session_not_found'); END IF;
  END IF;
  IF p_action='begin' THEN
    IF p_request IS NULL OR p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 1 AND 2000
       THEN RETURN jsonb_build_object('ok',false,'code','invalid_scope'); END IF;
    INSERT INTO nucleo_private.sessions(id,tenant_id,user_id,contact_id)
      VALUES(p_session,p_tenant,p_user,p_contact) ON CONFLICT(id) DO NOTHING;
  END IF;
  SELECT * INTO s FROM nucleo_private.sessions WHERE id=p_session FOR UPDATE;
  IF NOT FOUND OR s.user_id<>p_user OR s.tenant_id<>p_tenant OR s.contact_id IS DISTINCT FROM p_contact
     THEN RETURN jsonb_build_object('ok',false,'code','session_not_found'); END IF;
  IF s.closed THEN RETURN jsonb_build_object('ok',false,'code','session_closed'); END IF;
  IF p_action='load' THEN
    SELECT * INTO r FROM nucleo_private.requests WHERE session_id=s.id AND id=s.pending_request;
    RETURN jsonb_build_object('ok',true,'sessionId',s.id,'turns',s.turns,
      'state',CASE WHEN r.id IS NULL THEN 'ready' WHEN r.status='uncertain' OR r.lease_expires_at<=clock_timestamp() THEN 'uncertain' ELSE 'pending' END,
      'pending',CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('id',r.id,'message',r.message) ELSE NULL END);
  END IF;
  IF p_action='close' THEN
    IF s.pending_request IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','request_busy'); END IF;
    UPDATE nucleo_private.sessions SET closed=true,updated_at=clock_timestamp() WHERE id=s.id;
    RETURN jsonb_build_object('ok',true,'state','closed');
  END IF;
  SELECT * INTO r FROM nucleo_private.requests WHERE session_id=s.id AND id=p_request;
  IF p_action='begin' THEN
    IF r.id IS NOT NULL THEN
      IF r.message IS DISTINCT FROM p_message THEN RETURN jsonb_build_object('ok',false,'code','request_conflict'); END IF;
      IF r.status='completed' THEN RETURN jsonb_build_object('ok',true,'state','completed','reply',r.reply); END IF;
      IF r.status='pending' AND r.lease_expires_at<=clock_timestamp() THEN
        UPDATE nucleo_private.requests SET status='uncertain' WHERE session_id=s.id AND id=r.id;
        RETURN jsonb_build_object('ok',false,'code','request_uncertain');
      END IF;
      IF r.status IN ('pending','uncertain') THEN
        RETURN jsonb_build_object('ok',false,'code',CASE WHEN r.status='pending' THEN 'request_busy' ELSE 'request_uncertain' END);
      END IF;
    END IF;
    IF s.pending_request IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','request_busy'); END IF;
    -- Failed means a confirmed no-generation response (disabled/config/429), not timeout.
    INSERT INTO nucleo_private.requests(session_id,id,message,status,lease,lease_expires_at)
      VALUES(s.id,p_request,p_message,'pending',gen_random_uuid(),clock_timestamp()+interval '90 seconds')
      ON CONFLICT(session_id,id) DO UPDATE SET status='pending',lease=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '90 seconds'
      RETURNING * INTO r;
    UPDATE nucleo_private.sessions SET pending_request=p_request,updated_at=clock_timestamp() WHERE id=s.id;
    RETURN jsonb_build_object('ok',true,'state','reserved','lease',r.lease,'turns',s.turns);
  END IF;
  IF r.id IS NULL OR r.lease IS DISTINCT FROM p_lease THEN RETURN jsonb_build_object('ok',false,'code','request_conflict'); END IF;
  IF p_action='complete' AND r.status='completed' AND r.reply IS NOT DISTINCT FROM p_reply
     THEN RETURN jsonb_build_object('ok',true,'state','completed','reply',r.reply); END IF;
  IF r.status<>'pending' OR s.pending_request IS DISTINCT FROM p_request OR r.lease_expires_at<=clock_timestamp()
     THEN RETURN jsonb_build_object('ok',false,'code','request_uncertain'); END IF;
  IF p_action='fail' THEN
    UPDATE nucleo_private.requests SET status=CASE WHEN p_safe_failure THEN 'failed' ELSE 'uncertain' END WHERE session_id=s.id AND id=r.id;
    IF p_safe_failure THEN UPDATE nucleo_private.sessions SET pending_request=NULL WHERE id=s.id; END IF;
    RETURN jsonb_build_object('ok',true,'state',CASE WHEN p_safe_failure THEN 'failed' ELSE 'uncertain' END);
  END IF;
  IF p_reply IS NULL OR length(btrim(p_reply)) NOT BETWEEN 1 AND 12000 THEN RETURN jsonb_build_object('ok',false,'code','invalid_scope'); END IF;
  next_turns=s.turns||jsonb_build_array(jsonb_build_object('role','user','content',r.message),jsonb_build_object('role','assistant','content',left(p_reply,2000)));
  SELECT coalesce(jsonb_agg(v ORDER BY n),'[]'::jsonb) INTO next_turns
    FROM jsonb_array_elements(next_turns) WITH ORDINALITY AS x(v,n) WHERE n>jsonb_array_length(next_turns)-12;
  UPDATE nucleo_private.requests SET status='completed',reply=p_reply WHERE session_id=s.id AND id=r.id;
  UPDATE nucleo_private.sessions SET turns=next_turns,pending_request=NULL,updated_at=clock_timestamp() WHERE id=s.id;
  RETURN jsonb_build_object('ok',true,'state','completed','reply',p_reply);
END $$;
REVOKE ALL ON FUNCTION public.nucleo_memory_v1(text,uuid,uuid,uuid,uuid,uuid,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nucleo_memory_v1(text,uuid,uuid,uuid,uuid,uuid,text,text,uuid,boolean) TO service_role;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_schema_privilege(role_name,'nucleo_private','USAGE')
      OR has_function_privilege(role_name,'public.nucleo_memory_v1(text,uuid,uuid,uuid,uuid,uuid,text,text,uuid,boolean)','EXECUTE')
      OR has_table_privilege(role_name,'nucleo_private.sessions','SELECT')
      OR has_table_privilege(role_name,'nucleo_private.requests','SELECT')
      OR has_table_privilege(role_name,'nucleo_private.memberships','INSERT')
      OR has_table_privilege(role_name,'nucleo_private.memberships','UPDATE')
      OR has_table_privilege(role_name,'nucleo_private.contact_scopes','INSERT')
      OR has_table_privilege(role_name,'nucleo_private.contact_scopes','UPDATE')
    THEN RAISE EXCEPTION 'unexpected inherited browser privileges'; END IF;
  END LOOP;
END $$;
COMMIT;
