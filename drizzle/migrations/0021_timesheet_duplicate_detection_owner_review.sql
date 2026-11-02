-- One place decides whether an editable entry is the same logical shift as one already finalized.
CREATE OR REPLACE FUNCTION public.timesheet_entry_duplicates_finalized(_entry uuid, _tz text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE y public.timesheet_entries; t public.timesheets; ev public.events; keys text[];
BEGIN
  SELECT * INTO y FROM public.timesheet_entries WHERE id=_entry;
  IF y.id IS NULL OR y.is_manual OR y.event_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO t FROM public.timesheets WHERE id=y.timesheet_id;
  SELECT * INTO ev FROM public.events WHERE id=y.event_id;
  keys := public.timesheet_lineage_keys(y.event_id, y.work_date, _tz);
  RETURN EXISTS (
    SELECT 1 FROM public.timesheet_entries f
    JOIN public.timesheets ft ON ft.id=f.timesheet_id
    LEFT JOIN public.events fe ON fe.id=f.event_id
    WHERE ft.family_id=t.family_id AND ft.family_member_id=t.family_member_id AND ft.id<>t.id
      AND ft.status NOT IN ('draft','needs_correction')
      AND f.occurrence_key IS DISTINCT FROM y.occurrence_key
      AND (
        -- same-id one-off moved to another date
        (f.event_id=y.event_id AND ev.recurrence_rule IS NULL)
        -- split replacement with recorded lineage
        OR f.occurrence_key = ANY(keys)
        -- a caregiver can't work two overlapping shifts: overlap means the same time is already paid
        OR tstzrange(coalesce(f.scheduled_start,f.actual_start), coalesce(f.scheduled_end,f.actual_end))
           && tstzrange(y.scheduled_start, y.scheduled_end)
        -- legacy replacement without lineage: the finalized occurrence was later detached from
        -- its series and this unlinked event appeared afterwards, near the same date
        OR (ev.split_from_event_id IS NULL
            AND f.event_id IS DISTINCT FROM y.event_id
            AND abs(f.work_date - y.work_date) <= 7
            AND ev.created_at > coalesce(ft.submitted_at, ft.reviewed_at, ft.closed_at, ft.updated_at)
            AND (fe.id IS NULL
                 OR f.work_date::text = ANY(fe.excluded_dates::text[])
                 OR (fe.recurrence_rule IS NOT NULL AND fe.recurrence_until IS NOT NULL AND fe.recurrence_until < f.work_date)))
      )
  );
END $$;
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
  IF cfg IS DISTINCT FROM _settings OR tz IS DISTINCT FROM _timezone OR (clock_timestamp() AT TIME ZONE tz)::date <> _today THEN
    RAISE EXCEPTION 'Timesheet schedule changed. Refresh and try again.';
  END IF;
  SELECT * INTO m FROM public.family_members WHERE id = _member AND family_id = _family;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Caregiver not found'; END IF;
  SELECT * INTO t FROM public.timesheets WHERE family_id = _family AND family_member_id = _member AND period_start = _start FOR UPDATE;
  IF t.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.timesheets WHERE family_id = _family AND family_member_id = _member AND period_start <= _end AND period_end >= _start) THEN
      RAISE EXCEPTION 'This period overlaps existing timesheet history. No time card was created.';
    END IF;
    INSERT INTO public.timesheets(family_id,family_member_id,caregiver_name,period_start,period_end)
    VALUES (_family,_member,m.name,_start,_end) RETURNING * INTO t;
  END IF;
  IF t.status NOT IN ('draft','needs_correction') THEN RETURN to_jsonb(t); END IF;
  FOR sh IN SELECT * FROM jsonb_array_elements(_shifts) LOOP
    IF (sh->>'work_date')::date < t.period_start OR (sh->>'work_date')::date > t.period_end OR
        (m.timesheet_start_date IS NOT NULL AND (sh->>'work_date')::date < m.timesheet_start_date) THEN CONTINUE; END IF;
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
    schedule_conflict_reason = CASE WHEN x.schedule_conflict_reason IN ('acknowledged','excluded') THEN x.schedule_conflict_reason WHEN d.dup THEN 'duplicate_of_finalized' ELSE NULL END,
    schedule_conflict_at = CASE WHEN x.schedule_conflict_reason IN ('acknowledged','excluded') THEN NULL WHEN d.dup THEN coalesce(x.schedule_conflict_at, clock_timestamp()) ELSE NULL END
  FROM (
    SELECT y.id, public.timesheet_entry_duplicates_finalized(y.id, tz) AS dup
    FROM public.timesheet_entries y
    WHERE y.timesheet_id=t.id AND NOT y.is_manual AND y.event_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(_shifts) cur_item WHERE cur_item->>'occurrence_key'=y.occurrence_key)
  ) d
  WHERE x.id=d.id;
  IF t.status='draft' AND EXISTS (SELECT 1 FROM public.timesheet_entries WHERE timesheet_id=t.id AND schedule_conflict_at IS NOT NULL) THEN
    UPDATE public.timesheets SET status='needs_correction' WHERE id=t.id RETURNING * INTO t;
  END IF;
  RETURN to_jsonb(t);
