CREATE TABLE public.onboarding_member_invites (
 family_member_id uuid PRIMARY KEY REFERENCES public.family_members(id) ON DELETE CASCADE,
 family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
 email text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_member_invites TO authenticated;
GRANT ALL ON public.onboarding_member_invites TO service_role;
ALTER TABLE public.onboarding_member_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage onboarding invitation intent" ON public.onboarding_member_invites FOR ALL TO authenticated USING (public.is_family_owner(family_id)) WITH CHECK (public.is_family_owner(family_id));
ALTER TABLE public.family_members ADD CONSTRAINT family_members_id_family_unique UNIQUE(id,family_id);
ALTER TABLE public.onboarding_member_invites ADD CONSTRAINT onboarding_member_invites_same_family FOREIGN KEY(family_member_id,family_id) REFERENCES public.family_members(id,family_id) ON DELETE CASCADE;
INSERT INTO public.onboarding_member_invites(family_member_id,family_id,email) SELECT id,family_id,onboarding_invite_email FROM public.family_members WHERE onboarding_invite_email IS NOT NULL;
UPDATE public.family_members SET onboarding_invite_email=NULL WHERE onboarding_invite_email IS NOT NULL;
COMMENT ON COLUMN public.family_members.onboarding_invite_email IS 'DEPRECATED: invitation emails live in owner-only onboarding_member_invites. Legacy writes are redirected and this column remains NULL.';
CREATE OR REPLACE FUNCTION public.redirect_legacy_onboarding_invite() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.onboarding_invite_email IS NOT NULL THEN
  IF auth.uid() IS NOT NULL AND NOT public.is_family_owner(NEW.family_id) THEN RAISE EXCEPTION 'Only household owners can do that'; END IF;
  INSERT INTO public.onboarding_member_invites(family_member_id,family_id,email) VALUES(NEW.id,NEW.family_id,NEW.onboarding_invite_email) ON CONFLICT(family_member_id) DO UPDATE SET family_id=EXCLUDED.family_id,email=EXCLUDED.email;
  UPDATE public.family_members SET onboarding_invite_email=NULL WHERE id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.redirect_legacy_onboarding_invite() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER redirect_legacy_onboarding_invite AFTER INSERT OR UPDATE OF onboarding_invite_email ON public.family_members FOR EACH ROW EXECUTE FUNCTION public.redirect_legacy_onboarding_invite();
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.complete_onboarding_invitation(uuid,uuid,uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'calendars uuid[];','calendars uuid[]; intent_email text;');
 definition:=replace(definition,' IF m.onboarding_invite_email IS NULL THEN',' SELECT email INTO intent_email FROM public.onboarding_member_invites WHERE family_member_id=_member AND family_id=_family FOR UPDATE;\n IF intent_email IS NULL THEN');
 definition:=replace(definition,'m.onboarding_invite_email','intent_email');
 definition:=replace(definition,'UPDATE public.family_members SET onboarding_invite_email=NULL WHERE id=_member;','DELETE FROM public.onboarding_member_invites WHERE family_member_id=_member AND family_id=_family;');
 definition:=replace(definition,'\n',chr(10));
 EXECUTE definition;
END $$;
ALTER TABLE public.family_invitations ADD CONSTRAINT family_invitations_member_same_family FOREIGN KEY(family_member_id,family_id) REFERENCES public.family_members(id,family_id) NOT VALID;
CREATE OR REPLACE FUNCTION public.assert_invitation_member_same_family() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.family_member_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.family_members WHERE id=NEW.family_member_id AND family_id=NEW.family_id) THEN RAISE EXCEPTION 'Invitation member must belong to the same household'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.assert_invitation_member_same_family() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER assert_invitation_member_same_family BEFORE INSERT OR UPDATE ON public.family_invitations FOR EACH ROW EXECUTE FUNCTION public.assert_invitation_member_same_family();
COMMENT ON CONSTRAINT family_invitations_member_same_family ON public.family_invitations IS 'Enforces same-household links on new writes; legacy rows are preserved and the trigger rejects every invalid update.';