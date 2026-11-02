ALTER TABLE public.timesheet_entries ADD COLUMN IF NOT EXISTS schedule_conflict_at timestamptz;
ALTER TABLE public.timesheet_entries ADD COLUMN IF NOT EXISTS schedule_conflict_reason text;

CREATE TABLE IF NOT EXISTS public.timesheet_reconcile_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_ids uuid[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.timesheet_reconcile_jobs TO service_role;
ALTER TABLE public.timesheet_reconcile_jobs ENABLE ROW LEVEL SECURITY;

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
  -- Protected entries whose shift moved away are kept but flagged; they never count twice.
  UPDATE public.timesheet_entries x SET schedule_conflict_at=coalesce(x.schedule_conflict_at, clock_timestamp()), schedule_conflict_reason='moved'
   WHERE x.timesheet_id=t.id AND NOT x.is_manual AND x.occurrence_key IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_shifts) moved_item WHERE moved_item->>'occurrence_key'=x.occurrence_key);
  -- A one-off shift already recorded on a finalized sheet for another date is the same logical shift.
  UPDATE public.timesheet_entries x SET
    schedule_conflict_reason = CASE WHEN x.schedule_conflict_reason IN ('acknowledged','excluded') THEN x.schedule_conflict_reason WHEN d.dup THEN 'duplicate_of_finalized' ELSE NULL END,
    schedule_conflict_at = CASE WHEN x.schedule_conflict_reason IN ('acknowledged','excluded') THEN NULL WHEN d.dup THEN coalesce(x.schedule_conflict_at, clock_timestamp()) ELSE NULL END
  FROM (
    SELECT y.id, EXISTS (
      SELECT 1 FROM public.events ev
      JOIN public.timesheet_entries f ON f.event_id=ev.id
      JOIN public.timesheets ft ON ft.id=f.timesheet_id
      WHERE ev.id=y.event_id AND ev.recurrence_rule IS NULL AND ft.family_id=_family AND ft.family_member_id=_member
        AND ft.id<>t.id AND ft.status NOT IN ('draft','needs_correction') AND f.occurrence_key IS DISTINCT FROM y.occurrence_key
    ) AS dup
    FROM public.timesheet_entries y
    WHERE y.timesheet_id=t.id AND NOT y.is_manual
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

CREATE OR REPLACE FUNCTION public.transition_timesheet_atomic(_family uuid, _sheet uuid, _actor uuid, _action text, _member uuid DEFAULT NULL, _note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.timesheets; tz text; entries jsonb; snap jsonb;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  SELECT * INTO t FROM public.timesheets WHERE id=_sheet AND family_id=_family FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  IF _action='submit' THEN
    IF t.family_member_id IS DISTINCT FROM _member OR NOT EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND family_member_id=_member) THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
    IF t.status NOT IN ('draft','needs_correction') THEN RAISE EXCEPTION 'This timesheet has already been submitted'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND role='owner') THEN RAISE EXCEPTION 'Only household owners can do that'; END IF;
    IF _action IN ('approve','request_correction') AND t.status<>'submitted' THEN RAISE EXCEPTION 'Only submitted timesheets can be reviewed'; END IF;
    IF _action='finalize_managed' AND (t.status NOT IN ('draft','needs_correction') OR EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND family_member_id=t.family_member_id)) THEN RAISE EXCEPTION 'This owner-managed timesheet cannot be finalized'; END IF;
    IF _action='close' AND t.status NOT IN ('draft','needs_correction','submitted') THEN RAISE EXCEPTION 'This timesheet is already finalized'; END IF;
  END IF;
  IF _action IN ('submit','finalize_managed') AND EXISTS (SELECT 1 FROM public.timesheet_entries WHERE timesheet_id=t.id AND schedule_conflict_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A shift on this timesheet was moved. Resolve the flagged shift before submitting.';
  END IF;
  SELECT coalesce(nullif(timezone,''),'America/Los_Angeles') INTO tz FROM public.families WHERE id=_family;
  IF _action='close' AND t.status='draft' AND t.period_end >= (clock_timestamp() AT TIME ZONE tz)::date THEN RAISE EXCEPTION 'This pay period hasn''t ended yet, so its timesheet can''t be closed'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
    'actual_start_local',to_char(e.actual_start AT TIME ZONE tz,'HH24:MI'), 'actual_end_local',to_char(e.actual_end AT TIME ZONE tz,'HH24:MI'),
    'submitted_scheduled_start',e.scheduled_start, 'submitted_scheduled_end',e.scheduled_end,
    'caregiver_adjusted',NOT e.is_manual AND e.actual_time_confirmed AND e.scheduled_start IS NOT NULL AND e.scheduled_end IS NOT NULL AND
      (date_trunc('minute',e.actual_start)<>date_trunc('minute',e.scheduled_start) OR date_trunc('minute',e.actual_end)<>date_trunc('minute',e.scheduled_end))
  ) ORDER BY e.actual_start,e.id),'[]'::jsonb) INTO entries FROM public.timesheet_entries e WHERE timesheet_id=t.id;
  snap:=jsonb_build_object('time_zone',tz,'caregiver_name',t.caregiver_name,'entries',entries);
  CASE _action
    WHEN 'submit' THEN UPDATE public.timesheets SET status='submitted',submitted_at=clock_timestamp(),snapshot=snap WHERE id=t.id;
    WHEN 'approve' THEN UPDATE public.timesheets SET status='approved',parent_note=NULL,reviewed_at=clock_timestamp(),reviewed_by=_actor WHERE id=t.id;
    WHEN 'request_correction' THEN UPDATE public.timesheets SET status='needs_correction',parent_note=nullif(trim(_note),''),reviewed_at=clock_timestamp(),reviewed_by=_actor WHERE id=t.id;
    WHEN 'close' THEN UPDATE public.timesheets SET status='closed',snapshot=coalesce(t.snapshot,snap),closed_at=clock_timestamp(),closed_by=_actor WHERE id=t.id;
    WHEN 'finalize_managed' THEN UPDATE public.timesheets SET status='approved',owner_managed=true,reviewed_at=clock_timestamp(),reviewed_by=_actor,snapshot=snap || '{"owner_managed":true}'::jsonb WHERE id=t.id;
    ELSE RAISE EXCEPTION 'Unsupported timesheet action';
  END CASE;
