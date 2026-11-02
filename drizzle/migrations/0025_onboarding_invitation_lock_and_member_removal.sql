ALTER TABLE public.family_invitations DROP CONSTRAINT family_invitations_family_member_id_fkey;
ALTER TABLE public.family_invitations ADD CONSTRAINT family_invitations_family_member_id_fkey FOREIGN KEY(family_member_id) REFERENCES public.family_members(id) ON DELETE SET NULL;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.accept_household_invitation(uuid,uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,' SELECT * INTO inv FROM public.family_invitations WHERE id=_invitation_id FOR UPDATE;', ' SELECT * INTO inv FROM public.family_invitations WHERE id=_invitation_id;
 IF inv.id IS NULL THEN RAISE EXCEPTION ''This invitation link is not valid''; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(inv.family_id::text,771));
 SELECT * INTO inv FROM public.family_invitations WHERE id=_invitation_id FOR UPDATE;');
 definition:=replace(definition,'  IF inv.is_babysitter AND target IS NULL THEN RAISE EXCEPTION ''This caregiver invitation is incomplete''; END IF;', '  IF inv.is_babysitter AND target IS NULL THEN RAISE EXCEPTION ''This caregiver invitation is incomplete''; END IF;
  IF inv.family_member_id IS NULL AND inv.is_babysitter IS FALSE AND EXISTS(SELECT 1 FROM public.families WHERE id=inv.family_id AND onboarding_finished_at IS NOT NULL) AND inv.invited_by IS NULL THEN RAISE EXCEPTION ''This invitation is incomplete''; END IF;');
 EXECUTE definition;
END $$;