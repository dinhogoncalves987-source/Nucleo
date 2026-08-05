-- Repara o único vínculo de identidade órfão conhecido do Núcleo.
-- Esta migration é deliberadamente fail-closed: qualquer divergência no
-- estado esperado aborta a transação antes da alteração de identidade.

BEGIN;

LOCK TABLE auth.users, public.profiles, public.users, public.tenants
  IN SHARE ROW EXCLUSIVE MODE;

DO $repair_identity$
DECLARE
  default_tenant CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  expected_prefix CONSTANT text := '4b8fadb2';
  expected_day_start CONSTANT timestamptz := '2026-03-19 00:00:00+00';
  expected_day_end CONSTANT timestamptz := '2026-03-20 00:00:00+00';
  max_creation_gap CONSTANT interval := interval '20 minutes';
  orphan_profile_id uuid;
  orphan_profile_tenant_id uuid;
  orphan_profile_role text;
  orphan_profile_created_at timestamptz;
  missing_profile_auth_id uuid;
  missing_profile_auth_email text;
  missing_profile_auth_created_at timestamptz;
  affected_rows integer;
BEGIN
  IF (SELECT count(*) FROM auth.users) <> 2 THEN
    RAISE EXCEPTION 'Identity repair aborted: unexpected auth.users count';
  END IF;

  IF (SELECT count(*) FROM public.profiles) <> 2 THEN
    RAISE EXCEPTION 'Identity repair aborted: unexpected profiles count';
  END IF;

  IF (SELECT count(*) FROM public.users) <> 0 THEN
    RAISE EXCEPTION 'Identity repair aborted: public.users is not empty';
  END IF;

  IF (
    SELECT count(*)
    FROM public.tenants
    WHERE id = default_tenant
  ) <> 1 THEN
    RAISE EXCEPTION 'Identity repair aborted: default tenant is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public.profiles AS profile
    JOIN auth.users AS auth_user ON auth_user.id = profile.id
    WHERE profile.role = 'operator'
      AND profile.tenant_id = default_tenant
  ) <> 1 THEN
    RAISE EXCEPTION 'Identity repair aborted: expected linked operator not found';
  END IF;

  IF (
    SELECT count(*)
    FROM public.profiles AS profile
    LEFT JOIN auth.users AS auth_user ON auth_user.id = profile.id
    WHERE auth_user.id IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'Identity repair aborted: unexpected orphan profile count';
  END IF;

  IF (
    SELECT count(*)
    FROM auth.users AS auth_user
    LEFT JOIN public.profiles AS profile ON profile.id = auth_user.id
    WHERE profile.id IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'Identity repair aborted: unexpected auth user without profile count';
  END IF;

  SELECT
    profile.id,
    profile.tenant_id,
    profile.role,
    profile.created_at
  INTO STRICT
    orphan_profile_id,
    orphan_profile_tenant_id,
    orphan_profile_role,
    orphan_profile_created_at
  FROM public.profiles AS profile
  LEFT JOIN auth.users AS auth_user ON auth_user.id = profile.id
  WHERE auth_user.id IS NULL
    AND profile.role = 'superadmin'
    AND profile.tenant_id = default_tenant
    AND left(profile.id::text, 8) = expected_prefix
    AND profile.created_at >= expected_day_start
    AND profile.created_at < expected_day_end;

  SELECT
    auth_user.id,
    auth_user.email,
    auth_user.created_at
  INTO STRICT
    missing_profile_auth_id,
    missing_profile_auth_email,
    missing_profile_auth_created_at
  FROM auth.users AS auth_user
  LEFT JOIN public.profiles AS profile ON profile.id = auth_user.id
  WHERE profile.id IS NULL
    AND left(auth_user.id::text, 8) = expected_prefix
    AND auth_user.created_at >= expected_day_start
    AND auth_user.created_at < expected_day_end
    AND auth_user.email IS NOT NULL;

  IF abs(extract(epoch FROM (
    missing_profile_auth_created_at - orphan_profile_created_at
  ))) > extract(epoch FROM max_creation_gap) THEN
    RAISE EXCEPTION 'Identity repair aborted: creation timestamps are too far apart';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(email) = lower(missing_profile_auth_email)
      AND id <> orphan_profile_id
  ) THEN
    RAISE EXCEPTION 'Identity repair aborted: auth email already belongs to another profile';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND confrelid = 'auth.users'::regclass
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'Identity repair aborted: profiles already references auth.users';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'public.profiles'::regclass
  ) THEN
    RAISE EXCEPTION 'Identity repair aborted: another table references profiles';
  END IF;

  UPDATE public.profiles
  SET
    id = missing_profile_auth_id,
    email = missing_profile_auth_email
  WHERE id = orphan_profile_id
    AND tenant_id = orphan_profile_tenant_id
    AND role = orphan_profile_role;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'Identity repair aborted: expected exactly one updated profile';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = missing_profile_auth_id
      AND email = missing_profile_auth_email
      AND tenant_id = orphan_profile_tenant_id
      AND role = orphan_profile_role
  ) THEN
    RAISE EXCEPTION 'Identity repair aborted: tenant or role was not preserved';
  END IF;
END;
$repair_identity$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

DO $verify_identity$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    LEFT JOIN auth.users AS auth_user ON auth_user.id = profile.id
    WHERE auth_user.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Identity repair aborted: orphan profiles remain';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    LEFT JOIN public.profiles AS profile ON profile.id = auth_user.id
    WHERE profile.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Identity repair aborted: auth users without profiles remain';
  END IF;
END;
$verify_identity$;

COMMIT;
