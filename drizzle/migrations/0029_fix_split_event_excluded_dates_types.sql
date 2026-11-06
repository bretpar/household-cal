-- Corrects date[]/text mismatches in split_calendar_event_atomic introduced by 0022 (events.excluded_dates is date[]).
CREATE OR REPLACE FUNCTION public.split_calendar_event_atomic(_event uuid, _day date, _scope text, _input jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE original public.events; replacement uuid; family uuid; source uuid; childcare uuid; member_id uuid; days text[]; assignment jsonb; inherited public.babysitter_shifts; caregiver uuid; login_id uuid;
BEGIN
  SELECT family_id INTO family FROM public.events WHERE id=_event;
  IF family IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
  PERFORM public.lock_timesheet_household(family);
  IF NOT EXISTS (SELECT 1 FROM public.family_users WHERE family_id=family AND user_id=auth.uid() AND role IN ('owner','editor')) THEN RAISE EXCEPTION 'You do not have permission to change this calendar'; END IF;
  SELECT * INTO original FROM public.events WHERE id=_event AND family_id=family FOR UPDATE;
  IF original.id IS NULL OR original.recurrence_rule IS NULL OR _scope NOT IN ('this','future') OR _scope IS NULL OR _day IS NULL THEN RAISE EXCEPTION 'This recurring event changed. Refresh and try again.'; END IF;
  IF _day = ANY(original.excluded_dates) OR (original.recurrence_until IS NOT NULL AND _day > original.recurrence_until) THEN RAISE EXCEPTION 'This occurrence was already changed. Refresh and try again.'; END IF;
  IF EXISTS (SELECT 1 FROM public.calendar_sources WHERE id=original.calendar_source_id AND provider='ics') THEN RAISE EXCEPTION 'This subscribed event is read only'; END IF;
  source := coalesce((_input->>'calendar_source_id')::uuid, original.calendar_source_id);
  IF source IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.calendar_sources WHERE id=source AND family_id=family) THEN RAISE EXCEPTION 'Calendar not found'; END IF;
  IF source IS DISTINCT FROM original.calendar_source_id AND NOT EXISTS (SELECT 1 FROM public.calendar_sources WHERE id=source AND family_id=family AND active AND (provider='google' OR (provider='local' AND calendar_kind IN ('household_default','custom')))) THEN RAISE EXCEPTION 'That calendar cannot receive new events'; END IF;
  IF nullif(btrim(_input->>'title'),'') IS NULL OR jsonb_typeof(_input->'member_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid event'; END IF;
  IF (_input->>'category_id') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.event_categories WHERE id=(_input->>'category_id')::uuid AND family_id=family) THEN RAISE EXCEPTION 'Category not found'; END IF;
  SELECT babysitter_calendar_source_id INTO childcare FROM public.families WHERE id=family;
  assignment := _input->'babysitter_assignment';
  IF assignment IS NULL THEN
    SELECT * INTO inherited FROM public.babysitter_shifts WHERE event_id=original.id AND family_id=family;
    IF inherited.id IS NOT NULL THEN
      assignment := CASE inherited.assignment WHEN 'caregiver' THEN jsonb_build_object('kind','caregiver','family_member_id',inherited.assignee_member_id) WHEN 'other' THEN jsonb_build_object('kind','other','name',inherited.assignee_name) ELSE '{"kind":"none"}'::jsonb END;
    END IF;
  END IF;
  INSERT INTO public.events(family_id,calendar_source_id,title,start_at,end_at,all_day,location,notes,event_type,category_id,recurrence_rule,recurrence_until,split_from_event_id,split_from_date,created_by)
  VALUES(family,source,btrim(_input->>'title'),(_input->>'start_at')::timestamptz,(_input->>'end_at')::timestamptz,(_input->>'all_day')::boolean,_input->>'location',_input->>'notes',(_input->>'event_type')::public.event_type,(_input->>'category_id')::uuid,CASE WHEN _scope='this' THEN NULL ELSE _input->>'recurrence_rule' END,CASE WHEN _scope='this' OR _input->>'recurrence_rule' IS NULL THEN NULL ELSE (_input->>'recurrence_until')::date END,original.id,_day,auth.uid()) RETURNING id INTO replacement;
  FOR member_id IN SELECT value::uuid FROM jsonb_array_elements_text(_input->'member_ids') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.family_members WHERE id=member_id AND family_id=family) THEN RAISE EXCEPTION 'Family member not found'; END IF;
    days := NULL;
    IF _scope='future' AND jsonb_typeof(_input->'member_weekdays'->(member_id::text))='array' THEN
      SELECT array_agg(value) INTO days FROM jsonb_array_elements_text(_input->'member_weekdays'->(member_id::text));
    END IF;
    INSERT INTO public.event_members(event_id,family_member_id,weekdays) VALUES(replacement,member_id,days);
  END LOOP;
  IF source=childcare AND assignment IS NOT NULL THEN
    IF assignment->>'kind'='caregiver' THEN
      caregiver := (assignment->>'family_member_id')::uuid;
      IF caregiver IS NULL AND assignment->>'family_user_id' IS NOT NULL THEN SELECT family_member_id INTO caregiver FROM public.family_users WHERE id=(assignment->>'family_user_id')::uuid AND family_id=family; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.family_members WHERE id=caregiver AND family_id=family AND role='caregiver' AND active AND removed_at IS NULL) THEN RAISE EXCEPTION 'Choose an active caregiver'; END IF;
      SELECT p.family_user_id INTO login_id FROM public.babysitter_access_profiles p JOIN public.family_users u ON u.id=p.family_user_id WHERE p.family_id=family AND u.family_id=family AND u.family_member_id=caregiver LIMIT 1;
      INSERT INTO public.babysitter_shifts(family_id,event_id,assignment,assignee_member_id,family_user_id) VALUES(family,replacement,'caregiver',caregiver,login_id);
    ELSIF assignment->>'kind'='other' THEN
      IF nullif(btrim(assignment->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Enter the babysitter name'; END IF;
      INSERT INTO public.babysitter_shifts(family_id,event_id,assignment,assignee_name) VALUES(family,replacement,'other',left(btrim(assignment->>'name'),120));
    ELSIF assignment->>'kind'='none' THEN
      INSERT INTO public.babysitter_shifts(family_id,event_id,assignment) VALUES(family,replacement,'none');
    ELSE RAISE EXCEPTION 'Invalid caregiver assignment'; END IF;
  END IF;
  IF _scope='this' THEN
    UPDATE public.events SET excluded_dates=array_append(coalesce(excluded_dates,'{}'::date[]),_day) WHERE id=original.id;
  ELSE
    UPDATE public.events SET recurrence_until=_day-1 WHERE id=original.id;
  END IF;
  RETURN replacement;
END $$;
REVOKE ALL ON FUNCTION public.split_calendar_event_atomic(uuid,date,text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.split_calendar_event_atomic(uuid,date,text,jsonb) TO authenticated;
