ALTER TABLE public.caregiver_workspaces ADD COLUMN onboarding_finished_at timestamptz DEFAULT now();
ALTER TABLE public.caregiver_google_deliveries ADD COLUMN desired_action text NOT NULL DEFAULT 'upsert' CHECK (desired_action IN ('upsert','delete'));
CREATE OR REPLACE FUNCTION public.select_caregiver_google_calendar(_user uuid,_calendar text,_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prior text;
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 IF EXISTS (SELECT 1 FROM public.account_deletion_jobs WHERE user_id=_user AND status<>'completed') THEN RAISE EXCEPTION 'Account deletion is in progress'; END IF;
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
CREATE OR REPLACE FUNCTION public.caregiver_queue_shift() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE destination text;
BEGIN
 PERFORM 1 FROM public.caregiver_workspaces WHERE user_id=NEW.user_id FOR UPDATE;
 SELECT calendar_id INTO destination FROM public.caregiver_google_connections WHERE user_id=NEW.user_id;
 UPDATE public.caregiver_google_deliveries SET version=NEW.version,status='pending',attempts=0,last_error=NULL,updated_at=clock_timestamp() WHERE shift_id=NEW.id AND calendar_id IS DISTINCT FROM destination AND desired_action='delete' AND version IS DISTINCT FROM NEW.version;
 IF destination IS NOT NULL THEN
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version,desired_action) VALUES (NEW.user_id,NEW.id,destination,NEW.version,CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END)
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET version=EXCLUDED.version,desired_action=EXCLUDED.desired_action,status='pending',attempts=0,last_error=NULL,updated_at=clock_timestamp();
 END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.claim_caregiver_google_delivery(_user uuid) RETURNS SETOF public.caregiver_google_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE chosen public.caregiver_google_deliveries;
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 SELECT d.* INTO chosen FROM public.caregiver_google_deliveries d JOIN public.caregiver_google_connections c ON c.user_id=d.user_id
 WHERE d.user_id=_user AND d.status<>'synced' AND c.status='connected'
 AND (d.lease_until IS NULL OR d.lease_until<now())
 AND (d.desired_action='delete' OR (c.calendar_id=d.calendar_id AND NOT EXISTS (SELECT 1 FROM public.caregiver_google_deliveries old WHERE old.user_id=_user AND old.calendar_id<>c.calendar_id AND (old.status<>'synced' OR old.lease_until IS NOT NULL))))
 ORDER BY CASE WHEN d.desired_action='delete' THEN 0 ELSE 1 END,d.updated_at FOR UPDATE OF d SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY UPDATE public.caregiver_google_deliveries SET lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',lease_reconciliation_version=reconciliation_version,attempts=attempts+1 WHERE shift_id=chosen.shift_id AND calendar_id=chosen.calendar_id RETURNING *;
END $$;
CREATE OR REPLACE FUNCTION public.check_caregiver_google_lease(_user uuid,_shift uuid,_calendar text,_lease uuid,_version uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.caregiver_google_deliveries d JOIN public.caregiver_google_connections c ON c.user_id=d.user_id WHERE d.user_id=_user AND d.shift_id=_shift AND d.calendar_id=_calendar AND d.lease_token=_lease AND d.lease_until>now() AND d.version=_version AND d.reconciliation_version=d.lease_reconciliation_version AND c.status='connected' AND (d.desired_action='delete' OR (c.calendar_id=_calendar AND NOT EXISTS (SELECT 1 FROM public.caregiver_google_deliveries old WHERE old.user_id=_user AND old.calendar_id<>c.calendar_id AND (old.status<>'synced' OR old.lease_until IS NOT NULL)))))
$$;