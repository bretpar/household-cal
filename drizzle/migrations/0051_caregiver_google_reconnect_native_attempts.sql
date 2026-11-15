CREATE TABLE public.caregiver_google_oauth_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.caregiver_workspaces(user_id) ON DELETE CASCADE,
 challenge text NOT NULL, return_secret text NOT NULL, mode text NOT NULL CHECK (mode IN ('web','native')),
 code_ciphertext text, expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', consumed_at timestamptz
);
GRANT ALL ON public.caregiver_google_oauth_attempts TO service_role;
ALTER TABLE public.caregiver_google_oauth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caregiver_google_deliveries ADD COLUMN reconciliation_version uuid NOT NULL DEFAULT gen_random_uuid(), ADD COLUMN lease_reconciliation_version uuid;
CREATE OR REPLACE FUNCTION public.caregiver_queue_shift() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE destination text;
BEGIN
 PERFORM 1 FROM public.caregiver_workspaces WHERE user_id=NEW.user_id FOR UPDATE;
 SELECT calendar_id INTO destination FROM public.caregiver_google_connections WHERE user_id=NEW.user_id AND status<>'disconnected';
 IF destination IS NOT NULL THEN
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version) VALUES (NEW.user_id,NEW.id,destination,NEW.version)
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET version=EXCLUDED.version,status='pending',attempts=0,last_error=NULL,updated_at=clock_timestamp();
 END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.claim_caregiver_google_delivery(_user uuid) RETURNS SETOF public.caregiver_google_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE chosen public.caregiver_google_deliveries;
BEGIN
 SELECT d.* INTO chosen FROM public.caregiver_google_deliveries d JOIN public.caregiver_google_connections c ON c.user_id=d.user_id
 WHERE d.user_id=_user AND d.status<>'synced' AND c.status='connected' AND c.calendar_id=d.calendar_id
 AND (d.lease_until IS NULL OR d.lease_until<now()) ORDER BY d.updated_at FOR UPDATE OF d SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY UPDATE public.caregiver_google_deliveries SET lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',lease_reconciliation_version=reconciliation_version,attempts=attempts+1
 WHERE shift_id=chosen.shift_id AND calendar_id=chosen.calendar_id RETURNING *;
END $$;
CREATE OR REPLACE FUNCTION public.finish_caregiver_google_delivery(_shift uuid,_calendar text,_lease uuid,_version uuid,_error text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.caregiver_google_deliveries SET status=CASE WHEN version<>_version OR reconciliation_version IS DISTINCT FROM lease_reconciliation_version THEN 'pending' WHEN NULLIF(_error,'') IS NULL THEN 'synced' ELSE 'needs_attention' END,
 last_error=CASE WHEN version=_version AND reconciliation_version=lease_reconciliation_version THEN NULLIF(_error,'') ELSE NULL END,
 lease_token=NULL,lease_until=NULL,lease_reconciliation_version=NULL,updated_at=clock_timestamp()
 WHERE shift_id=_shift AND calendar_id=_calendar AND lease_token=_lease;
END $$;
CREATE FUNCTION public.claim_caregiver_google_oauth(_user uuid,_attempt uuid,_challenge text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result text;
BEGIN
 PERFORM 1 FROM public.caregiver_workspaces WHERE user_id=_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Caregiver account no longer exists'; END IF;
 IF EXISTS (SELECT 1 FROM public.google_connections WHERE connected_by=_user AND status<>'disconnected') THEN RAISE EXCEPTION 'A household Google connection conflicts with personal linking'; END IF;
 UPDATE public.caregiver_google_oauth_attempts SET consumed_at=clock_timestamp()
 WHERE id=_attempt AND user_id=_user AND challenge=_challenge AND expires_at>now() AND consumed_at IS NULL AND code_ciphertext IS NOT NULL
 RETURNING code_ciphertext INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'Google authorization expired or did not match this caregiver'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.claim_caregiver_google_oauth(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_caregiver_google_oauth(uuid,uuid,text) TO service_role;
CREATE FUNCTION public.save_caregiver_google_oauth(_user uuid,_attempt uuid,_ciphertext text,_email text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE destination text; prior_email text;
BEGIN
 PERFORM 1 FROM public.caregiver_workspaces WHERE user_id=_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Caregiver account no longer exists'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.caregiver_google_oauth_attempts WHERE id=_attempt AND user_id=_user AND consumed_at IS NOT NULL AND expires_at>now() AND code_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'Google authorization expired'; END IF;
 IF EXISTS (SELECT 1 FROM public.google_connections WHERE connected_by=_user AND status<>'disconnected') THEN RAISE EXCEPTION 'A household Google connection conflicts with personal linking'; END IF;
 SELECT calendar_id,account_email INTO destination,prior_email FROM public.caregiver_google_connections WHERE user_id=_user FOR UPDATE;
 IF destination IS NOT NULL AND prior_email IS NOT NULL AND prior_email IS DISTINCT FROM _email THEN RAISE EXCEPTION 'Reconnect the previously selected Google account to preserve shift identities'; END IF;
 INSERT INTO public.caregiver_google_connections(user_id,connection_key_ciphertext,account_email,status,last_error) VALUES (_user,_ciphertext,_email,'connected',NULL)
 ON CONFLICT (user_id) DO UPDATE SET connection_key_ciphertext=EXCLUDED.connection_key_ciphertext,account_email=EXCLUDED.account_email,status='connected',last_error=NULL,updated_at=clock_timestamp();
 IF destination IS NOT NULL THEN
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version)
 SELECT user_id,id,destination,version FROM public.caregiver_work_shifts WHERE user_id=_user
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET version=EXCLUDED.version,reconciliation_version=gen_random_uuid(),status='pending',attempts=0,last_error=NULL,updated_at=clock_timestamp();
 END IF;
 UPDATE public.caregiver_google_oauth_attempts SET code_ciphertext=NULL WHERE id=_attempt AND user_id=_user;
END $$;
REVOKE ALL ON FUNCTION public.save_caregiver_google_oauth(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_caregiver_google_oauth(uuid,uuid,text,text) TO service_role;