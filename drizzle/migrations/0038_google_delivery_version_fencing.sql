-- Fence acknowledgment against newer committed event/member edits.
CREATE OR REPLACE FUNCTION public.claim_google_delivery(_family uuid, _key text, _event uuid, _source uuid, _payload jsonb, _token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.google_sync_outbox; previous boolean; umbrella uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only'; END IF;
  IF _token IS NULL OR _key IS NULL OR _payload->>'external_calendar_id' IS NULL OR NOT EXISTS (SELECT 1 FROM public.events WHERE id = _event AND family_id = _family) OR NOT EXISTS (SELECT 1 FROM public.calendar_sources WHERE id = _source AND family_id = _family AND provider = 'google' AND external_calendar_id = _payload->>'external_calendar_id') THEN RAISE EXCEPTION 'Invalid Google delivery identity'; END IF;
  SELECT delivery_version INTO umbrella FROM public.google_sync_outbox WHERE family_id = _family AND op_key = 'push:'||_event;
  INSERT INTO public.google_sync_outbox(family_id,op_key,kind,event_id,calendar_source_id,payload) VALUES(_family,_key,'update',_event,_source,_payload) ON CONFLICT(family_id,op_key) DO NOTHING;
  SELECT * INTO r FROM public.google_sync_outbox WHERE family_id = _family AND op_key = _key FOR UPDATE;
  IF r.lease_until > clock_timestamp() THEN RETURN jsonb_build_object('state','held'); END IF;
  previous := r.attempts > 0;
  UPDATE public.google_sync_outbox SET lease_token=_token,lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1,status='pending',payload=_payload || jsonb_build_object('umbrella_version',umbrella),delivery_version=gen_random_uuid(),updated_at=now() WHERE id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('state',CASE WHEN previous THEN 'recover' ELSE 'claimed' END,'id',r.id,'version',r.delivery_version,'token',r.lease_token);
END $$;
CREATE OR REPLACE FUNCTION public.finish_google_delivery(_family uuid, _key text, _token uuid, _version uuid, _remote text, _error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.google_sync_outbox; umbrella uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only'; END IF;
  SELECT * INTO r FROM public.google_sync_outbox WHERE family_id=_family AND op_key=_key FOR UPDATE;
  IF r.id IS NULL OR r.lease_token IS DISTINCT FROM _token OR r.delivery_version IS DISTINCT FROM _version OR r.lease_until <= clock_timestamp() THEN RETURN false; END IF;
  SELECT delivery_version INTO umbrella FROM public.google_sync_outbox WHERE family_id=_family AND op_key='push:'||r.event_id FOR UPDATE;
  IF _error IS NULL AND r.payload->>'umbrella_version' IS DISTINCT FROM umbrella::text THEN
    UPDATE public.google_sync_outbox SET status='pending',lease_token=NULL,lease_until=NULL,last_error='Local event changed during delivery' WHERE id=r.id;
    RETURN false;
  END IF;
  UPDATE public.google_sync_outbox SET status=CASE WHEN _error IS NULL THEN 'synced' ELSE 'needs_attention' END,google_event_id=coalesce(_remote,google_event_id),last_error=_error,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_google_delivery(uuid,text,uuid,uuid,jsonb,uuid), public.finish_google_delivery(uuid,text,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_google_delivery(uuid,text,uuid,uuid,jsonb,uuid), public.finish_google_delivery(uuid,text,uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.check_google_delivery_lease(_family uuid,_key text,_token uuid,_version uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.role()='service_role' AND EXISTS(SELECT 1 FROM public.google_sync_outbox WHERE family_id=_family AND op_key=_key AND lease_token=_token AND delivery_version=_version AND lease_until>clock_timestamp());
$$;
REVOKE ALL ON FUNCTION public.check_google_delivery_lease(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_google_delivery_lease(uuid,text,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_google_inbound_event(_family uuid,_event uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only'; END IF;
 PERFORM set_config('ofc.google_inbound_delete','true',true);
 DELETE FROM public.events WHERE id=_event AND family_id=_family;
END $$;
REVOKE ALL ON FUNCTION public.delete_google_inbound_event(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_google_inbound_event(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_google_local_edit() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF auth.role()='authenticated' THEN NEW.last_change_source:='app'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mark_google_local_edit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER google_mark_local_edit BEFORE UPDATE OF title,start_at,end_at,all_day,location,notes,recurrence_rule,recurrence_until,excluded_dates,calendar_source_id ON public.events FOR EACH ROW EXECUTE FUNCTION public.mark_google_local_edit();