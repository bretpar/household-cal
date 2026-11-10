-- Repair 3: immutable, service-only reviewed plans; no calendar data changes.
CREATE TABLE public.babysitter_schedule_publish_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.babysitter_schedule_drafts(id) ON DELETE CASCADE,
  draft_revision integer NOT NULL,
  created_by uuid NOT NULL,
  plan jsonb NOT NULL,
  event_versions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.babysitter_schedule_publish_previews TO service_role;
ALTER TABLE public.babysitter_schedule_publish_previews ENABLE ROW LEVEL SECURITY;
-- No authenticated/anon privileges or policies: only verified server callers
-- can create or read a snapshot. No UPDATE grant: reviews are immutable.

-- Replace only the two unsafe sections of the existing RPC, retaining its
-- assignments, recurrence, metadata, journal and service-only grants verbatim.
DO $repair$
DECLARE
  definition text;
  old_section text;
  new_section text;
BEGIN
  SELECT pg_get_functiondef('public.apply_schedule_publish_op(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,uuid,text)'::regprocedure) INTO definition;
  old_section := $old$  _babysitter_source uuid;
BEGIN$old$;
  new_section := $new$  _babysitter_source uuid;
  _draft_row public.babysitter_schedule_drafts;
  _preview public.babysitter_schedule_publish_previews;
  _reviewed jsonb;
  _mapped_id uuid;
BEGIN$new$;
  IF strpos(definition, old_section) = 0 THEN RAISE EXCEPTION 'Unexpected publish RPC declarations'; END IF;
  definition := replace(definition, old_section, new_section);

  old_section := $old$  IF NOT EXISTS (
    SELECT 1 FROM public.babysitter_schedule_drafts
    WHERE id = _draft AND family_id = _family AND revision = _revision
  ) THEN$old$;
  new_section := $new$  -- Consistent order: household advisory lock, draft row, journal, event.
  -- Draft UPDATEs acquire this same row lock and recheck their revision predicate.
  PERFORM public.lock_timesheet_household(_family);
  SELECT * INTO _draft_row FROM public.babysitter_schedule_drafts
  WHERE id = _draft AND family_id = _family FOR UPDATE;
  IF NOT FOUND OR _draft_row.revision IS DISTINCT FROM _revision THEN$new$;
  IF strpos(definition, old_section) = 0 THEN RAISE EXCEPTION 'Unexpected publish draft validation'; END IF;
  definition := replace(definition, old_section, new_section);

  old_section := $old$  -- Claim exactly once under concurrent requests.$old$;
  new_section := $new$  -- Bind every potentially mutating operation to an immutable server preview.
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
  IF _op->>'kind' = 'update' AND (
    nullif(_op->>'expectedUpdatedAt','') IS NULL
    OR _preview.event_versions->>(_op->>'eventId') IS NULL
    OR _op->>'expectedUpdatedAt' IS DISTINCT FROM _preview.event_versions->>(_op->>'eventId')
  ) THEN RAISE EXCEPTION 'The immutable reviewed event version is required.'; END IF;

  -- Claim exactly once under concurrent requests.$new$;
  IF strpos(definition, old_section) = 0 THEN RAISE EXCEPTION 'Unexpected publish journal claim'; END IF;
  definition := replace(definition, old_section, new_section);

  old_section := $old$  IF _op->>'kind' = 'create' THEN
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
    END IF;$old$;
  new_section := $new$  -- Serialize mapping reads with other publishers via the already-held draft lock.
  SELECT pe.event_id INTO _mapped_id
  FROM public.babysitter_schedule_publish_ops pe
  WHERE pe.family_id = _family AND pe.draft_id = _draft
    AND pe.draft_shift_id = (_shift->>'id')::uuid
    AND pe.status = 'applied' AND pe.event_id IS NOT NULL
  ORDER BY pe.draft_revision DESC LIMIT 1;
  IF _mapped_id IS NOT NULL AND (
    _op->>'kind' IS DISTINCT FROM 'update'
    OR (_op->>'eventId')::uuid IS DISTINCT FROM _mapped_id
  ) THEN RAISE EXCEPTION 'Previously published proposals require a reviewed update to their mapped event.'; END IF;

  IF _op->>'kind' = 'create' THEN
    INSERT INTO public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, event_type, last_change_source)
    VALUES (_family, _source, _shift->>'title', _start, _end, false, 'childcare', 'app')
    RETURNING id INTO _event_id;$new$;
  IF strpos(definition, old_section) = 0 THEN RAISE EXCEPTION 'Unexpected mapped-create branch'; END IF;
  definition := replace(definition, old_section, new_section);

  old_section := $old$    IF _op->>'expectedUpdatedAt' IS NOT NULL
       AND _event.updated_at <> (_op->>'expectedUpdatedAt')::timestamptz THEN$old$;
  new_section := $new$    IF nullif(_op->>'expectedUpdatedAt','') IS NULL
       OR _event.updated_at IS DISTINCT FROM (_op->>'expectedUpdatedAt')::timestamptz THEN$new$;
  IF strpos(definition, old_section) = 0 THEN RAISE EXCEPTION 'Unexpected event version validation'; END IF;
  definition := replace(definition, old_section, new_section);
  EXECUTE definition;
END $repair$;
REVOKE EXECUTE ON FUNCTION public.apply_schedule_publish_op(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_schedule_publish_op(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,uuid,text) TO service_role;