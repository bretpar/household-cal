ALTER TABLE public.family_members ADD COLUMN onboarding_invite_email text;
ALTER TABLE public.families ADD COLUMN onboarding_finished_at timestamptz;
ALTER TABLE public.family_invitations ADD COLUMN family_member_id uuid REFERENCES public.family_members(id);
COMMENT ON COLUMN public.family_members.onboarding_invite_email IS 'Owner onboarding invitation intent; cleared after successful invitation creation. Never grants access.';
CREATE OR REPLACE FUNCTION public.complete_onboarding_invitation(_family uuid, _member uuid, _actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m record; inv record; existing_login uuid; caregiver boolean; wanted_role public.family_role; calendars uuid[];
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(_family::text, 771));
 IF NOT EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND role='owner') THEN RAISE EXCEPTION 'Only household owners can do that'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.families WHERE id=_family AND onboarding_finished_at IS NOT NULL) THEN RAISE EXCEPTION 'Finish setup first'; END IF;
 SELECT * INTO m FROM public.family_members WHERE id=_member AND family_id=_family FOR UPDATE;
 IF m.id IS NULL OR NOT m.active OR m.removed_at IS NOT NULL THEN RAISE EXCEPTION 'Family member is unavailable'; END IF;
 IF m.onboarding_invite_email IS NULL THEN
  SELECT * INTO inv FROM public.family_invitations WHERE family_id=_family AND (family_member_id=_member OR babysitter_family_member_id=_member) AND status IN ('pending','accepted') ORDER BY created_at DESC LIMIT 1;
  IF inv.id IS NULL THEN RETURN jsonb_build_object('status','none'); END IF;
  RETURN jsonb_build_object('id',inv.id,'token',inv.token,'status',inv.status,'email',inv.email);
 END IF;
 IF m.onboarding_invite_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid invitation email'; END IF;
 caregiver := m.role='caregiver';
 IF m.role NOT IN ('parent','child','caregiver') THEN RAISE EXCEPTION 'Choose Parent, Child or Caregiver'; END IF;
 wanted_role := CASE WHEN m.role='parent' THEN 'owner'::public.family_role ELSE 'viewer'::public.family_role END;
 SELECT id INTO existing_login FROM public.family_users WHERE family_id=_family AND family_member_id=_member LIMIT 1;
 IF existing_login IS NOT NULL OR EXISTS(SELECT 1 FROM public.family_users fu JOIN auth.users u ON u.id=fu.user_id WHERE fu.family_id=_family AND lower(u.email)=lower(m.onboarding_invite_email)) THEN
  UPDATE public.family_members SET onboarding_invite_email=NULL WHERE id=_member;
  RETURN jsonb_build_object('status','already_joined','email',m.onboarding_invite_email);
 END IF;
 SELECT * INTO inv FROM public.family_invitations WHERE family_id=_family AND status IN ('pending','accepted') AND (lower(email)=lower(m.onboarding_invite_email) OR family_member_id=_member OR babysitter_family_member_id=_member) ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF inv.id IS NOT NULL THEN
  IF inv.status='accepted' THEN RAISE EXCEPTION 'An accepted invitation already exists; manage access in Settings'; END IF;
  IF lower(inv.email)<>lower(m.onboarding_invite_email) OR inv.role<>wanted_role OR inv.is_babysitter<>caregiver OR (coalesce(inv.family_member_id,inv.babysitter_family_member_id) IS NOT NULL AND coalesce(inv.family_member_id,inv.babysitter_family_member_id)<>_member) THEN RAISE EXCEPTION 'A different pending invitation exists; manage it in Settings'; END IF;
  UPDATE public.family_invitations SET family_member_id=_member WHERE id=inv.id;
 ELSE
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO calendars FROM public.calendar_sources WHERE family_id=_family AND active AND calendar_kind<>'legacy_internal' AND id=(SELECT babysitter_calendar_source_id FROM public.families WHERE id=_family);
  INSERT INTO public.family_invitations(family_id,email,role,invited_by,family_member_id,is_babysitter,babysitter_family_member_id,babysitter_date_scope,babysitter_calendar_ids)
  VALUES(_family,lower(m.onboarding_invite_email),wanted_role,_actor,_member,caregiver,CASE WHEN caregiver THEN _member ELSE NULL END,CASE WHEN caregiver THEN 'shift_days_only'::public.babysitter_date_scope ELSE NULL END,CASE WHEN caregiver THEN calendars ELSE '{}'::uuid[] END) RETURNING * INTO inv;
 END IF;
 UPDATE public.family_members SET onboarding_invite_email=NULL WHERE id=_member;
 RETURN jsonb_build_object('id',inv.id,'token',inv.token,'status',inv.status,'email',inv.email);
END $$;
REVOKE ALL ON FUNCTION public.complete_onboarding_invitation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onboarding_invitation(uuid,uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.accept_household_invitation(_invitation_id uuid,_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv record; fu_id uuid; m record; target uuid; actual_role public.family_role;
BEGIN
 SELECT * INTO inv FROM public.family_invitations WHERE id=_invitation_id FOR UPDATE;
 IF inv.id IS NULL THEN RAISE EXCEPTION 'This invitation link is not valid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=_user_id AND lower(email)=lower(inv.email) AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Sign in with the verified invitation email'; END IF;
 IF inv.status='accepted' AND inv.accepted_by IS DISTINCT FROM _user_id THEN RAISE EXCEPTION 'This invitation is no longer active'; END IF;
 IF inv.status NOT IN ('pending','accepted') OR (inv.status='pending' AND inv.expires_at<=now()) THEN RAISE EXCEPTION 'This invitation is no longer active'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(inv.family_id::text,771));
 SELECT id,role INTO fu_id,actual_role FROM public.family_users WHERE family_id=inv.family_id AND user_id=_user_id;
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
 IF inv.status='pending' THEN UPDATE public.family_invitations SET status='accepted',accepted_at=now(),accepted_by=_user_id WHERE id=inv.id; END IF;
 RETURN jsonb_build_object('family_id',inv.family_id,'role',actual_role);
END $$;
REVOKE ALL ON FUNCTION public.accept_household_invitation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_household_invitation(uuid,uuid) TO service_role;