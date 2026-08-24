ALTER TABLE public.event_members
  ADD COLUMN weekdays text[];

COMMENT ON COLUMN public.event_members.weekdays IS
  'Optional per-participant weekday restriction inside a recurring series (RRULE BYDAY codes: MO,TU,WE,TH,FR,SA,SU). NULL means the member participates on every occurrence of the series.';

ALTER TABLE public.event_members
  ADD CONSTRAINT event_members_weekdays_valid
  CHECK (
    weekdays IS NULL
    OR (
      array_length(weekdays, 1) >= 1
      AND weekdays <@ ARRAY['MO','TU','WE','TH','FR','SA','SU']::text[]
    )
  );