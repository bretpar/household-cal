CREATE OR REPLACE FUNCTION public.guard_google_connection_isolation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid;
BEGIN
 actor:=CASE WHEN TG_TABLE_NAME='google_connections' THEN (to_jsonb(NEW)->>'connected_by')::uuid ELSE (to_jsonb(NEW)->>'user_id')::uuid END;
 IF actor IS NULL OR NEW.status='disconnected' THEN RETURN NEW; END IF;
 -- Status-only failure reports cannot introduce a new connection, and must not
 -- acquire the user lock after holding a connection row needed by reconnect.
 IF TG_OP='UPDATE' AND NEW.status<>'connected' AND
 (CASE WHEN TG_TABLE_NAME='google_connections' THEN to_jsonb(NEW)->>'connected_by' ELSE to_jsonb(NEW)->>'user_id' END)
 IS NOT DISTINCT FROM
 (CASE WHEN TG_TABLE_NAME='google_connections' THEN to_jsonb(OLD)->>'connected_by' ELSE to_jsonb(OLD)->>'user_id' END) THEN RETURN NEW; END IF;
 PERFORM public.lock_caregiver_user(actor);
 IF TG_TABLE_NAME='google_connections' THEN
 IF EXISTS (SELECT 1 FROM public.caregiver_google_connections WHERE user_id=actor AND status<>'disconnected') THEN RAISE EXCEPTION 'Disconnect personal Google before connecting a household'; END IF;
 ELSE
 IF EXISTS (SELECT 1 FROM public.google_connections WHERE connected_by=actor AND status<>'disconnected') THEN RAISE EXCEPTION 'Disconnect household Google before connecting personal work'; END IF;
 END IF;
 RETURN NEW;
END $$;