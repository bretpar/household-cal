CREATE FUNCTION public.lock_caregiver_user(_user uuid) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF _user IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('caregiver:'||_user::text,0)); END IF; END $$;
REVOKE ALL ON FUNCTION public.lock_caregiver_user(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_caregiver_user(uuid) TO service_role;
CREATE FUNCTION public.lock_caregiver_statement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN PERFORM public.lock_caregiver_user(auth.uid()); RETURN NULL; END $$;
CREATE TRIGGER caregiver_shifts_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON public.caregiver_work_shifts FOR EACH STATEMENT EXECUTE FUNCTION public.lock_caregiver_statement();
CREATE TRIGGER caregiver_clients_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON public.caregiver_clients FOR EACH STATEMENT EXECUTE FUNCTION public.lock_caregiver_statement();
CREATE TRIGGER caregiver_workspace_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON public.caregiver_workspaces FOR EACH STATEMENT EXECUTE FUNCTION public.lock_caregiver_statement();
CREATE FUNCTION public.guard_caregiver_hard_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Use soft deletion for shifts and the account deletion flow for workspaces'; END IF;
 IF TG_TABLE_NAME='caregiver_workspaces' AND EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=OLD.user_id AND calendar_id IS NOT NULL) THEN
 IF EXISTS (SELECT 1 FROM public.caregiver_work_shifts WHERE user_id=OLD.user_id AND deleted_at IS NULL) OR EXISTS (SELECT 1 FROM public.caregiver_google_deliveries WHERE user_id=OLD.user_id AND (status<>'synced' OR lease_until>now())) OR EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=OLD.user_id AND status<>'disconnected') THEN RAISE EXCEPTION 'Finish personal Google cleanup before deleting this account'; END IF;
 END IF;
 IF TG_TABLE_NAME='caregiver_work_shifts' AND EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=OLD.user_id AND calendar_id IS NOT NULL) AND (OLD.deleted_at IS NULL OR EXISTS (SELECT 1 FROM public.caregiver_google_deliveries WHERE shift_id=OLD.id AND (status<>'synced' OR lease_until>now()))) THEN RAISE EXCEPTION 'Finish Google deletion before removing shift history'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER caregiver_shift_no_hard_delete BEFORE DELETE ON public.caregiver_work_shifts FOR EACH ROW EXECUTE FUNCTION public.guard_caregiver_hard_delete();
CREATE TRIGGER caregiver_workspace_no_hard_delete BEFORE DELETE ON public.caregiver_workspaces FOR EACH ROW EXECUTE FUNCTION public.guard_caregiver_hard_delete();
CREATE FUNCTION public.guard_google_connection_isolation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid;
BEGIN
 actor:=CASE WHEN TG_TABLE_NAME='google_connections' THEN (to_jsonb(NEW)->>'connected_by')::uuid ELSE (to_jsonb(NEW)->>'user_id')::uuid END;
 IF actor IS NULL OR NEW.status='disconnected' THEN RETURN NEW; END IF;
 PERFORM public.lock_caregiver_user(actor);
 IF TG_TABLE_NAME='google_connections' THEN
 IF EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=actor AND status<>'disconnected') THEN RAISE EXCEPTION 'Disconnect personal Google before connecting a household'; END IF;
 ELSE
 IF EXISTS (SELECT 1 FROM public.google_connections WHERE connected_by=actor AND status<>'disconnected') THEN RAISE EXCEPTION 'Disconnect household Google before connecting personal work'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER household_google_isolation BEFORE INSERT OR UPDATE OF connected_by,status ON public.google_connections FOR EACH ROW EXECUTE FUNCTION public.guard_google_connection_isolation();
CREATE TRIGGER personal_google_isolation BEFORE INSERT OR UPDATE OF status ON public.caregiver_google_connections FOR EACH ROW EXECUTE FUNCTION public.guard_google_connection_isolation();
CREATE OR REPLACE FUNCTION public.save_caregiver_google_oauth(_user uuid,_attempt uuid,_ciphertext text,_email text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE destination text; prior_email text;
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 PERFORM 1 FROM public.caregiver_workspaces WHERE user_id=_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Caregiver account no longer exists'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.caregiver_google_oauth_attempts WHERE id=_attempt AND user_id=_user AND consumed_at IS NOT NULL AND expires_at>now() AND code_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'Google authorization expired'; END IF;
 IF EXISTS (SELECT 1 FROM public.google_connections WHERE connected_by=_user AND status<>'disconnected') THEN RAISE EXCEPTION 'A household Google connection conflicts with personal linking'; END IF;
 SELECT calendar_id,account_email INTO destination,prior_email FROM public.caregiver_google_connections WHERE user_id=_user FOR UPDATE;
 IF destination IS NOT NULL AND prior_email IS NOT NULL AND prior_email IS DISTINCT FROM _email THEN RAISE EXCEPTION 'Reconnect the previously selected Google account to preserve shift identities'; END IF;
 INSERT INTO public.caregiver_google_connections(user_id,connection_key_ciphertext,account_email,status,last_error) VALUES (_user,_ciphertext,_email,'connected',NULL)
 ON CONFLICT (user_id) DO UPDATE SET connection_key_ciphertext=EXCLUDED.connection_key_ciphertext,account_email=EXCLUDED.account_email,status='connected',last_error=NULL,updated_at=clock_timestamp();
 IF destination IS NOT NULL THEN
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version) SELECT user_id,id,destination,version FROM public.caregiver_work_shifts WHERE user_id=_user
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET version=EXCLUDED.version,reconciliation_version=gen_random_uuid(),status='pending',attempts=0,last_error=NULL,updated_at=clock_timestamp();
 END IF;
 UPDATE public.caregiver_google_oauth_attempts SET code_ciphertext=NULL WHERE id=_attempt AND user_id=_user;
