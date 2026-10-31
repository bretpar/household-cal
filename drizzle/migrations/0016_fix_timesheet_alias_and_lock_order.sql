-- Fix 42702: the DELETE alias `e` collided with the PL/pgSQL row variable `e`.
-- Identical behavior; only the alias is renamed.
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
  DELETE FROM public.timesheet_entries del WHERE del.timesheet_id=t.id AND NOT del.is_manual AND del.occurrence_key IS NOT NULL
    AND NOT del.actual_time_confirmed AND del.note IS NULL AND coalesce(del.paid_hours,0)=0 AND del.paid_note IS NULL AND del.owner_edited_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_shifts) sh WHERE sh->>'occurrence_key'=del.occurrence_key);
  RETURN to_jsonb(t);
END $$;

-- Fix 40P01: establish one locking order for every timesheet write path:
-- household advisory lock -> timesheet parent row -> entry row.
-- Ordinary entry saves/deletes previously locked the entry first and the parent
-- second (inside this trigger), the reverse of refresh/transition/correction.
-- Acquiring the household advisory lock before the parent row lock makes all
-- paths agree. The advisory lock is transaction-scoped and re-entrant, so RPCs
-- that already hold it are unaffected. Status/editability is still rechecked
-- under the lock, and the audited owner-only correction path is preserved.
CREATE OR REPLACE FUNCTION public.guard_timesheet_entry_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.timesheets; sid uuid; fam uuid;
BEGIN
  sid:=CASE WHEN TG_OP='DELETE' THEN OLD.timesheet_id ELSE NEW.timesheet_id END;
  fam:=CASE WHEN TG_OP='DELETE' THEN OLD.family_id ELSE NEW.family_id END;
  PERFORM public.lock_timesheet_household(fam);
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