ALTER TABLE public.calendar_sources
  ADD COLUMN IF NOT EXISTS calendar_kind text NOT NULL DEFAULT 'custom'
  CHECK (calendar_kind IN ('household_default', 'custom', 'legacy_internal'));

-- Existing local rows: the earliest local "events" row per household is the Family calendar;
-- remaining legacy local rows (e.g. Caregiver coverage) are internal-only.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY family_id ORDER BY sort_order, created_at) AS rn
  FROM public.calendar_sources
  WHERE provider = 'local' AND display_mode = 'events'
)
UPDATE public.calendar_sources cs
SET calendar_kind = 'household_default'
FROM ranked r
WHERE cs.id = r.id AND r.rn = 1;

UPDATE public.calendar_sources
SET calendar_kind = 'legacy_internal'
WHERE provider = 'local' AND calendar_kind = 'custom';