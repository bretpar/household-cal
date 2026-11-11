-- Future-write guards only; no existing calendar/event rows are changed.
CREATE OR REPLACE FUNCTION public.assert_google_inbound_idle(_family uuid, _event uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only'; END IF;
  -- Local event writes already hold this lock. Member writes take it too below.
  PERFORM 1 FROM public.events WHERE id=_event AND family_id=_family FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.google_sync_outbox WHERE family_id=_family AND event_id=_event AND (status IN ('pending','needs_attention') OR lease_token IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='PGC01', MESSAGE='Inbound Google change deferred: outbound delivery outstanding';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_google_inbound_idle(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_google_inbound_idle(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_google_inbound_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.last_change_source='google' AND NEW.split_from_event_id IS NOT NULL THEN
      PERFORM public.assert_google_inbound_idle(NEW.family_id,NEW.split_from_event_id);
    END IF;
  ELSIF TG_OP='DELETE' THEN
    IF current_setting('ofc.google_inbound_delete',true)='true' THEN
      PERFORM public.assert_google_inbound_idle(OLD.family_id,OLD.id);
    END IF;
    RETURN OLD;
  ELSIF auth.role()='service_role' AND (NEW.last_change_source='google' OR current_setting('ofc.google_inbound_write',true)='true') THEN
    PERFORM public.assert_google_inbound_idle(NEW.family_id,NEW.id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_google_inbound_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER google_inbound_guard BEFORE INSERT OR UPDATE OF title,start_at,end_at,all_day,location,notes,recurrence_rule,recurrence_until,excluded_dates,calendar_source_id,external_event_id,external_recurring_event_id,last_change_source OR DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.guard_google_inbound_event();

-- Serialize participant-only local saves with inbound final writes and their
-- transactional outbox trigger, in deterministic event-ID order.
CREATE OR REPLACE FUNCTION public.lock_google_member_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[];
BEGIN
  IF TG_OP='INSERT' THEN ids:=ARRAY[NEW.event_id];
  ELSIF TG_OP='DELETE' THEN ids:=ARRAY[OLD.event_id];
  ELSE ids:=ARRAY[OLD.event_id,NEW.event_id]; END IF;
  PERFORM 1 FROM public.events WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.lock_google_member_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER google_member_event_lock BEFORE INSERT OR UPDATE OR DELETE ON public.event_members FOR EACH ROW EXECUTE FUNCTION public.lock_google_member_event();

CREATE OR REPLACE FUNCTION public.remove_google_inbound_branch(_family uuid,_event uuid,_link uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE branch text; r record; next_days text[];
BEGIN
  PERFORM public.assert_google_inbound_idle(_family,_event);
  SELECT branch_key INTO branch FROM public.event_sync_links WHERE id=_link AND event_id=_event AND family_id=_family;
  IF branch IS NULL THEN RAISE EXCEPTION 'Google branch not found'; END IF;
  IF branch='' THEN RETURN; END IF;
  FOR r IN SELECT family_member_id,weekdays FROM public.event_members WHERE event_id=_event LOOP
    IF r.weekdays IS NULL THEN CONTINUE; END IF;
    SELECT coalesce(array_agg(d),'{}'::text[]) INTO next_days FROM unnest(r.weekdays) AS d WHERE NOT (d=ANY(string_to_array(branch,',')));
    IF next_days IS NOT DISTINCT FROM r.weekdays THEN CONTINUE; END IF;
    IF cardinality(next_days)=0 THEN DELETE FROM public.event_members WHERE event_id=_event AND family_member_id=r.family_member_id;
    ELSE UPDATE public.event_members SET weekdays=next_days WHERE event_id=_event AND family_member_id=r.family_member_id; END IF;
  END LOOP;
  DELETE FROM public.event_sync_links WHERE id=_link AND event_id=_event AND family_id=_family;
END $$;
REVOKE ALL ON FUNCTION public.remove_google_inbound_branch(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.remove_google_inbound_branch(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.google_apply_exception_atomic(_family uuid,_source uuid,_parent uuid,_day date,_event jsonb,_member_ids jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE parent public.events; shift public.babysitter_shifts; replacement uuid; member_id uuid;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  SELECT * INTO parent FROM public.events WHERE id=_parent AND family_id=_family FOR UPDATE;
  IF parent.id IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
  PERFORM public.assert_google_inbound_idle(_family,_parent);
  IF NOT EXISTS (SELECT 1 FROM public.calendar_sources WHERE id=_source AND family_id=_family) THEN RAISE EXCEPTION 'Calendar not found'; END IF;
  SELECT e.id INTO replacement FROM public.events e WHERE e.family_id=_family AND e.split_from_event_id=parent.id AND e.split_from_date=_day ORDER BY e.created_at LIMIT 1;
  IF replacement IS NOT NULL AND _day::text=ANY(coalesce(parent.excluded_dates,'{}'::text[])) THEN RETURN replacement; END IF;
  INSERT INTO public.events(family_id,calendar_source_id,title,start_at,end_at,all_day,location,notes,event_type,recurrence_rule,recurrence_until,excluded_dates,external_event_id,external_recurring_event_id,needs_family_assignment,split_from_event_id,split_from_date,last_change_source)
  VALUES(_family,_source,_event->>'title',(_event->>'start_at')::timestamptz,(_event->>'end_at')::timestamptz,coalesce((_event->>'all_day')::boolean,false),_event->>'location',_event->>'notes',(_event->>'event_type')::public.event_type,NULL,NULL,'{}'::text[],_event->>'external_event_id',_event->>'external_recurring_event_id',coalesce((_event->>'needs_family_assignment')::boolean,false),parent.id,_day,'google') RETURNING id INTO replacement;
  IF jsonb_typeof(_member_ids)='array' THEN
    FOR member_id IN SELECT value::uuid FROM jsonb_array_elements_text(_member_ids) LOOP
      IF EXISTS (SELECT 1 FROM public.family_members WHERE id=member_id AND family_id=_family) THEN INSERT INTO public.event_members(event_id,family_member_id,weekdays) VALUES(replacement,member_id,NULL); END IF;
    END LOOP;
  END IF;
  SELECT * INTO shift FROM public.babysitter_shifts WHERE event_id=parent.id AND family_id=_family;
  IF shift.id IS NOT NULL THEN INSERT INTO public.babysitter_shifts(family_id,event_id,assignment,family_user_id,assignee_name,assignee_member_id) VALUES(_family,replacement,shift.assignment,shift.family_user_id,shift.assignee_name,shift.assignee_member_id); END IF;
  IF NOT (_day::text=ANY(coalesce(parent.excluded_dates,'{}'::text[]))) THEN
    PERFORM set_config('ofc.google_inbound_write','true',true);
    UPDATE public.events SET excluded_dates=array_append(excluded_dates,_day::text) WHERE id=parent.id;
    PERFORM set_config('ofc.google_inbound_write','false',true);
  END IF;
  RETURN replacement;
END $$;
REVOKE ALL ON FUNCTION public.google_apply_exception_atomic(uuid,uuid,uuid,date,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.google_apply_exception_atomic(uuid,uuid,uuid,date,jsonb,jsonb) TO service_role;