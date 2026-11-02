CREATE OR REPLACE FUNCTION public.revoke_removed_member_onboarding_invitations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 UPDATE public.family_invitations SET status='revoked' WHERE family_id=OLD.family_id AND family_member_id=OLD.id AND status='pending';
 RETURN OLD;
END $$;
CREATE TRIGGER revoke_removed_member_onboarding_invitations BEFORE DELETE ON public.family_members FOR EACH ROW EXECUTE FUNCTION public.revoke_removed_member_onboarding_invitations();
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.accept_household_invitation(uuid,uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'  IF inv.family_member_id IS NULL AND inv.is_babysitter IS FALSE AND EXISTS(SELECT 1 FROM public.families WHERE id=inv.family_id AND onboarding_finished_at IS NOT NULL) AND inv.invited_by IS NULL THEN RAISE EXCEPTION ''This invitation is incomplete''; END IF;','');
 EXECUTE definition;
END $$;