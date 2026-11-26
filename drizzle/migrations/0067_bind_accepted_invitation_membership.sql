ALTER TABLE public.family_invitations ADD COLUMN accepted_membership_id uuid;
COMMENT ON COLUMN public.family_invitations.accepted_membership_id IS 'Original membership authorized by acceptance; old accepted invitations never create or bind a replacement membership.';
UPDATE public.family_invitations i SET accepted_membership_id=f.id FROM public.family_users f WHERE i.status='accepted' AND i.accepted_by=f.user_id AND i.family_id=f.family_id AND i.accepted_at IS NOT NULL AND f.created_at<=i.accepted_at;
CREATE OR REPLACE FUNCTION public.accept_household_invitation(_invitation_id uuid, _user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inv record; fu_id uuid; m record; target uuid; actual_role public.family_role;
BEGIN
 SELECT * INTO inv FROM public.family_invitations WHERE id=_invitation_id;
 IF inv.id IS NULL THEN RAISE EXCEPTION 'This invitation link is not valid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(inv.family_id::text,771));
 SELECT * INTO inv FROM public.family_invitations WHERE id=_invitation_id FOR UPDATE;
 IF inv.id IS NULL THEN RAISE EXCEPTION 'This invitation link is not valid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=_user_id AND lower(email)=lower(inv.email) AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Sign in with the verified invitation email'; END IF;
 IF inv.status='accepted' AND inv.accepted_by IS DISTINCT FROM _user_id THEN RAISE EXCEPTION 'This invitation is no longer active'; END IF;
 IF inv.status NOT IN ('pending','accepted') OR (inv.status='pending' AND inv.expires_at<=now()) THEN RAISE EXCEPTION 'This invitation is no longer active'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(inv.family_id::text,771));
 SELECT id,role INTO fu_id,actual_role FROM public.family_users WHERE family_id=inv.family_id AND user_id=_user_id FOR SHARE;
 IF inv.status='accepted' THEN
  IF fu_id IS NULL OR inv.accepted_membership_id IS DISTINCT FROM fu_id THEN RAISE EXCEPTION 'Access was removed. Ask the household owner to send a new invitation.'; END IF;
  RETURN jsonb_build_object('family_id',inv.family_id,'role',actual_role);
 END IF;
 IF fu_id IS NULL THEN
  target:=CASE WHEN inv.is_babysitter THEN inv.babysitter_family_member_id ELSE inv.family_member_id END;
  IF inv.is_babysitter AND target IS NULL THEN RAISE EXCEPTION 'This caregiver invitation is incomplete'; END IF;

  IF target IS NOT NULL THEN
   SELECT * INTO m FROM public.family_members WHERE id=target AND family_id=inv.family_id FOR UPDATE;
   IF m.id IS NULL OR NOT m.active OR m.removed_at IS NOT NULL OR (inv.is_babysitter AND (m.role<>'caregiver' OR inv.role<>'viewer')) OR EXISTS(SELECT 1 FROM public.family_users WHERE family_id=inv.family_id AND family_member_id=target) THEN RAISE EXCEPTION 'This invitation is no longer valid. Ask the household owner to send a new one.'; END IF;
  END IF;
  INSERT INTO public.family_users(family_id,user_id,role,family_member_id) VALUES(inv.family_id,_user_id,inv.role,target) RETURNING id,role INTO fu_id,actual_role;
  IF inv.is_babysitter THEN
   INSERT INTO public.babysitter_access_profiles(family_user_id,family_id,date_scope) VALUES(fu_id,inv.family_id,coalesce(inv.babysitter_date_scope,'shift_days_only'));
   INSERT INTO public.babysitter_access_calendars(family_user_id,calendar_source_id) SELECT fu_id,c.id FROM public.calendar_sources c WHERE c.family_id=inv.family_id AND c.id=ANY(inv.babysitter_calendar_ids);
  END IF;
 END IF;
 IF inv.status='pending' THEN UPDATE public.family_invitations SET status='accepted',accepted_at=now(),accepted_by=_user_id,accepted_membership_id=fu_id WHERE id=inv.id; END IF;
 RETURN jsonb_build_object('family_id',inv.family_id,'role',actual_role);
END $function$;
REVOKE ALL ON FUNCTION public.accept_household_invitation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_household_invitation(uuid,uuid) TO service_role;