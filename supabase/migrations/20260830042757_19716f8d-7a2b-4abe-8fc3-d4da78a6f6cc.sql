-- 1. Display style no longer forces calendars out of email summaries.
DROP TRIGGER IF EXISTS calendar_sources_email_selectable ON public.calendar_sources;
DROP FUNCTION IF EXISTS public.enforce_email_selectable_source();

-- 2. Recipient-calendar validation: household + active + selectable only.
CREATE OR REPLACE FUNCTION public.assert_recipient_calendar_eligible()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  recipient_family uuid;
  src RECORD;
BEGIN
  SELECT family_id INTO recipient_family
    FROM public.email_schedule_recipients
   WHERE id = NEW.recipient_id;

  SELECT family_id, active, selectable_in_email INTO src
    FROM public.calendar_sources
   WHERE id = NEW.calendar_source_id;

  IF recipient_family IS NULL OR src.family_id IS NULL OR src.family_id <> recipient_family THEN
    RAISE EXCEPTION 'calendar and recipient must belong to the same household';
  END IF;

  IF src.active IS NOT TRUE OR src.selectable_in_email IS NOT TRUE THEN
    RAISE EXCEPTION 'this calendar cannot be used for email summaries';
  END IF;

  RETURN NEW;
END; $function$;

-- 3. Backfill: real connected Google calendars silenced only by coverage display.
UPDATE public.calendar_sources
   SET selectable_in_email = true
 WHERE provider = 'google'
   AND active = true
   AND display_mode = 'coverage_background'
   AND external_calendar_id IS NOT NULL
   AND selectable_in_email = false;