CREATE FUNCTION public.save_household_google_credentials(_user uuid,_family uuid,_email text,_ciphertext text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE connection_id uuid;
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 IF NOT EXISTS (SELECT 1 FROM public.family_users WHERE user_id=_user AND family_id=_family AND role='owner') THEN RAISE EXCEPTION 'Only household owners can connect Google'; END IF;
 IF EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=_user AND status<>'disconnected') THEN RAISE EXCEPTION 'Disconnect personal Google before connecting a household'; END IF;
 INSERT INTO public.google_connections(family_id,connected_by,account_email,google_account_id,status,last_error) VALUES (_family,_user,_email,_email,'connected',NULL)
 ON CONFLICT (family_id) DO UPDATE SET connected_by=EXCLUDED.connected_by,account_email=EXCLUDED.account_email,google_account_id=EXCLUDED.google_account_id,status='connected',last_error=NULL RETURNING id INTO connection_id;
 INSERT INTO public.google_connection_secrets(connection_id,connection_key_ciphertext,updated_at) VALUES (connection_id,_ciphertext,clock_timestamp()) ON CONFLICT ON CONSTRAINT google_connection_secrets_pkey DO UPDATE SET connection_key_ciphertext=EXCLUDED.connection_key_ciphertext,updated_at=EXCLUDED.updated_at;
END $$;
REVOKE ALL ON FUNCTION public.save_household_google_credentials(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_household_google_credentials(uuid,uuid,text,text) TO service_role;