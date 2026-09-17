ALTER TABLE public.families
ADD COLUMN IF NOT EXISTS include_google_event_initials boolean NOT NULL DEFAULT true;