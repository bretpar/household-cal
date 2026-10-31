-- Fix: owner_save_managed_entry_atomic / owner_delete_managed_entry_atomic required
-- timesheets.owner_managed = true, but that flag is only set during finalization, so
-- legitimate owner-managed Drafts were rejected with 'Timesheet not found' (P0001).
-- Replace the flag check with the existing owner-managed rule used by the app:
-- the sheet's caregiver is an active Timesheet-enabled caregiver with NO household
-- sign-in (no family_users row). Status, lock order and household isolation unchanged.

CREATE OR REPLACE FUNCTION public.owner_save_managed_entry_atomic(_family uuid, _sheet uuid, _entry uuid, _actor uuid, _work_date date, _start timestamptz, _end timestamptz, _note text, _paid_hours numeric, _paid_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.timesheets; m public.family_members; worked numeric;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  IF NOT EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND role='owner') THEN RAISE EXCEPTION 'Only household owners can do that'; END IF;
  SELECT * INTO t FROM public.timesheets WHERE id=_sheet AND family_id=_family FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
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

CREATE OR REPLACE FUNCTION public.owner_delete_managed_entry_atomic(_family uuid, _sheet uuid, _entry uuid, _actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.timesheets; m public.family_members;
BEGIN
  PERFORM public.lock_timesheet_household(_family);
  IF NOT EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND user_id=_actor AND role='owner') THEN RAISE EXCEPTION 'Only household owners can do that'; END IF;
  SELECT * INTO t FROM public.timesheets WHERE id=_sheet AND family_id=_family FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Timesheet not found'; END IF;
  SELECT * INTO m FROM public.family_members WHERE id=t.family_member_id AND family_id=_family;
  IF m.id IS NULL OR m.role<>'caregiver' OR NOT m.timesheets_enabled THEN RAISE EXCEPTION 'Caregiver not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.family_users WHERE family_id=_family AND family_member_id=t.family_member_id) THEN RAISE EXCEPTION 'This caregiver signs in and submits her own timesheet'; END IF;
  IF t.status NOT IN ('draft','needs_correction') THEN RAISE EXCEPTION 'This timesheet can''t be edited'; END IF;
  DELETE FROM public.timesheet_entries WHERE id=_entry AND timesheet_id=t.id AND is_manual;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.owner_delete_managed_entry_atomic(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_delete_managed_entry_atomic(uuid,uuid,uuid,uuid) TO service_role;