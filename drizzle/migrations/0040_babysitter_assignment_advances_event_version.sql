CREATE OR REPLACE FUNCTION public.bump_event_version_on_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    _ids := ARRAY[NEW.event_id];
  ELSIF TG_OP = 'DELETE' THEN
    _ids := ARRAY[OLD.event_id];
  ELSE
    IF NEW.event_id IS NOT DISTINCT FROM OLD.event_id
       AND NEW.assignment IS NOT DISTINCT FROM OLD.assignment
       AND NEW.assignee_member_id IS NOT DISTINCT FROM OLD.assignee_member_id
       AND NEW.assignee_name IS NOT DISTINCT FROM OLD.assignee_name
       AND NEW.family_user_id IS NOT DISTINCT FROM OLD.family_user_id THEN
      RETURN NULL; -- no-op update: keep version
    END IF;
    _ids := ARRAY(SELECT DISTINCT unnest(ARRAY[OLD.event_id, NEW.event_id]) ORDER BY 1);
  END IF;
  -- Row-locks each parent event (same lock publishing takes with FOR UPDATE) and
  -- advances updated_at via the existing events_updated_at trigger. Only
  -- updated_at is written, so column-scoped Google/calendar triggers do not fire.
  UPDATE public.events SET updated_at = now() WHERE id = ANY(_ids);
  RETURN NULL;
END; $$;

REVOKE ALL ON FUNCTION public.bump_event_version_on_assignment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER babysitter_shift_bumps_event_version
AFTER INSERT OR UPDATE OR DELETE ON public.babysitter_shifts
FOR EACH ROW EXECUTE FUNCTION public.bump_event_version_on_assignment();