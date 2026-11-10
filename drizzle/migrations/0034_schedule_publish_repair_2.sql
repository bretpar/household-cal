-- Repair 2, fix 2: migration 0033 tried to drop a constraint name that never
-- existed (PostgreSQL truncates long auto-names to 63 bytes). Drop the actual
-- per-shift unique constraint by definition, whatever its truncated name is;
-- idempotency lives on (family_id, op_key) only.
DO $$
DECLARE _c text;
BEGIN
  SELECT conname INTO _c FROM pg_constraint
  WHERE conrelid = 'public.babysitter_schedule_publish_ops'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (family_id, draft_id, draft_shift_id)';
  IF _c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.babysitter_schedule_publish_ops DROP CONSTRAINT %I', _c);
  END IF;
END $$;

-- Repair 2, fixes 1 + 4: the RPC is now executable only by the service role
-- (the server execution path), never directly by authenticated users. Because
-- service-role calls have no auth.uid(), ownership is validated explicitly
-- against family_users using the verified caller id the server passes in.
-- Draft/household/revision/run association is revalidated inside the same
-- transaction; caller-supplied ids are never trusted. Detached recurring
-- replacements copy participants without weekday restrictions so a moved
-- occurrence stays visible on its new weekday.
CREATE OR REPLACE FUNCTION public.apply_schedule_publish_op(
  _caller uuid,
  _family uuid,
  _draft uuid,
  _revision integer,
  _run uuid,
  _shift jsonb,
  _op jsonb,
  _source uuid,
  _timezone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _op_key text := _draft::text || ':' || (_shift->>'id') || ':' || _revision::text;
  _claimed record;
  _event record;
  _event_id uuid;
  _start timestamptz;
  _end timestamptz;
  _member_id uuid;
  _babysitter_source uuid;
BEGIN
  -- Ownership: explicit caller check (service-role execution has no auth.uid()).
  IF _caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.family_users
    WHERE family_id = _family AND user_id = _caller AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only a current household Owner can publish schedule drafts.';
  END IF;

  -- Never trust caller-supplied ids: the draft, its revision and the run must
  -- genuinely belong to this household and to each other.
  IF NOT EXISTS (
    SELECT 1 FROM public.babysitter_schedule_drafts
    WHERE id = _draft AND family_id = _family AND revision = _revision
  ) THEN
    RAISE EXCEPTION 'This draft changed since it was reviewed. Reload the preview before publishing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.babysitter_schedule_publish_runs
    WHERE id = _run AND family_id = _family AND draft_id = _draft
  ) THEN
    RAISE EXCEPTION 'The publish run does not match this household and draft.';
  END IF;

  -- Claim exactly once under concurrent requests.
  INSERT INTO public.babysitter_schedule_publish_ops
    (family_id, run_id, draft_id, draft_revision, op_key, draft_shift_id, kind, status, payload)
  VALUES
    (_family, _run, _draft, _revision, _op_key, (_shift->>'id')::uuid, _op->>'kind', 'pending',
     jsonb_build_object('shift', _shift, 'op', _op))
  ON CONFLICT (family_id, op_key) DO NOTHING
  RETURNING id, status, event_id INTO _claimed;

  IF NOT FOUND THEN
    SELECT id, status, event_id INTO _claimed
    FROM public.babysitter_schedule_publish_ops
    WHERE family_id = _family AND op_key = _op_key
    FOR UPDATE;
    -- Repeated request: return the original outcome, never a second event.
    IF _claimed.status = 'applied' THEN
      RETURN jsonb_build_object('outcome', 'already_applied', 'event_id', _claimed.event_id);
    END IF;
  END IF;

  _start := ((_shift->>'date') || ' ' || (_shift->>'start') || ':00')::timestamp AT TIME ZONE _timezone;
  _end := ((_shift->>'date') || ' ' || (_shift->>'end') || ':00')::timestamp AT TIME ZONE _timezone;

  IF _op->>'kind' = 'create' THEN
    -- A later revision of an already-published proposal updates its mapped
    -- event instead of creating a duplicate.
    SELECT pe.event_id INTO _event_id
    FROM public.babysitter_schedule_publish_ops pe
    WHERE pe.family_id = _family AND pe.draft_id = _draft
      AND pe.draft_shift_id = (_shift->>'id')::uuid
      AND pe.status = 'applied' AND pe.event_id IS NOT NULL
    ORDER BY pe.draft_revision DESC
    LIMIT 1;

    IF _event_id IS NOT NULL THEN
      UPDATE public.events
      SET title = _shift->>'title', start_at = _start, end_at = _end, updated_at = now()
      WHERE id = _event_id AND family_id = _family;
      IF NOT FOUND THEN
        INSERT INTO public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, event_type, last_change_source)
        VALUES (_family, _source, _shift->>'title', _start, _end, false, 'childcare', 'app')
        RETURNING id INTO _event_id;
      END IF;
    ELSE
      INSERT INTO public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, event_type, last_change_source)
      VALUES (_family, _source, _shift->>'title', _start, _end, false, 'childcare', 'app')
      RETURNING id INTO _event_id;
    END IF;

  ELSIF _op->>'kind' = 'update' THEN
    SELECT * INTO _event FROM public.events
    WHERE id = (_op->>'eventId')::uuid AND family_id = _family
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The calendar event this proposal references is no longer available.';
    END IF;
    -- Stale-calendar protection: the version reviewed in the plan must still
    -- be current, transactionally, before anything changes.
    IF _op->>'expectedUpdatedAt' IS NOT NULL
       AND _event.updated_at <> (_op->>'expectedUpdatedAt')::timestamptz THEN
      RAISE EXCEPTION 'This event changed since the plan was reviewed. Reload the preview before publishing.';
    END IF;

    IF _event.recurrence_rule IS NOT NULL THEN
      -- Never change the series implicitly: exclude the single occurrence and
      -- create a detached replacement carrying split-lineage identity.
      IF (_op->>'occurrenceDate')::date = ANY(_event.excluded_dates) THEN
        RAISE EXCEPTION 'That occurrence is already excluded from the series.';
      END IF;
      UPDATE public.events
      SET excluded_dates = excluded_dates || (_op->>'occurrenceDate')::date, updated_at = now()
      WHERE id = _event.id;
      INSERT INTO public.events
        (family_id, calendar_source_id, title, start_at, end_at, all_day, location, notes,
         event_type, category_id, last_change_source, split_from_event_id, split_from_date)
      VALUES
        (_family, _event.calendar_source_id, _shift->>'title', _start, _end, _event.all_day,
         _event.location, _event.notes, _event.event_type, _event.category_id, 'app',
         COALESCE(_event.split_from_event_id, _event.id), (_op->>'occurrenceDate')::date)
      RETURNING id INTO _event_id;
      -- Carry over participants, but drop weekday restrictions: the detached
      -- replacement is a one-off and a copied weekday filter could hide it
      -- when the occurrence moved to a different weekday.
      INSERT INTO public.event_members (event_id, family_member_id, weekdays)
      SELECT _event_id, family_member_id, NULL
      FROM public.event_members WHERE event_id = _event.id;
    ELSE
      -- One-off: only title and time change; participants, notes, location,
      -- category and every other field stay exactly as they were.
      UPDATE public.events
      SET title = _shift->>'title', start_at = _start, end_at = _end, updated_at = now()
      WHERE id = _event.id;
      _event_id := _event.id;
    END IF;

  ELSE
    -- Single-occurrence exclusions are deliberately unsupported until the next
    -- phase; reject safely rather than guessing.
    RAISE EXCEPTION 'Publish operation kind "%" is not supported yet.', _op->>'kind';
  END IF;

  -- Caregiver assignment, mirroring syncShiftAssignment: only on the household
  -- Babysitter calendar, validated against active caregiver records.
  SELECT babysitter_calendar_source_id INTO _babysitter_source
  FROM public.families WHERE id = _family;
  IF _source IS NOT NULL AND _source = _babysitter_source THEN
    DELETE FROM public.babysitter_shifts WHERE event_id = _event_id AND family_id = _family;
    IF _shift->'assignment'->>'kind' = 'caregiver' THEN
      _member_id := (_shift->'assignment'->>'family_member_id')::uuid;
      IF NOT EXISTS (
        SELECT 1 FROM public.family_members
        WHERE id = _member_id AND family_id = _family
          AND role = 'caregiver' AND active AND removed_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Choose an active caregiver from this household.';
      END IF;
      INSERT INTO public.babysitter_shifts (family_id, event_id, assignment, assignee_member_id, family_user_id)
      VALUES (_family, _event_id, 'caregiver', _member_id, (
        SELECT bap.family_user_id
        FROM public.babysitter_access_profiles bap
        JOIN public.family_users fu ON fu.id = bap.family_user_id
        WHERE bap.family_id = _family AND fu.family_member_id = _member_id
        LIMIT 1
      ));
    ELSIF _shift->'assignment'->>'kind' = 'other' THEN
      INSERT INTO public.babysitter_shifts (family_id, event_id, assignment, assignee_name)
      VALUES (_family, _event_id, 'other', left(trim(_shift->'assignment'->>'name'), 120));
    ELSE
      INSERT INTO public.babysitter_shifts (family_id, event_id, assignment)
      VALUES (_family, _event_id, 'none');
    END IF;
  END IF;

  UPDATE public.babysitter_schedule_publish_ops
  SET status = 'applied', event_id = _event_id, run_id = _run, updated_at = now()
  WHERE family_id = _family AND op_key = _op_key;

  RETURN jsonb_build_object('outcome', 'applied', 'event_id', _event_id);
END;
$$;

-- Repair 2, fix 1: only the service role (the gated server execution path)
-- may execute the atomic publish operation. Authenticated users, anon and
-- PUBLIC cannot call it directly, so there is no path around the disabled
-- execution gate or around timesheet reconciliation.
REVOKE EXECUTE ON FUNCTION public.apply_schedule_publish_op(uuid, uuid, uuid, integer, uuid, jsonb, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_schedule_publish_op(uuid, uuid, uuid, integer, uuid, jsonb, jsonb, uuid, text) TO service_role;