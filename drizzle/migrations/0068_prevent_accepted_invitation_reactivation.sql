DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.accept_household_invitation(uuid,uuid)'::regprocedure) INTO definition;
 IF position(' IF inv.status NOT IN' IN definition)=0 THEN RAISE EXCEPTION 'Invitation acceptance guard location missing'; END IF;
 definition:=replace(definition,' IF inv.status NOT IN',E' IF inv.status=\'pending\' AND (inv.accepted_by IS NOT NULL OR inv.accepted_at IS NOT NULL OR inv.accepted_membership_id IS NOT NULL) THEN RAISE EXCEPTION \'Ask the household owner to send a new invitation.\'; END IF;\n IF inv.status NOT IN');
 EXECUTE definition;
END $migration$;
CREATE OR REPLACE FUNCTION public.prevent_accepted_invitation_reactivation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
BEGIN
 IF NEW.status='pending' AND (OLD.status='accepted' OR OLD.accepted_by IS NOT NULL OR OLD.accepted_at IS NOT NULL OR OLD.accepted_membership_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Ask the household owner to send a new invitation.';
 END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.prevent_accepted_invitation_reactivation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_accepted_invitation_reactivation() TO service_role;
CREATE TRIGGER family_invitations_prevent_accepted_reactivation BEFORE UPDATE OF status ON public.family_invitations FOR EACH ROW EXECUTE FUNCTION public.prevent_accepted_invitation_reactivation();
REVOKE ALL ON FUNCTION public.accept_household_invitation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_household_invitation(uuid,uuid) TO service_role;