END $$;
REVOKE ALL ON FUNCTION public.refresh_timesheet_atomic(uuid,uuid,jsonb,text,date,date,date,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_timesheet_atomic(uuid,uuid,jsonb,text,date,date,date,jsonb) TO service_role;

-- Duplicate flags need an Owner's explicit decision; caregivers resolve only their own moved shifts.
CREATE OR REPLACE FUNCTION public.resolve_timesheet_conflict_atomic(_family uuid, _sheet uuid, _entry uuid, _actor uuid, _member uuid, _action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.timesheets; e public.timesheet_entries; is_owner boolean;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  SELECT * INTO t FROM public.timesheets WHERE id=_sheet AND family_id=_family FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  is_owner := EXISTS (SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND role='owner');
  IF t.status NOT IN ('draft','needs_correction') THEN RAISE EXCEPTION 'This timesheet can''t be edited'; END IF;
  SELECT * INTO e FROM public.timesheet_entries WHERE id=_entry AND timesheet_id=t.id FOR UPDATE;
  IF e.id IS NULL OR e.schedule_conflict_at IS NULL THEN RAISE EXCEPTION 'Nothing to resolve on this shift'; END IF;
  IF e.schedule_conflict_reason='moved' THEN
    IF _member IS NOT NULL THEN
      IF t.family_member_id<>_member OR NOT EXISTS (SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND family_member_id=_member) THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
    ELSIF NOT is_owner
       OR EXISTS (SELECT 1 FROM public.family_users WHERE family_id=_family AND family_member_id=t.family_member_id)
       OR NOT EXISTS (SELECT 1 FROM public.family_members WHERE id=t.family_member_id AND family_id=_family AND timesheets_enabled) THEN
      RAISE EXCEPTION 'Timesheet not found';
    END IF;
    IF _action='keep' THEN
      UPDATE public.timesheet_entries SET is_manual=true, occurrence_key=NULL, schedule_conflict_at=NULL, schedule_conflict_reason=NULL WHERE id=e.id;
    ELSIF _action='discard' THEN
      DELETE FROM public.timesheet_entries WHERE id=e.id;
    ELSE RAISE EXCEPTION 'Unsupported resolution'; END IF;
  ELSE
    IF NOT is_owner THEN RAISE EXCEPTION 'A household owner needs to review this shift'; END IF;
    IF _action='keep' THEN
      UPDATE public.timesheet_entries SET schedule_conflict_at=NULL, schedule_conflict_reason='acknowledged', owner_edited_at=clock_timestamp(), owner_edited_by=_actor WHERE id=e.id;
    ELSIF _action='discard' THEN
      UPDATE public.timesheet_entries SET schedule_conflict_at=NULL, schedule_conflict_reason='excluded', owner_edited_at=clock_timestamp(), owner_edited_by=_actor WHERE id=e.id;
    ELSE RAISE EXCEPTION 'Unsupported resolution'; END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.resolve_timesheet_conflict_atomic(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_timesheet_conflict_atomic(uuid,uuid,uuid,uuid,uuid,text) TO service_role;