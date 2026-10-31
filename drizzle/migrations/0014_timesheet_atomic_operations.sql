-- Service-only RPCs share a household transaction lock. No existing rows are rewritten.
CREATE FUNCTION public.lock_timesheet_household(_family uuid) RETURNS void LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('timesheets:' || _family::text, 0));
$$;
REVOKE ALL ON FUNCTION public.lock_timesheet_household(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_timesheet_household(uuid) TO service_role;

CREATE FUNCTION public.save_timesheet_schedule_atomic(_family uuid, _settings jsonb, _validated_periods jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  -- The proposed boundaries are calculated with the existing shared application utility.
  -- Revalidate every current database period under the lock; a concurrently inserted
  -- period absent from the validation set fails closed, rather than being orphaned.
  IF EXISTS (
    SELECT 1 FROM public.timesheets t WHERE t.family_id = _family AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(_validated_periods) p
      WHERE (p->>'id')::uuid = t.id AND (p->>'start')::date = t.period_start
        AND (p->>'end')::date = t.period_end
        AND (p->>'proposed_start')::date = t.period_start AND (p->>'proposed_end')::date = t.period_end
    )
  ) THEN RAISE EXCEPTION 'This schedule conflicts with existing timesheet boundaries or history changed. Refresh and try again; history was not changed.'; END IF;
  INSERT INTO public.timesheet_settings(family_id, frequency, anchor_date, semimonthly_first_end)
  VALUES (_family, _settings->>'frequency', (_settings->>'anchor_date')::date, (_settings->>'semimonthly_first_end')::smallint)
  ON CONFLICT (family_id) DO UPDATE SET frequency = EXCLUDED.frequency, anchor_date = EXCLUDED.anchor_date, semimonthly_first_end = EXCLUDED.semimonthly_first_end;
END $$;
REVOKE ALL ON FUNCTION public.save_timesheet_schedule_atomic(uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_timesheet_schedule_atomic(uuid,jsonb,jsonb) TO service_role;

CREATE FUNCTION public.refresh_timesheet_atomic(_family uuid, _member uuid, _settings jsonb, _timezone text, _today date, _start date, _end date, _shifts jsonb) RETURNS jsonb
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
  -- Recheck status while holding the same lock used by every finalization RPC.
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
  -- Never discard entered actuals, notes or payment information when a shift disappears.
  DELETE FROM public.timesheet_entries e WHERE e.timesheet_id=t.id AND NOT e.is_manual AND e.occurrence_key IS NOT NULL
    AND NOT e.actual_time_confirmed AND e.note IS NULL AND coalesce(e.paid_hours,0)=0 AND e.paid_note IS NULL AND e.owner_edited_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_shifts) sh WHERE sh->>'occurrence_key'=e.occurrence_key);
  RETURN to_jsonb(t);
END $$;
REVOKE ALL ON FUNCTION public.refresh_timesheet_atomic(uuid,uuid,jsonb,text,date,date,date,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_timesheet_atomic(uuid,uuid,jsonb,text,date,date,date,jsonb) TO service_role;

CREATE FUNCTION public.transition_timesheet_atomic(_family uuid, _sheet uuid, _actor uuid, _action text, _member uuid DEFAULT NULL, _note text DEFAULT NULL) RETURNS void
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
  SELECT coalesce(nullif(timezone,''),'America/Los_Angeles') INTO tz FROM public.families WHERE id=_family;
  IF _action='close' AND t.status='draft' AND t.period_end >= (clock_timestamp() AT TIME ZONE tz)::date THEN RAISE EXCEPTION 'This pay period hasn''t ended yet, so its timesheet can''t be closed'; END IF;
  -- Build the snapshot from the locked, current entries, never a pre-lock server read.
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

-- Defense in depth for legacy/direct writes: lock the parent and re-read status.
-- Explicit audited owner corrections remain allowed; no refresh can impersonate them.
CREATE FUNCTION public.guard_timesheet_entry_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.timesheets; sid uuid;
BEGIN
  sid:=CASE WHEN TG_OP='DELETE' THEN OLD.timesheet_id ELSE NEW.timesheet_id END;
  SELECT * INTO t FROM public.timesheets WHERE id=sid FOR UPDATE;
  IF t.id IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Timesheet not found';
  END IF;
  IF TG_OP<>'DELETE' AND NEW.family_id<>t.family_id THEN RAISE EXCEPTION 'Entry must belong to the timesheet household'; END IF;
  IF t.status NOT IN ('draft','needs_correction') THEN
    IF TG_OP='UPDATE' AND t.status IN ('submitted','approved') AND NEW.owner_edited_at IS DISTINCT FROM OLD.owner_edited_at
       AND NEW.owner_edited_by IS NOT NULL AND EXISTS(SELECT 1 FROM public.family_users WHERE family_id=t.family_id AND user_id=NEW.owner_edited_by AND role='owner')
       AND NEW.timesheet_id=OLD.timesheet_id AND NEW.event_id IS NOT DISTINCT FROM OLD.event_id
       AND NEW.occurrence_key IS NOT DISTINCT FROM OLD.occurrence_key AND NEW.work_date=OLD.work_date
       AND NEW.scheduled_title IS NOT DISTINCT FROM OLD.scheduled_title AND NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start AND NEW.scheduled_end IS NOT DISTINCT FROM OLD.scheduled_end THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Finalized timesheet entries cannot be refreshed or deleted';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_timesheet_entry_write() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER timesheet_entries_guard_write BEFORE INSERT OR UPDATE OR DELETE ON public.timesheet_entries FOR EACH ROW EXECUTE FUNCTION public.guard_timesheet_entry_write();