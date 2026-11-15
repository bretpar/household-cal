CREATE OR REPLACE FUNCTION public.guard_caregiver_hard_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Use soft deletion for shifts and the account deletion flow for workspaces'; END IF;
 IF TG_TABLE_NAME='caregiver_workspaces' AND EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=OLD.user_id AND calendar_id IS NOT NULL) THEN
 IF EXISTS (SELECT 1 FROM public.caregiver_work_shifts s JOIN public.caregiver_google_connections c ON c.user_id=s.user_id LEFT JOIN public.caregiver_google_deliveries d ON d.shift_id=s.id AND d.calendar_id=c.calendar_id WHERE s.user_id=OLD.user_id AND (s.deleted_at IS NULL OR d.shift_id IS NULL OR d.version<>s.version OR d.status<>'synced' OR d.lease_until>now())) OR EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=OLD.user_id AND status<>'disconnected') THEN RAISE EXCEPTION 'Finish personal Google cleanup before deleting this account'; END IF;
 END IF;
 IF TG_TABLE_NAME='caregiver_work_shifts' AND EXISTS (SELECT 1 FROM public.caregiver_google_connections c LEFT JOIN public.caregiver_google_deliveries d ON d.shift_id=OLD.id AND d.calendar_id=c.calendar_id WHERE c.user_id=OLD.user_id AND c.calendar_id IS NOT NULL AND (OLD.deleted_at IS NULL OR d.shift_id IS NULL OR d.version<>OLD.version OR d.status<>'synced' OR d.lease_until>now())) THEN RAISE EXCEPTION 'Finish Google deletion before removing shift history'; END IF;
 RETURN OLD;
END $$;
CREATE OR REPLACE FUNCTION public.save_household_google_credentials(_user uuid,_family uuid,_email text,_ciphertext text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved_connection_id uuid;
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 IF NOT EXISTS (SELECT 1 FROM public.family_users WHERE user_id=_user AND family_id=_family AND role='owner') THEN RAISE EXCEPTION 'Only household owners can connect Google'; END IF;
 IF EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=_user AND status<>'disconnected') THEN RAISE EXCEPTION 'Disconnect personal Google before connecting a household'; END IF;
 INSERT INTO public.google_connections(family_id,connected_by,account_email,google_account_id,status,last_error) VALUES (_family,_user,_email,_email,'connected',NULL)
 ON CONFLICT (family_id) DO UPDATE SET connected_by=EXCLUDED.connected_by,account_email=EXCLUDED.account_email,google_account_id=EXCLUDED.google_account_id,status='connected',last_error=NULL RETURNING id INTO saved_connection_id;
 INSERT INTO public.google_connection_secrets(connection_id,connection_key_ciphertext,updated_at) VALUES (saved_connection_id,_ciphertext,clock_timestamp()) ON CONFLICT ON CONSTRAINT google_connection_secrets_pkey DO UPDATE SET connection_key_ciphertext=EXCLUDED.connection_key_ciphertext,updated_at=EXCLUDED.updated_at;
END $$;