END $$;
REVOKE ALL ON FUNCTION public.transition_timesheet_atomic(uuid,uuid,uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_timesheet_atomic(uuid,uuid,uuid,text,uuid,text) TO service_role;

CREATE FUNCTION public.reconcile_shift_timesheets_atomic(_family uuid, _settings jsonb, _timezone text, _today date, _items jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it jsonb; n integer := 0;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.timesheets WHERE family_id=_family AND family_member_id=(it->>'member')::uuid
                   AND period_start=(it->>'start')::date AND status IN ('draft','needs_correction')) THEN CONTINUE; END IF;
    PERFORM public.refresh_timesheet_atomic(_family,(it->>'member')::uuid,_settings,_timezone,_today,(it->>'start')::date,(it->>'end')::date,coalesce(it->'shifts','[]'::jsonb));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_shift_timesheets_atomic(uuid,jsonb,text,date,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_shift_timesheets_atomic(uuid,jsonb,text,date,jsonb) TO service_role;

CREATE FUNCTION public.resolve_timesheet_conflict_atomic(_family uuid, _sheet uuid, _entry uuid, _actor uuid, _member uuid, _action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.timesheets; e public.timesheet_entries;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  SELECT * INTO t FROM public.timesheets WHERE id=_sheet AND family_id=_family FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  IF _member IS NOT NULL THEN
    IF t.family_member_id<>_member OR NOT EXISTS (SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND family_member_id=_member) THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND role='owner')
       OR EXISTS (SELECT 1 FROM public.family_users WHERE family_id=_family AND family_member_id=t.family_member_id)
       OR NOT EXISTS (SELECT 1 FROM public.family_members WHERE id=t.family_member_id AND family_id=_family AND timesheets_enabled) THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  END IF;
  IF t.status NOT IN ('draft','needs_correction') THEN RAISE EXCEPTION 'This timesheet can''t be edited'; END IF;
  SELECT * INTO e FROM public.timesheet_entries WHERE id=_entry AND timesheet_id=t.id FOR UPDATE;
  IF e.id IS NULL OR e.schedule_conflict_at IS NULL THEN RAISE EXCEPTION 'Nothing to resolve on this shift'; END IF;
  IF e.schedule_conflict_reason='moved' THEN
    IF _action='keep' THEN
      UPDATE public.timesheet_entries SET is_manual=true, occurrence_key=NULL, schedule_conflict_at=NULL, schedule_conflict_reason=NULL WHERE id=e.id;
    ELSIF _action='discard' THEN
      DELETE FROM public.timesheet_entries WHERE id=e.id;
    ELSE RAISE EXCEPTION 'Unsupported resolution'; END IF;
  ELSE
    IF _action='keep' THEN
      UPDATE public.timesheet_entries SET schedule_conflict_at=NULL, schedule_conflict_reason='acknowledged' WHERE id=e.id;
    ELSIF _action='discard' THEN
      UPDATE public.timesheet_entries SET schedule_conflict_at=NULL, schedule_conflict_reason='excluded' WHERE id=e.id;
    ELSE RAISE EXCEPTION 'Unsupported resolution'; END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.resolve_timesheet_conflict_atomic(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_timesheet_conflict_atomic(uuid,uuid,uuid,uuid,uuid,text) TO service_role;