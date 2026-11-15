CREATE FUNCTION public.change_caregiver_google_calendar(_user uuid,_calendar text,_name text,_expected text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 IF NOT EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=_user AND status='connected' AND connection_key_ciphertext=_expected) THEN RAISE EXCEPTION 'Google authorization changed. Refresh before choosing a calendar'; END IF;
 IF EXISTS (SELECT 1 FROM public.google_connections WHERE connected_by=_user AND status<>'disconnected') THEN RAISE EXCEPTION 'A household Google connection conflicts with personal linking'; END IF;
 PERFORM public.select_caregiver_google_calendar(_user,_calendar,_name);
END $$;
REVOKE ALL ON FUNCTION public.change_caregiver_google_calendar(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_caregiver_google_calendar(uuid,text,text,text) TO service_role;