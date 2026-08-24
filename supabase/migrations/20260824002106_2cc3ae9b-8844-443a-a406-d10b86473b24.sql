-- optional link between a login membership and a calendar person
ALTER TABLE public.family_users
  ADD COLUMN IF NOT EXISTS family_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL;

CREATE TYPE public.invitation_status AS ENUM ('pending', 'accepted', 'expired', 'revoked');

CREATE TABLE public.family_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.family_role NOT NULL DEFAULT 'viewer',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status public.invitation_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX family_invitations_family_idx ON public.family_invitations (family_id);
CREATE INDEX family_invitations_email_idx ON public.family_invitations (lower(email));
CREATE UNIQUE INDEX family_invitations_pending_unique
  ON public.family_invitations (family_id, lower(email))
  WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_invitations TO authenticated;
GRANT ALL ON public.family_invitations TO service_role;

ALTER TABLE public.family_invitations ENABLE ROW LEVEL SECURITY;

-- only owners of the household can see or manage its invitations;
-- invitees read/accept theirs through a secure server-side token flow, never directly.
CREATE POLICY family_invitations_select_owner ON public.family_invitations
  FOR SELECT TO authenticated USING (public.is_family_owner(family_id));
CREATE POLICY family_invitations_insert_owner ON public.family_invitations
  FOR INSERT TO authenticated WITH CHECK (public.is_family_owner(family_id) AND invited_by = auth.uid());
CREATE POLICY family_invitations_update_owner ON public.family_invitations
  FOR UPDATE TO authenticated USING (public.is_family_owner(family_id)) WITH CHECK (public.is_family_owner(family_id));
CREATE POLICY family_invitations_delete_owner ON public.family_invitations
  FOR DELETE TO authenticated USING (public.is_family_owner(family_id));

CREATE TRIGGER family_invitations_updated_at
  BEFORE UPDATE ON public.family_invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- protect the last owner of a household
CREATE OR REPLACE FUNCTION public.protect_last_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_count int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role <> 'owner' THEN RETURN OLD; END IF;
    SELECT count(*) INTO owner_count FROM public.family_users
      WHERE family_id = OLD.family_id AND role = 'owner';
    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'a household must keep at least one owner';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
    SELECT count(*) INTO owner_count FROM public.family_users
      WHERE family_id = OLD.family_id AND role = 'owner';
    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'a household must keep at least one owner';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER family_users_protect_last_owner
  BEFORE UPDATE OR DELETE ON public.family_users
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner();

REVOKE ALL ON FUNCTION public.protect_last_owner() FROM PUBLIC, anon, authenticated;
