-- Fix 1: refresh_timesheet_atomic DELETE aliased jsonb_array_elements as sh and the
-- table as e, colliding with the PL/pgSQL variables sh and e (42702). Rename both.
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
  DELETE FROM public.timesheet_entries entry_row WHERE entry_row.timesheet_id=t.id AND NOT entry_row.is_manual AND entry_row.occurrence_key IS NOT NULL
    AND NOT entry_row.actual_time_confirmed AND entry_row.note IS NULL AND coalesce(entry_row.paid_hours,0)=0 AND entry_row.paid_note IS NULL AND entry_row.owner_edited_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_shifts) shift_item WHERE shift_item->>'occurrence_key'=entry_row.occurrence_key);
  RETURN to_jsonb(t);
END $$;
REVOKE ALL ON FUNCTION public.refresh_timesheet_atomic(uuid,uuid,jsonb,text,date,date,date,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_timesheet_atomic(uuid,uuid,jsonb,text,date,date,date,jsonb) TO service_role;

-- Fix 2: ordinary entry saves/deletes previously ran as bare DML, taking entry tuple
-- locks before the guard trigger could establish household -> timesheet -> entry order.
-- These RPCs acquire the household advisory lock and parent row lock BEFORE any entry
-- write, and recheck permissions/status inside the protected transaction.

-- Caregiver save (update actual hours / add manual entry) on own editable timesheet.
CREATE FUNCTION public.save_timesheet_entry_atomic(_family uuid, _sheet uuid, _entry uuid, _actor uuid, _member uuid, _work_date date, _start timestamptz, _end timestamptz, _note text, _paid_hours numeric, _paid_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.timesheets; m public.family_members; worked numeric;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  SELECT * INTO t FROM public.timesheets WHERE id=_sheet AND family_id=_family FOR UPDATE;
  IF t.id IS NULL OR t.family_member_id IS DISTINCT FROM _member THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND family_member_id=_member) THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  SELECT * INTO m FROM public.family_members WHERE id=_member AND family_id=_family;
  IF m.id IS NULL OR NOT m.timesheets_enabled THEN RAISE EXCEPTION 'Timesheets are turned off for you in this household'; END IF;
  IF t.status NOT IN ('draft','needs_correction') THEN
    RAISE EXCEPTION '%', CASE WHEN t.status='closed' THEN 'This timesheet was closed' ELSE 'This timesheet has been submitted and can''t be edited' END;
  END IF;
  IF m.timesheet_start_date IS NOT NULL AND t.period_end < m.timesheet_start_date THEN RAISE EXCEPTION 'This pay period is before your Timesheet start date'; END IF;
  IF _work_date < t.period_start OR _work_date > t.period_end THEN RAISE EXCEPTION 'Pick a date inside this pay period'; END IF;
  worked := extract(epoch from (_end - _start))/3600.0;
  IF _paid_hours IS NOT NULL AND (_paid_hours < 0 OR _paid_hours > worked + 0.005) THEN RAISE EXCEPTION 'Paid hours can''t exceed hours worked'; END IF;
  IF _entry IS NOT NULL THEN
    UPDATE public.timesheet_entries SET actual_start=_start, actual_end=_end, note=_note, paid_hours=_paid_hours, paid_note=_paid_note, actual_time_confirmed=true
    WHERE id=_entry AND timesheet_id=t.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  ELSE
    INSERT INTO public.timesheet_entries(timesheet_id,family_id,work_date,actual_start,actual_end,is_manual,note,paid_hours,paid_note)
    VALUES(t.id,_family,_work_date,_start,_end,true,_note,_paid_hours,_paid_note);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_timesheet_entry_atomic(uuid,uuid,uuid,uuid,uuid,date,timestamptz,timestamptz,text,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_timesheet_entry_atomic(uuid,uuid,uuid,uuid,uuid,date,timestamptz,timestamptz,text,numeric,text) TO service_role;

-- Caregiver delete of a manual entry on own editable timesheet.
CREATE FUNCTION public.delete_timesheet_entry_atomic(_family uuid, _sheet uuid, _entry uuid, _actor uuid, _member uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.timesheets; m public.family_members;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  SELECT * INTO t FROM public.timesheets WHERE id=_sheet AND family_id=_family FOR UPDATE;
  IF t.id IS NULL OR t.family_member_id IS DISTINCT FROM _member THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND family_member_id=_member) THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  SELECT * INTO m FROM public.family_members WHERE id=_member AND family_id=_family;
  IF m.id IS NULL OR NOT m.timesheets_enabled THEN RAISE EXCEPTION 'Timesheets are turned off for you in this household'; END IF;
  IF t.status NOT IN ('draft','needs_correction') THEN
    RAISE EXCEPTION '%', CASE WHEN t.status='closed' THEN 'This timesheet was closed' ELSE 'This timesheet has been submitted and can''t be edited' END;
  END IF;
  DELETE FROM public.timesheet_entries WHERE id=_entry AND timesheet_id=t.id AND is_manual;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.delete_timesheet_entry_atomic(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_timesheet_entry_atomic(uuid,uuid,uuid,uuid,uuid) TO service_role;

-- Owner save on an owner-managed time card (caregiver without a household sign-in).
CREATE FUNCTION public.owner_save_managed_entry_atomic(_family uuid, _sheet uuid, _entry uuid, _actor uuid, _work_date date, _start timestamptz, _end timestamptz, _note text, _paid_hours numeric, _paid_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.timesheets; m public.family_members; worked numeric;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  IF NOT EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND role='owner') THEN RAISE EXCEPTION 'Only household owners can do that'; END IF;
  SELECT * INTO t FROM public.timesheets WHERE id=_sheet AND family_id=_family FOR UPDATE;
  IF t.id IS NULL OR NOT t.owner_managed THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  SELECT * INTO m FROM public.family_members WHERE id=t.family_member_id AND family_id=_family;
  IF m.id IS NULL OR m.role<>'caregiver' OR NOT m.timesheets_enabled THEN RAISE EXCEPTION 'Caregiver not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND family_member_id=t.family_member_id) THEN RAISE EXCEPTION 'This caregiver signs in and submits her own timesheet'; END IF;
  IF t.status NOT IN ('draft','needs_correction') THEN RAISE EXCEPTION 'This timesheet can''t be edited'; END IF;
  IF _work_date < t.period_start OR _work_date > t.period_end THEN RAISE EXCEPTION 'Pick a date inside this pay period'; END IF;
  worked := extract(epoch from (_end - _start))/3600.0;
  IF _paid_hours IS NOT NULL AND (_paid_hours < 0 OR _paid_hours > worked + 0.005) THEN RAISE EXCEPTION 'Paid hours can''t exceed hours worked'; END IF;
  IF _entry IS NOT NULL THEN
    UPDATE public.timesheet_entries SET actual_start=_start, actual_end=_end, note=_note, paid_hours=_paid_hours, paid_note=_paid_note, actual_time_confirmed=true, owner_edited_at=now(), owner_edited_by=_actor
    WHERE id=_entry AND timesheet_id=t.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  ELSE
    INSERT INTO public.timesheet_entries(timesheet_id,family_id,work_date,actual_start,actual_end,is_manual,note,paid_hours,paid_note,owner_edited_at,owner_edited_by)
    VALUES(t.id,_family,_work_date,_start,_end,true,_note,_paid_hours,_paid_note,now(),_actor);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.owner_save_managed_entry_atomic(uuid,uuid,uuid,uuid,date,timestamptz,timestamptz,text,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_save_managed_entry_atomic(uuid,uuid,uuid,uuid,date,timestamptz,timestamptz,text,numeric,text) TO service_role;

-- Owner delete of a manual entry on an owner-managed time card.
CREATE FUNCTION public.owner_delete_managed_entry_atomic(_family uuid, _sheet uuid, _entry uuid, _actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.timesheets;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  IF NOT EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND role='owner') THEN RAISE EXCEPTION 'Only household owners can do that'; END IF;
  SELECT * INTO t FROM public.timesheets WHERE id=_sheet AND family_id=_family FOR UPDATE;
  IF t.id IS NULL OR NOT t.owner_managed THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  IF t.status NOT IN ('draft','needs_correction') THEN RAISE EXCEPTION 'This timesheet can''t be edited'; END IF;
  DELETE FROM public.timesheet_entries WHERE id=_entry AND timesheet_id=t.id AND is_manual;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.owner_delete_managed_entry_atomic(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_delete_managed_entry_atomic(uuid,uuid,uuid,uuid) TO service_role;