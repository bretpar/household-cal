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
  IF replacement IS NOT NULL AND _day=ANY(coalesce(parent.excluded_dates,'{}'::date[])) THEN RETURN replacement; END IF;
  IF replacement IS NULL THEN
  INSERT INTO public.events(family_id,calendar_source_id,title,start_at,end_at,all_day,location,notes,event_type,recurrence_rule,recurrence_until,excluded_dates,external_event_id,external_recurring_event_id,needs_family_assignment,split_from_event_id,split_from_date,last_change_source)
  VALUES(_family,_source,_event->>'title',(_event->>'start_at')::timestamptz,(_event->>'end_at')::timestamptz,coalesce((_event->>'all_day')::boolean,false),_event->>'location',_event->>'notes',(_event->>'event_type')::public.event_type,NULL,NULL,'{}'::date[],_event->>'external_event_id',_event->>'external_recurring_event_id',coalesce((_event->>'needs_family_assignment')::boolean,false),parent.id,_day,'google') RETURNING id INTO replacement;
  IF jsonb_typeof(_member_ids)='array' THEN
    FOR member_id IN SELECT value::uuid FROM jsonb_array_elements_text(_member_ids) LOOP
      IF EXISTS (SELECT 1 FROM public.family_members WHERE id=member_id AND family_id=_family) THEN INSERT INTO public.event_members(event_id,family_member_id,weekdays) VALUES(replacement,member_id,NULL); END IF;
    END LOOP;
  END IF;
  SELECT * INTO shift FROM public.babysitter_shifts WHERE event_id=parent.id AND family_id=_family;
  IF shift.id IS NOT NULL THEN INSERT INTO public.babysitter_shifts(family_id,event_id,assignment,family_user_id,assignee_name,assignee_member_id) VALUES(_family,replacement,shift.assignment,shift.family_user_id,shift.assignee_name,shift.assignee_member_id); END IF;
  END IF;
  IF NOT (_day=ANY(coalesce(parent.excluded_dates,'{}'::date[]))) THEN
    PERFORM set_config('ofc.google_inbound_write','true',true);
    UPDATE public.events SET excluded_dates=array_append(coalesce(excluded_dates,'{}'::date[]),_day) WHERE id=parent.id;
    PERFORM set_config('ofc.google_inbound_write','false',true);
  END IF;
  RETURN replacement;
END $$;
REVOKE ALL ON FUNCTION public.google_apply_exception_atomic(uuid,uuid,uuid,date,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.google_apply_exception_atomic(uuid,uuid,uuid,date,jsonb,jsonb) TO service_role;