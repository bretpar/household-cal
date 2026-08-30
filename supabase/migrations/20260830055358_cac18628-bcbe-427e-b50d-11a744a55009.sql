ALTER TABLE public.calendar_sources
  ADD COLUMN IF NOT EXISTS google_time_zone text,
  ADD COLUMN IF NOT EXISTS app_managed_calendar boolean NOT NULL DEFAULT false;

-- Households must store a real IANA zone; fixed GMT offsets cannot express DST.
UPDATE public.families
   SET timezone = 'America/Los_Angeles'
 WHERE timezone IS NULL
    OR btrim(timezone) = ''
    OR timezone ~* '^(gmt|utc)?[+-]'
    OR timezone ~* '^etc/'
    OR (timezone <> 'UTC' AND position('/' in timezone) = 0);

ALTER TABLE public.families
  DROP CONSTRAINT IF EXISTS families_timezone_is_iana;
ALTER TABLE public.families
  ADD CONSTRAINT families_timezone_is_iana
  CHECK (
    timezone = 'UTC'
    OR (
      position('/' in timezone) > 0
      AND timezone !~* '^etc/'
      AND timezone !~* '^(gmt|utc)?[+-]'
    )
  );