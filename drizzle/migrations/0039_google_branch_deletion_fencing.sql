-- Share the existing source/event/branch lease with obsolete deletion and fence its completion.
CREATE OR REPLACE FUNCTION public.finish_google_branch_deletion(_family uuid, _key text, _token uuid, _version uuid, _remote text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.google_sync_outbox; umbrella uuid; changed boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only'; END IF;
 SELECT * INTO r FROM public.google_sync_outbox WHERE family_id=_family AND op_key=_key FOR UPDATE;
 IF r.id IS NULL OR r.payload->>'deleting' IS DISTINCT FROM 'true' THEN RETURN false; END IF;
 SELECT delivery_version INTO umbrella FROM public.google_sync_outbox WHERE family_id=_family AND op_key='push:'||r.event_id FOR UPDATE;
 IF r.lease_token IS DISTINCT FROM _token OR r.delivery_version IS DISTINCT FROM _version OR r.lease_until <= clock_timestamp() THEN
   PERFORM public.queue_google_event_delivery(r.event_id);
   RETURN false;
 END IF;
 changed := r.payload->>'umbrella_version' IS DISTINCT FROM umbrella::text;
 -- Keep the cancelled identity as the deterministic next-create generation seed.
 UPDATE public.google_sync_outbox SET google_event_id=_remote,status=CASE WHEN changed THEN 'needs_attention' ELSE 'synced' END,last_error=CASE WHEN changed THEN 'Branch changed during remote deletion; restoration required' ELSE NULL END,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=r.id;
 IF changed THEN
   PERFORM public.queue_google_event_delivery(r.event_id);
 ELSE
   DELETE FROM public.event_sync_links WHERE family_id=_family AND event_id=r.event_id AND calendar_source_id=r.calendar_source_id AND branch_key=r.payload->>'branch_key' AND google_event_id=_remote;
 END IF;
 RETURN NOT changed;
END $$;
REVOKE ALL ON FUNCTION public.finish_google_branch_deletion(uuid,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_google_branch_deletion(uuid,text,uuid,uuid,text) TO service_role;