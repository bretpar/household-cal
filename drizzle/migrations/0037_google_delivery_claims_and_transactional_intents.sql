-- Forward-only delivery safeguards. No existing event data is modified.
ALTER TABLE public.google_sync_outbox ADD COLUMN IF NOT EXISTS delivery_version uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.google_sync_outbox ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE public.google_sync_outbox ADD COLUMN IF NOT EXISTS lease_until timestamptz;

CREATE OR REPLACE FUNCTION public.claim_google_delivery(_family uuid, _key text, _event uuid, _source uuid, _payload jsonb, _token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.google_sync_outbox; previous boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only'; END IF;
  IF _token IS NULL OR _key IS NULL OR _payload->>'external_calendar_id' IS NULL OR NOT EXISTS (SELECT 1 FROM public.events WHERE id = _event AND family_id = _family) OR NOT EXISTS (SELECT 1 FROM public.calendar_sources WHERE id = _source AND family_id = _family AND provider = 'google' AND external_calendar_id = _payload->>'external_calendar_id') THEN RAISE EXCEPTION 'Invalid Google delivery identity'; END IF;
  INSERT INTO public.google_sync_outbox(family_id,op_key,kind,event_id,calendar_source_id,payload) VALUES(_family,_key,'update',_event,_source,_payload) ON CONFLICT(family_id,op_key) DO NOTHING;
  SELECT * INTO r FROM public.google_sync_outbox WHERE family_id = _family AND op_key = _key FOR UPDATE;
  IF r.lease_until > clock_timestamp() THEN RETURN jsonb_build_object('state','held'); END IF;
  previous := r.attempts > 0;
  UPDATE public.google_sync_outbox SET lease_token = _token, lease_until = clock_timestamp() + interval '5 minutes', attempts = attempts + 1, status = 'pending', payload = _payload, delivery_version = gen_random_uuid(), updated_at = now() WHERE id = r.id RETURNING * INTO r;
  RETURN jsonb_build_object('state',CASE WHEN previous THEN 'recover' ELSE 'claimed' END,'id',r.id,'version',r.delivery_version,'token',r.lease_token);
END $$;
REVOKE ALL ON FUNCTION public.claim_google_delivery(uuid,text,uuid,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_google_delivery(uuid,text,uuid,uuid,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_google_delivery(_family uuid, _key text, _token uuid, _version uuid, _remote text, _error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only'; END IF;
  UPDATE public.google_sync_outbox SET status = CASE WHEN _error IS NULL THEN 'synced' ELSE 'needs_attention' END, google_event_id = coalesce(_remote,google_event_id), last_error = _error, lease_token = NULL, lease_until = NULL, updated_at = now()
  WHERE family_id = _family AND op_key = _key AND lease_token = _token AND delivery_version = _version AND lease_until > clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;
REVOKE ALL ON FUNCTION public.finish_google_delivery(uuid,text,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_google_delivery(uuid,text,uuid,uuid,text,text) TO service_role;

-- The umbrella row is written in the same transaction as every local body or
-- participant change. Version fencing prevents an older delivery clearing edits.
CREATE OR REPLACE FUNCTION public.queue_google_event_delivery(_event uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.events;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = _event;
  IF e.id IS NULL OR e.last_change_source = 'google' THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.calendar_sources WHERE id = e.calendar_source_id AND (provider = 'ics' OR (provider = 'local' AND calendar_kind = 'custom'))) THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_sync_links WHERE event_id = e.id AND family_id = e.family_id) AND NOT EXISTS(SELECT 1 FROM public.calendar_sources WHERE family_id = e.family_id AND provider = 'google' AND external_calendar_id IS NOT NULL AND (id = e.calendar_source_id OR is_main)) THEN RETURN; END IF;
  INSERT INTO public.google_sync_outbox(family_id,op_key,kind,event_id,payload) VALUES(e.family_id,'push:'||e.id,'update',e.id,jsonb_build_object('committed',true))
  ON CONFLICT(family_id,op_key) DO UPDATE SET status='pending',last_error=NULL,delivery_version=gen_random_uuid(),payload=EXCLUDED.payload,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.queue_google_event_delivery(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_google_event_delivery(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.google_event_delivery_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; destination text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('ofc.google_inbound_delete',true),'') <> 'true' THEN
      FOR l IN SELECT * FROM public.event_sync_links WHERE event_id = OLD.id AND family_id = OLD.family_id LOOP
        SELECT external_calendar_id INTO destination FROM public.calendar_sources WHERE id = l.calendar_source_id AND family_id = OLD.family_id AND provider = 'google';
        IF destination IS NULL OR destination = '' OR l.google_event_id IS NULL OR l.google_event_id = '' THEN RAISE EXCEPTION 'Cannot durably identify Google deletion destination'; END IF;
        INSERT INTO public.google_sync_outbox(family_id,op_key,kind,event_id,calendar_source_id,google_event_id,payload)
        VALUES(OLD.family_id,'delete:'||l.calendar_source_id||':'||l.google_event_id,'delete',OLD.id,l.calendar_source_id,l.google_event_id,jsonb_build_object('external_calendar_id',destination,'branch_key',l.branch_key,'committed',true,'local_delete',true))
        ON CONFLICT(family_id,op_key) DO UPDATE SET payload=EXCLUDED.payload,status='pending',last_error=NULL,delivery_version=gen_random_uuid(),updated_at=now();
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;
  PERFORM public.queue_google_event_delivery(NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.google_event_delivery_trigger() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER google_delete_intent_before_event BEFORE DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.google_event_delivery_trigger();
CREATE TRIGGER google_delivery_after_event AFTER INSERT OR UPDATE OF title,start_at,end_at,all_day,location,notes,recurrence_rule,recurrence_until,excluded_dates,calendar_source_id ON public.events FOR EACH ROW EXECUTE FUNCTION public.google_event_delivery_trigger();

CREATE OR REPLACE FUNCTION public.google_member_delivery_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM public.queue_google_event_delivery(OLD.event_id); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM public.queue_google_event_delivery(NEW.event_id); RETURN NEW; END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.google_member_delivery_trigger() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER google_delivery_after_member AFTER INSERT OR UPDATE OR DELETE ON public.event_members FOR EACH ROW EXECUTE FUNCTION public.google_member_delivery_trigger();