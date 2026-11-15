CREATE OR REPLACE FUNCTION public.select_caregiver_google_calendar(_user uuid,_calendar text,_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prior text;
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 IF EXISTS (SELECT 1 FROM public.account_deletion_jobs WHERE user_id=_user AND status NOT IN ('completed','rolled_back')) THEN RAISE EXCEPTION 'Account deletion is in progress'; END IF;
 SELECT calendar_id INTO prior FROM public.caregiver_google_connections WHERE user_id=_user AND status='connected' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Connect Google Calendar first'; END IF;
 IF prior IS NOT DISTINCT FROM _calendar THEN RETURN; END IF;
 IF EXISTS (SELECT 1 FROM public.caregiver_google_deliveries WHERE user_id=_user AND lease_until>now()) THEN RAISE EXCEPTION 'Google sync is running. Wait for it to finish, then change calendars again'; END IF;
 UPDATE public.caregiver_google_deliveries SET desired_action='delete',reconciliation_version=gen_random_uuid(),status='pending',attempts=0,last_error=NULL,updated_at=clock_timestamp() WHERE user_id=_user AND calendar_id<>_calendar AND desired_action<>'delete';
 UPDATE public.caregiver_google_connections SET calendar_id=_calendar,calendar_name=_name,updated_at=clock_timestamp() WHERE user_id=_user;
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version,desired_action)
 SELECT user_id,id,_calendar,version,CASE WHEN deleted_at IS NULL THEN 'upsert' ELSE 'delete' END FROM public.caregiver_work_shifts WHERE user_id=_user
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET version=EXCLUDED.version,desired_action=EXCLUDED.desired_action,reconciliation_version=gen_random_uuid(),status='pending',attempts=0,last_error=NULL,updated_at=clock_timestamp();
END $$;