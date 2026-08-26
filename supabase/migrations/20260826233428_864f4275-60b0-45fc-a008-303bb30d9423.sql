ALTER TABLE public.calendar_sources
  ADD COLUMN selectable_in_email boolean NOT NULL DEFAULT true;

-- internal/system sources are not user-selectable calendars
UPDATE public.calendar_sources
   SET selectable_in_email = false
 WHERE display_mode = 'coverage_background'
    OR external_calendar_id IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_email_selectable_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.display_mode = 'coverage_background' THEN
    NEW.selectable_in_email := false;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER calendar_sources_email_selectable
  BEFORE INSERT OR UPDATE ON public.calendar_sources
  FOR EACH ROW EXECUTE FUNCTION public.enforce_email_selectable_source();

-- drop recipient selections that point at ineligible calendars
DELETE FROM public.email_schedule_recipient_calendars c
 USING public.calendar_sources cs
 WHERE cs.id = c.calendar_source_id
   AND (cs.selectable_in_email = false OR cs.display_mode = 'coverage_background');

CREATE OR REPLACE FUNCTION public.assert_recipient_calendar_eligible()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_family uuid;
  src RECORD;
BEGIN
  SELECT family_id INTO recipient_family
    FROM public.email_schedule_recipients
   WHERE id = NEW.recipient_id;

  SELECT family_id, active, selectable_in_email, display_mode INTO src
    FROM public.calendar_sources
   WHERE id = NEW.calendar_source_id;

  IF recipient_family IS NULL OR src.family_id IS NULL OR src.family_id <> recipient_family THEN
    RAISE EXCEPTION 'calendar and recipient must belong to the same household';
  END IF;

  IF src.active IS NOT TRUE
     OR src.selectable_in_email IS NOT TRUE
     OR src.display_mode = 'coverage_background' THEN
    RAISE EXCEPTION 'this calendar cannot be used for email summaries';
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER email_schedule_recipient_calendars_eligible
  BEFORE INSERT OR UPDATE ON public.email_schedule_recipient_calendars
  FOR EACH ROW EXECUTE FUNCTION public.assert_recipient_calendar_eligible();