DO $repair$
DECLARE definition text; old_section text; new_section text;
BEGIN
 SELECT pg_get_functiondef('public.apply_schedule_publish_op(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,uuid,text)'::regprocedure) INTO definition;
 old_section := $old$IF _op->>'kind' = 'update' AND ($old$;
 IF strpos(definition, old_section) = 0 THEN RAISE EXCEPTION 'Unexpected reviewed-version guard'; END IF;
 definition := replace(definition, old_section, $new$IF _op->>'kind' IN ('update','exclude') AND ($new$);
 old_section := $old$_op->>'kind' IS DISTINCT FROM 'update'$old$;
 IF strpos(definition, old_section) = 0 THEN RAISE EXCEPTION 'Unexpected mapped-event guard'; END IF;
 definition := replace(definition, old_section, $new$_op->>'kind' NOT IN ('update','exclude')$new$);
 old_section := $old$  ELSE
    -- Single-occurrence exclusions are deliberately unsupported until the next
    -- phase; reject safely rather than guessing.
    RAISE EXCEPTION 'Publish operation kind "%" is not supported yet.', _op->>'kind';
  END IF;$old$;
 new_section := $new$  ELSIF _op->>'kind' = 'exclude' THEN
    -- Household -> draft -> journal locks and immutable preview checks above
    -- are shared with updates; this final event lock protects deletion too.
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
      -- Existing BEFORE DELETE delivery trigger records Google deletion intent.
      DELETE FROM public.events WHERE id = _event.id AND family_id = _family;
      _event_id := NULL; -- journal FK cannot reference a deleted event
    END IF;
    UPDATE public.babysitter_schedule_publish_ops
    SET status = 'applied', event_id = _event_id, run_id = _run, updated_at = now(),
      payload = payload || jsonb_build_object('removed_event_id', _event.id)
    WHERE family_id = _family AND op_key = _op_key;
    -- Never recreate a caregiver assignment or replacement event for removal.
    RETURN jsonb_build_object('outcome', 'applied', 'event_id', _event.id);
  ELSE
    RAISE EXCEPTION 'Publish operation kind "%" is not supported yet.', _op->>'kind';
  END IF;$new$;
 IF strpos(definition, old_section) = 0 THEN RAISE EXCEPTION 'Unexpected unsupported removal branch'; END IF;
 definition := replace(definition, old_section, new_section);
 EXECUTE definition;
END $repair$;
REVOKE EXECUTE ON FUNCTION public.apply_schedule_publish_op(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_schedule_publish_op(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,uuid,text) TO service_role;