CREATE OR REPLACE FUNCTION public.apply_schedule_publish_op(_caller uuid, _family uuid, _draft uuid, _revision integer, _run uuid, _shift jsonb, _op jsonb, _source uuid, _timezone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _op_key text := _draft::text || ':' || (_shift->>'id') || ':' || _revision::text;
  _claimed record;
  _event record;
  _event_id uuid;
  _start timestamptz;
  _end timestamptz;
  _member_id uuid;
  _babysitter_source uuid;
  _draft_row public.babysitter_schedule_drafts;
  _preview public.babysitter_schedule_publish_previews;
  _reviewed jsonb;
  _mapped_id uuid;
  _series_version timestamptz;
BEGIN
  IF _caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.family_users
    WHERE family_id = _family AND user_id = _caller AND role IN ('owner','editor')
  ) THEN
    RAISE EXCEPTION 'Only a current household Owner can publish schedule drafts.';
  END IF;

  PERFORM public.lock_timesheet_household(_family);
  SELECT * INTO _draft_row FROM public.babysitter_schedule_drafts
  WHERE id = _draft AND family_id = _family FOR UPDATE;
  IF NOT FOUND OR _draft_row.revision IS DISTINCT FROM _revision THEN
    RAISE EXCEPTION 'This draft changed since it was reviewed. Reload the preview before publishing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.babysitter_schedule_publish_runs
    WHERE id = _run AND family_id = _family AND draft_id = _draft
  ) THEN
    RAISE EXCEPTION 'The publish run does not match this household and draft.';
  END IF;

  SELECT * INTO _preview FROM public.babysitter_schedule_publish_previews
  WHERE id = (_op->>'previewId')::uuid AND family_id = _family
    AND draft_id = _draft AND draft_revision = _revision AND created_by = _caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'A server-reviewed publish preview is required.'; END IF;
  SELECT value INTO _reviewed FROM jsonb_array_elements(_preview.plan->'ops')
  WHERE value->>'shiftId' = _shift->>'id';
  IF _reviewed IS NULL
     OR _reviewed->>'kind' IS DISTINCT FROM _op->>'kind'
     OR _reviewed->>'eventId' IS DISTINCT FROM _op->>'eventId'
     OR _reviewed->>'occurrenceDate' IS DISTINCT FROM _op->>'occurrenceDate' THEN
    RAISE EXCEPTION 'This operation does not match the reviewed publish preview.';
  END IF;
  -- Expected version: the reviewed version, or one produced by this same run's
  -- own committed step for this event (several changes to one series).
  IF _op->>'kind' IN ('update','exclude') AND (
    nullif(_op->>'expectedUpdatedAt','') IS NULL
    OR _preview.event_versions->>(_op->>'eventId') IS NULL
    OR (
      _op->>'expectedUpdatedAt' IS DISTINCT FROM _preview.event_versions->>(_op->>'eventId')
      AND NOT EXISTS (
        SELECT 1 FROM public.babysitter_schedule_publish_ops chain
        WHERE chain.family_id = _family AND chain.run_id = _run AND chain.draft_id = _draft
          AND chain.draft_revision = _revision AND chain.status = 'applied'
          AND chain.payload->'op'->>'eventId' = _op->>'eventId'
          AND nullif(chain.payload->>'series_version','')::timestamptz = (_op->>'expectedUpdatedAt')::timestamptz
      )
    )
  ) THEN RAISE EXCEPTION 'The immutable reviewed event version is required.'; END IF;

  IF _op->>'kind' IN ('create','update','exclude') AND EXISTS (
    SELECT 1 FROM public.families f,
      LATERAL (VALUES (_op->>'occurrenceDate'), (_reviewed->'original'->>'date'),
        (CASE WHEN _op->>'kind' <> 'exclude' THEN _shift->>'date' END)) v(dt)
    WHERE f.id = _family AND nullif(v.dt,'') IS NOT NULL
      AND v.dt::date < (now() AT TIME ZONE f.timezone)::date
  ) THEN
    RAISE EXCEPTION 'Past dates are read-only. Nothing was published for this change — please refresh Review.' USING ERRCODE = 'P0001';
  END IF;

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
    IF _claimed.status = 'applied' THEN
      RETURN jsonb_build_object('outcome', 'already_applied', 'event_id', _claimed.event_id,
        'series_version', (SELECT payload->>'series_version' FROM public.babysitter_schedule_publish_ops WHERE id = _claimed.id));
    END IF;
  END IF;

  _start := ((_shift->>'date') || ' ' || (_shift->>'start') || ':00')::timestamp AT TIME ZONE _timezone;
  _end := ((_shift->>'date') || ' ' || (_shift->>'end') || ':00')::timestamp AT TIME ZONE _timezone;

  SELECT pe.event_id INTO _mapped_id
  FROM public.babysitter_schedule_publish_ops pe
  WHERE pe.family_id = _family AND pe.draft_id = _draft
    AND pe.draft_shift_id = (_shift->>'id')::uuid
    AND pe.status = 'applied' AND pe.event_id IS NOT NULL
  ORDER BY pe.draft_revision DESC LIMIT 1;
  IF _mapped_id IS NOT NULL AND (
    _op->>'kind' NOT IN ('update','exclude')
    OR (_op->>'eventId')::uuid IS DISTINCT FROM _mapped_id
  ) THEN RAISE EXCEPTION 'Previously published proposals require a reviewed update to their mapped event.'; END IF;

  IF _op->>'kind' = 'create' THEN
    INSERT INTO public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, event_type, last_change_source)
    VALUES (_family, _source, _shift->>'title', _start, _end, false, 'childcare', 'app')
    RETURNING id INTO _event_id;

  ELSIF _op->>'kind' = 'update' THEN
    SELECT * INTO _event FROM public.events
    WHERE id = (_op->>'eventId')::uuid AND family_id = _family
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The calendar event this proposal references is no longer available.';
    END IF;
    IF nullif(_op->>'expectedUpdatedAt','') IS NULL
       OR _event.updated_at IS DISTINCT FROM (_op->>'expectedUpdatedAt')::timestamptz THEN
      RAISE EXCEPTION 'This event changed since the plan was reviewed. Reload the preview before publishing.';
    END IF;

    IF _event.recurrence_rule IS NOT NULL THEN
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
      INSERT INTO public.event_members (event_id, family_member_id, weekdays)
      SELECT _event_id, family_member_id, NULL
      FROM public.event_members WHERE event_id = _event.id;
    ELSE
      UPDATE public.events
      SET title = _shift->>'title', start_at = _start, end_at = _end, updated_at = now()
      WHERE id = _event.id;
      _event_id := _event.id;
    END IF;

  ELSIF _op->>'kind' = 'exclude' THEN
    SELECT * INTO _event FROM public.events
    WHERE id = (_op->>'eventId')::uuid AND family_id = _family FOR UPDATE;
    IF NOT FOUND OR _event.calendar_source_id IS DISTINCT FROM _source THEN
      RAISE EXCEPTION 'The Babysitter shift selected for removal is no longer available.';
    END IF;
    IF nullif(_op->>'expectedUpdatedAt','') IS NULL
       OR _event.updated_at IS DISTINCT FROM (_op->>'expectedUpdatedAt')::timestamptz THEN
      RAISE EXCEPTION 'This shift changed since review. Refresh before removing it.';
    END IF;
    IF _op->>'occurrenceDate' IS NULL OR _reviewed->'original'->>'occurrenceKey' IS DISTINCT FROM _reviewed->>'occurrenceKey'
       OR _reviewed->'original'->>'date' IS DISTINCT FROM _op->>'occurrenceDate' THEN
      RAISE EXCEPTION 'The selected occurrence could not be verified safely.';
    END IF;
    _event_id := _event.id;
    IF _event.recurrence_rule IS NOT NULL THEN
      IF (_op->>'occurrenceDate')::date = ANY(COALESCE(_event.excluded_dates, '{}'::date[])) THEN
        RAISE EXCEPTION 'This occurrence is already excluded. Refresh the review.';
      END IF;
      UPDATE public.events SET excluded_dates = array_append(COALESCE(excluded_dates, '{}'::date[]), (_op->>'occurrenceDate')::date),
        last_change_source = 'app', updated_at = now() WHERE id = _event.id;
    ELSE
      DELETE FROM public.events WHERE id = _event.id AND family_id = _family;
      _event_id := NULL;
    END IF;
    SELECT updated_at INTO _series_version FROM public.events WHERE id = _event.id;
    UPDATE public.babysitter_schedule_publish_ops
    SET status = 'applied', event_id = _event_id, run_id = _run, updated_at = now(), last_error = NULL,
      payload = payload || jsonb_build_object('removed_event_id', _event.id, 'series_version', _series_version)
    WHERE family_id = _family AND op_key = _op_key;
    RETURN jsonb_build_object('outcome', 'applied', 'event_id', _event.id, 'series_version', _series_version);
  ELSE
    RAISE EXCEPTION 'Publish operation kind "%" is not supported yet.', _op->>'kind';
  END IF;

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

  IF nullif(_op->>'eventId','') IS NOT NULL THEN
    SELECT updated_at INTO _series_version FROM public.events WHERE id = (_op->>'eventId')::uuid;
  END IF;
  UPDATE public.babysitter_schedule_publish_ops
  SET status = 'applied', event_id = _event_id, run_id = _run, updated_at = now(), last_error = NULL,
    payload = payload || jsonb_build_object('series_version', _series_version)
  WHERE family_id = _family AND op_key = _op_key;

  RETURN jsonb_build_object('outcome', 'applied', 'event_id', _event_id, 'series_version', _series_version);
END;
$fn$;