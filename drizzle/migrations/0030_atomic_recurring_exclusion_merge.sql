-- Preserve local deletions when an accepted Google update supplies a partial EXDATE set.
-- No data repair; only future writes are affected. Existing migrations remain unchanged.
CREATE OR REPLACE FUNCTION public.preserve_google_event_exclusions() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.last_change_source = 'google' THEN
    SELECT coalesce(array_agg(d ORDER BY d), '{}'::date[]) INTO NEW.excluded_dates
    FROM (SELECT DISTINCT d FROM unnest(coalesce(OLD.excluded_dates, '{}'::date[]) || coalesce(NEW.excluded_dates, '{}'::date[])) AS dates(d) WHERE d IS NOT NULL) AS merged;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_preserve_google_exclusions BEFORE UPDATE OF excluded_dates ON public.events
FOR EACH ROW EXECUTE FUNCTION public.preserve_google_event_exclusions();
REVOKE ALL ON FUNCTION public.preserve_google_event_exclusions() FROM PUBLIC, anon, authenticated;

-- Household lock precedes the event row lock, matching recurring splits/reconciliation.
-- RLS-equivalent editor checks are repeated inside this privileged atomic operation.
CREATE OR REPLACE FUNCTION public.merge_event_exclusions_atomic(_family uuid, _event uuid, _dates date[], _source text DEFAULT 'app') RETURNS date[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target public.events; merged date[];
BEGIN
  IF _family IS NULL OR _event IS NULL OR _dates IS NULL OR cardinality(_dates) = 0 OR array_position(_dates, NULL) IS NOT NULL OR _source IS NULL OR _source NOT IN ('app','google') THEN
    RAISE EXCEPTION 'Invalid occurrence exclusion';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF _source <> 'app' OR auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.family_users WHERE family_id = _family AND user_id = auth.uid() AND role IN ('owner','editor')) THEN
      RAISE EXCEPTION 'You do not have permission to change this calendar';
    END IF;
  END IF;
  PERFORM public.lock_timesheet_household(_family);
  SELECT * INTO target FROM public.events WHERE id = _event AND family_id = _family FOR UPDATE;
  IF target.id IS NULL OR target.recurrence_rule IS NULL THEN RAISE EXCEPTION 'This recurring event changed. Refresh and try again.'; END IF;
  IF _source = 'app' AND EXISTS (SELECT 1 FROM public.calendar_sources WHERE id = target.calendar_source_id AND provider = 'ics') THEN RAISE EXCEPTION 'This subscribed event is read only'; END IF;
  SELECT coalesce(array_agg(d ORDER BY d), '{}'::date[]) INTO merged
  FROM (SELECT DISTINCT d FROM unnest(coalesce(target.excluded_dates, '{}'::date[]) || _dates) AS dates(d)) AS dates;
  IF merged IS DISTINCT FROM target.excluded_dates THEN
    UPDATE public.events SET excluded_dates = merged, last_change_source = _source WHERE id = target.id AND family_id = _family;
  END IF;
  RETURN merged;
END $$;
REVOKE ALL ON FUNCTION public.merge_event_exclusions_atomic(uuid,uuid,date[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_event_exclusions_atomic(uuid,uuid,date[],text) TO authenticated, service_role;
COMMENT ON FUNCTION public.merge_event_exclusions_atomic(uuid,uuid,date[],text) IS 'Append-only occurrence exclusions under household/event locks; Google writes cannot erase existing deletions.';