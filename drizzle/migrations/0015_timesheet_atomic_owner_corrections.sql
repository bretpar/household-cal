CREATE FUNCTION public.correct_timesheet_entry_atomic(_family uuid, _sheet uuid, _entry uuid, _actor uuid, _patch jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.timesheets; e public.timesheet_entries; tz text; entries jsonb; previous jsonb;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  SELECT * INTO t FROM public.timesheets WHERE id=_sheet AND family_id=_family FOR UPDATE;
  IF t.id IS NULL OR t.status NOT IN ('submitted','approved') THEN RAISE EXCEPTION 'Only submitted or approved timesheets can be edited'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND role='owner') THEN RAISE EXCEPTION 'Only household owners can do that'; END IF;
  SELECT * INTO e FROM public.timesheet_entries WHERE id=_entry AND timesheet_id=_sheet FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF (_patch->>'actual_end')::timestamptz <= (_patch->>'actual_start')::timestamptz OR
     coalesce((_patch->>'paid_hours')::numeric,0)<0 OR
     coalesce((_patch->>'paid_hours')::numeric,0)>extract(epoch FROM ((_patch->>'actual_end')::timestamptz-(_patch->>'actual_start')::timestamptz))/3600 THEN
    RAISE EXCEPTION 'Paid hours must be between zero and actual worked hours';
  END IF;
  UPDATE public.timesheet_entries SET actual_start=(_patch->>'actual_start')::timestamptz,actual_end=(_patch->>'actual_end')::timestamptz,
    note=_patch->>'note',paid_hours=CASE WHEN _patch ? 'paid_hours' THEN (_patch->>'paid_hours')::numeric ELSE paid_hours END,
    paid_note=CASE WHEN _patch ? 'paid_note' THEN _patch->>'paid_note' ELSE paid_note END,
    caregiver_actual_start=CASE WHEN e.owner_edited_at IS NULL THEN e.actual_start ELSE caregiver_actual_start END,
    caregiver_actual_end=CASE WHEN e.owner_edited_at IS NULL THEN e.actual_end ELSE caregiver_actual_end END,
    caregiver_note=CASE WHEN e.owner_edited_at IS NULL THEN e.note ELSE caregiver_note END,
    owner_edited_at=clock_timestamp(),owner_edited_by=_actor,actual_time_confirmed=true WHERE id=e.id;
  SELECT coalesce(t.snapshot->>'time_zone',nullif(timezone,''),'America/Los_Angeles') INTO tz FROM public.families WHERE id=_family;
  SELECT coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object(
    'actual_start_local',to_char(x.actual_start AT TIME ZONE tz,'HH24:MI'),'actual_end_local',to_char(x.actual_end AT TIME ZONE tz,'HH24:MI')) ||
    CASE WHEN p.value IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'scheduled_start',p.value->'scheduled_start','scheduled_end',p.value->'scheduled_end',
      'submitted_scheduled_start',p.value->'submitted_scheduled_start','submitted_scheduled_end',p.value->'submitted_scheduled_end',
      'caregiver_adjusted',p.value->'caregiver_adjusted') END ORDER BY x.actual_start,x.id),'[]'::jsonb)
    INTO entries FROM public.timesheet_entries x LEFT JOIN LATERAL
      (SELECT value FROM jsonb_array_elements(coalesce(t.snapshot->'entries','[]'::jsonb)) WHERE value->>'id'=x.id::text LIMIT 1) p ON true
    WHERE x.timesheet_id=t.id;
  UPDATE public.timesheets SET snapshot=coalesce(t.snapshot,'{}'::jsonb) || jsonb_build_object('time_zone',tz,'entries',entries),
    submitted_snapshot=coalesce(t.submitted_snapshot,t.snapshot),owner_edited_at=clock_timestamp(),owner_edited_by=_actor WHERE id=t.id;
END $$;
REVOKE ALL ON FUNCTION public.correct_timesheet_entry_atomic(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_timesheet_entry_atomic(uuid,uuid,uuid,uuid,jsonb) TO service_role;