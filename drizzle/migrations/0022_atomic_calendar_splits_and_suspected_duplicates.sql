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
  IF _day::text = ANY(original.excluded_dates) OR (original.recurrence_until IS NOT NULL AND _day > original.recurrence_until) THEN RAISE EXCEPTION 'This occurrence was already changed. Refresh and try again.'; END IF;
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
    UPDATE public.events SET excluded_dates=array_append(coalesce(excluded_dates,'{}'::text[]),_day::text) WHERE id=original.id;
  ELSE
    UPDATE public.events SET recurrence_until=_day-1 WHERE id=original.id;
  END IF;
  RETURN replacement;
END $$;
REVOKE ALL ON FUNCTION public.split_calendar_event_atomic(uuid,date,text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.split_calendar_event_atomic(uuid,date,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.timesheet_entry_duplicate_classification(_entry uuid, _tz text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE y public.timesheet_entries; t public.timesheets; ev public.events; keys text[];
BEGIN
  SELECT * INTO y FROM public.timesheet_entries WHERE id=_entry;
  IF y.id IS NULL OR y.is_manual OR y.event_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.timesheets WHERE id=y.timesheet_id;
  SELECT * INTO ev FROM public.events WHERE id=y.event_id;
  keys := public.timesheet_lineage_keys(y.event_id,y.work_date,_tz);
  IF EXISTS (SELECT 1 FROM public.timesheet_entries f JOIN public.timesheets ft ON ft.id=f.timesheet_id
    WHERE ft.family_id=t.family_id AND ft.family_member_id=t.family_member_id AND ft.id<>t.id AND ft.status NOT IN ('draft','needs_correction')
      AND ((f.event_id=y.event_id AND ev.recurrence_rule IS NULL) OR f.occurrence_key=ANY(keys))) THEN RETURN 'proven'; END IF;
  IF EXISTS (SELECT 1 FROM public.timesheet_entries f JOIN public.timesheets ft ON ft.id=f.timesheet_id LEFT JOIN public.events fe ON fe.id=f.event_id
    WHERE ft.family_id=t.family_id AND ft.family_member_id=t.family_member_id AND ft.id<>t.id AND ft.status NOT IN ('draft','needs_correction')
      AND f.occurrence_key IS DISTINCT FROM y.occurrence_key
      AND ((coalesce(f.scheduled_start,f.actual_start) IS NOT NULL AND coalesce(f.scheduled_end,f.actual_end) IS NOT NULL AND y.scheduled_start IS NOT NULL AND y.scheduled_end IS NOT NULL AND tstzrange(coalesce(f.scheduled_start,f.actual_start),coalesce(f.scheduled_end,f.actual_end)) && tstzrange(y.scheduled_start,y.scheduled_end))
        OR (ev.split_from_event_id IS NULL AND f.event_id IS DISTINCT FROM y.event_id AND abs(f.work_date-y.work_date)<=7
          AND ev.created_at>coalesce(ft.submitted_at,ft.reviewed_at,ft.closed_at,ft.updated_at)
          AND (fe.id IS NULL OR f.work_date::text=ANY(fe.excluded_dates::text[]) OR (fe.recurrence_rule IS NOT NULL AND fe.recurrence_until IS NOT NULL AND fe.recurrence_until<f.work_date))))) THEN RETURN 'suspected'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.timesheet_entry_duplicate_classification(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timesheet_entry_duplicate_classification(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.timesheet_entry_duplicates_finalized(_entry uuid, _tz text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT coalesce(public.timesheet_entry_duplicate_classification(_entry,_tz)='proven',false) $$;
REVOKE ALL ON FUNCTION public.timesheet_entry_duplicates_finalized(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timesheet_entry_duplicates_finalized(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_timesheet_atomic(_family uuid, _member uuid, _settings jsonb, _timezone text, _today date, _start date, _end date, _shifts jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg jsonb; tz text; m public.family_members; t public.timesheets; sh jsonb; e public.timesheet_entries;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  SELECT jsonb_build_object('frequency', frequency, 'anchor_date', anchor_date::text, 'semimonthly_first_end', semimonthly_first_end) INTO cfg FROM public.timesheet_settings WHERE family_id = _family;
  cfg := coalesce(cfg, '{"frequency":"biweekly","anchor_date":"2026-01-04","semimonthly_first_end":15}'::jsonb);
  SELECT coalesce(nullif(timezone,''), 'America/Los_Angeles') INTO tz FROM public.families WHERE id = _family;
  IF cfg IS DISTINCT FROM _settings OR tz IS DISTINCT FROM _timezone OR (clock_timestamp() AT TIME ZONE tz)::date <> _today THEN RAISE EXCEPTION 'Timesheet schedule changed. Refresh and try again.'; END IF;
  SELECT * INTO m FROM public.family_members WHERE id = _member AND family_id = _family;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Caregiver not found'; END IF;
  SELECT * INTO t FROM public.timesheets WHERE family_id = _family AND family_member_id = _member AND period_start = _start FOR UPDATE;
  IF t.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.timesheets WHERE family_id = _family AND family_member_id = _member AND period_start <= _end AND period_end >= _start) THEN RAISE EXCEPTION 'This period overlaps existing timesheet history. No time card was created.'; END IF;
    INSERT INTO public.timesheets(family_id,family_member_id,caregiver_name,period_start,period_end) VALUES (_family,_member,m.name,_start,_end) RETURNING * INTO t;
  END IF;
  IF t.status NOT IN ('draft','needs_correction') THEN RETURN to_jsonb(t); END IF;
  FOR sh IN SELECT * FROM jsonb_array_elements(_shifts) LOOP
    IF (sh->>'work_date')::date < t.period_start OR (sh->>'work_date')::date > t.period_end OR (m.timesheet_start_date IS NOT NULL AND (sh->>'work_date')::date < m.timesheet_start_date) THEN CONTINUE; END IF;
    SELECT * INTO e FROM public.timesheet_entries WHERE timesheet_id=t.id AND occurrence_key=sh->>'occurrence_key' FOR UPDATE;
    IF e.id IS NULL THEN
      INSERT INTO public.timesheet_entries(timesheet_id,family_id,event_id,occurrence_key,work_date,scheduled_title,scheduled_start,scheduled_end,actual_start,actual_end)
      VALUES(t.id,_family,(sh->>'event_id')::uuid,sh->>'occurrence_key',(sh->>'work_date')::date,sh->>'title',(sh->>'start')::timestamptz,(sh->>'end')::timestamptz,(sh->>'start')::timestamptz,(sh->>'end')::timestamptz);
    ELSE
      UPDATE public.timesheet_entries SET scheduled_title=sh->>'title', scheduled_start=(sh->>'start')::timestamptz, scheduled_end=(sh->>'end')::timestamptz,
        actual_start=CASE WHEN NOT actual_time_confirmed AND coalesce(paid_hours,0)=0 AND paid_note IS NULL THEN (sh->>'start')::timestamptz ELSE actual_start END,
        actual_end=CASE WHEN NOT actual_time_confirmed AND coalesce(paid_hours,0)=0 AND paid_note IS NULL THEN (sh->>'end')::timestamptz ELSE actual_end END WHERE id=e.id;
    END IF;
  END LOOP;
  DELETE FROM public.timesheet_entries entry_row WHERE entry_row.timesheet_id=t.id AND NOT entry_row.is_manual AND entry_row.occurrence_key IS NOT NULL
    AND NOT entry_row.actual_time_confirmed AND entry_row.note IS NULL AND coalesce(entry_row.paid_hours,0)=0 AND entry_row.paid_note IS NULL AND entry_row.owner_edited_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_shifts) shift_item WHERE shift_item->>'occurrence_key'=entry_row.occurrence_key);
  UPDATE public.timesheet_entries x SET schedule_conflict_at=coalesce(x.schedule_conflict_at, clock_timestamp()), schedule_conflict_reason='moved'
    WHERE x.timesheet_id=t.id AND NOT x.is_manual AND x.occurrence_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_shifts) moved_item WHERE moved_item->>'occurrence_key'=x.occurrence_key);
  UPDATE public.timesheet_entries x SET
    schedule_conflict_reason=CASE WHEN x.schedule_conflict_reason IN ('acknowledged','excluded') THEN x.schedule_conflict_reason WHEN d.classification='proven' THEN 'duplicate_of_finalized' WHEN d.classification='suspected' THEN 'suspected_duplicate' ELSE NULL END,
    schedule_conflict_at=CASE WHEN x.schedule_conflict_reason IN ('acknowledged','excluded') THEN NULL WHEN d.classification IS NOT NULL THEN coalesce(x.schedule_conflict_at,clock_timestamp()) ELSE NULL END
  FROM (SELECT y.id,public.timesheet_entry_duplicate_classification(y.id,tz) AS classification FROM public.timesheet_entries y WHERE y.timesheet_id=t.id AND NOT y.is_manual AND y.event_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(_shifts) cur_item WHERE cur_item->>'occurrence_key'=y.occurrence_key)) d WHERE x.id=d.id;
  IF t.status='draft' AND EXISTS (SELECT 1 FROM public.timesheet_entries WHERE timesheet_id=t.id AND schedule_conflict_at IS NOT NULL) THEN UPDATE public.timesheets SET status='needs_correction' WHERE id=t.id RETURNING * INTO t; END IF;
  RETURN to_jsonb(t);
END $$;
REVOKE ALL ON FUNCTION public.refresh_timesheet_atomic(uuid,uuid,jsonb,text,date,date,date,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_timesheet_atomic(uuid,uuid,jsonb,text,date,date,date,jsonb) TO service_role;