END $$;
CREATE OR REPLACE FUNCTION public.claim_caregiver_google_oauth(_user uuid,_attempt uuid,_challenge text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result text;
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 PERFORM 1 FROM public.caregiver_workspaces WHERE user_id=_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Caregiver account no longer exists'; END IF;
 IF EXISTS (SELECT 1 FROM public.google_connections WHERE connected_by=_user AND status<>'disconnected') THEN RAISE EXCEPTION 'A household Google connection conflicts with personal linking'; END IF;
 UPDATE public.caregiver_google_oauth_attempts SET consumed_at=clock_timestamp() WHERE id=_attempt AND user_id=_user AND challenge=_challenge AND expires_at>now() AND consumed_at IS NULL AND code_ciphertext IS NOT NULL RETURNING code_ciphertext INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'Google authorization expired or did not match this caregiver'; END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.select_caregiver_google_calendar(_user uuid,_calendar text,_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prior text;
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 SELECT calendar_id INTO prior FROM public.caregiver_google_connections WHERE user_id=_user AND status='connected' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Connect Google Calendar first'; END IF;
 IF prior IS NOT NULL AND prior<>_calendar THEN RAISE EXCEPTION 'Keep the current work calendar to preserve existing Google shift identities'; END IF;
 UPDATE public.caregiver_google_connections SET calendar_id=_calendar,calendar_name=_name,updated_at=now() WHERE user_id=_user;
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version) SELECT user_id,id,_calendar,version FROM public.caregiver_work_shifts WHERE user_id=_user AND deleted_at IS NULL
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET version=EXCLUDED.version,reconciliation_version=gen_random_uuid(),status='pending',last_error=NULL,updated_at=now();
END $$;
CREATE FUNCTION public.check_caregiver_google_lease(_user uuid,_shift uuid,_calendar text,_lease uuid,_version uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.caregiver_google_deliveries d JOIN public.caregiver_google_connections c ON c.user_id=d.user_id WHERE d.user_id=_user AND d.shift_id=_shift AND d.calendar_id=_calendar AND d.lease_token=_lease AND d.lease_until>now() AND d.version=_version AND d.reconciliation_version=d.lease_reconciliation_version AND c.status='connected' AND c.calendar_id=_calendar)
$$;
REVOKE ALL ON FUNCTION public.check_caregiver_google_lease(uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_caregiver_google_lease(uuid,uuid,text,uuid,uuid) TO service_role;
CREATE FUNCTION public.prepare_caregiver_google_deletion(_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 IF EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=_user AND calendar_id IS NOT NULL) THEN
 IF EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=_user AND calendar_id IS NOT NULL AND (status<>'connected' OR connection_key_ciphertext='')) THEN RAISE EXCEPTION 'Reconnect personal Google before deleting this account so remote shifts can be removed safely'; END IF;
 IF EXISTS (SELECT 1 FROM public.caregiver_google_deliveries WHERE user_id=_user AND lease_until>now()) THEN RAISE EXCEPTION 'Google sync is still running. Wait for it to finish before deleting this account'; END IF;
 UPDATE public.caregiver_work_shifts SET deleted_at=clock_timestamp() WHERE user_id=_user AND deleted_at IS NULL;
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version) SELECT s.user_id,s.id,c.calendar_id,s.version FROM public.caregiver_work_shifts s JOIN public.caregiver_google_connections c ON c.user_id=s.user_id WHERE s.user_id=_user AND c.calendar_id IS NOT NULL
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET version=EXCLUDED.version,reconciliation_version=gen_random_uuid(),status='pending',last_error=NULL,updated_at=clock_timestamp();
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.prepare_caregiver_google_deletion(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_caregiver_google_deletion(uuid) TO service_role;