CREATE OR REPLACE FUNCTION public.prepare_caregiver_google_deletion(_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 IF EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=_user AND calendar_id IS NOT NULL) THEN
 IF EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=_user AND calendar_id IS NOT NULL AND (status<>'connected' OR connection_key_ciphertext='')) THEN RAISE EXCEPTION 'Reconnect personal Google before deleting this account so remote shifts can be removed safely'; END IF;
 IF EXISTS (SELECT 1 FROM public.caregiver_google_deliveries WHERE user_id=_user AND lease_until>now()) THEN RAISE EXCEPTION 'Google sync is still running. Wait for it to finish before deleting this account'; END IF;
 UPDATE public.caregiver_work_shifts SET deleted_at=clock_timestamp() WHERE user_id=_user AND deleted_at IS NULL;
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version)
 SELECT s.user_id,s.id,c.calendar_id,s.version FROM public.caregiver_work_shifts s JOIN public.caregiver_google_connections c ON c.user_id=s.user_id WHERE s.user_id=_user AND c.calendar_id IS NOT NULL
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET version=EXCLUDED.version,reconciliation_version=gen_random_uuid(),status='pending',last_error=NULL,updated_at=clock_timestamp()
 WHERE caregiver_google_deliveries.version IS DISTINCT FROM EXCLUDED.version;
 END IF;
END $$;