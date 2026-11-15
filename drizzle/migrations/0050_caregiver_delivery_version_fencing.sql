CREATE OR REPLACE FUNCTION public.caregiver_shift_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND ROW(NEW.client_id,NEW.start_at,NEW.end_at,NEW.notes,NEW.deleted_at) IS NOT DISTINCT FROM ROW(OLD.client_id,OLD.start_at,OLD.end_at,OLD.notes,OLD.deleted_at) AND NEW.version = OLD.version THEN
 NEW.updated_at := OLD.updated_at; RETURN NEW;
 END IF;
 IF TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id THEN RAISE EXCEPTION 'Shift ownership cannot change'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.caregiver_clients WHERE id = NEW.client_id AND user_id = NEW.user_id AND (NOT archived OR TG_OP = 'UPDATE')) THEN RAISE EXCEPTION 'Choose an available family contact'; END IF;
 NEW.version := gen_random_uuid(); NEW.updated_at := clock_timestamp(); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.finish_caregiver_google_delivery(_shift uuid,_calendar text,_lease uuid,_version uuid,_error text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 UPDATE public.caregiver_google_deliveries SET status=CASE WHEN version<>_version THEN 'pending' WHEN NULLIF(_error,'') IS NULL THEN 'synced' ELSE 'needs_attention' END,
 last_error=CASE WHEN version=_version THEN NULLIF(_error,'') ELSE NULL END,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE shift_id=_shift AND calendar_id=_calendar AND lease_token=_lease;
END $$;