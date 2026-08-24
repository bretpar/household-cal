-- 1. Household Google connection -------------------------------------------
ALTER TABLE public.google_connections
  ADD COLUMN IF NOT EXISTS google_account_id text,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS google_connections_one_per_family
  ON public.google_connections (family_id);

-- 2. Private token storage (server-only, never exposed to clients) ----------
CREATE TABLE IF NOT EXISTS public.google_connection_secrets (
  connection_id uuid PRIMARY KEY REFERENCES public.google_connections(id) ON DELETE CASCADE,
  connection_key_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.google_connection_secrets TO service_role;
ALTER TABLE public.google_connection_secrets ENABLE ROW LEVEL SECURITY;
-- no policies on purpose: only the service role may read or write tokens

CREATE TRIGGER google_connection_secrets_updated_at
  BEFORE UPDATE ON public.google_connection_secrets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Connected calendars -----------------------------------------------------
ALTER TABLE public.calendar_sources
  ADD COLUMN IF NOT EXISTS is_main boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_sync_token text,
  ADD COLUMN IF NOT EXISTS google_channel_id text,
  ADD COLUMN IF NOT EXISTS google_channel_resource_id text,
  ADD COLUMN IF NOT EXISTS google_channel_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_sources_one_main_per_family
  ON public.calendar_sources (family_id) WHERE is_main;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_sources_unique_google_calendar
  ON public.calendar_sources (family_id, external_calendar_id)
  WHERE provider = 'google' AND external_calendar_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_max_two_google_calendars()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  google_count int;
BEGIN
  IF NEW.provider <> 'google' THEN RETURN NEW; END IF;
  SELECT count(*) INTO google_count
    FROM public.calendar_sources
   WHERE family_id = NEW.family_id
     AND provider = 'google'
     AND id <> NEW.id;
  IF google_count >= 2 THEN
    RAISE EXCEPTION 'a household can connect at most two Google calendars';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS calendar_sources_max_two_google ON public.calendar_sources;
CREATE TRIGGER calendar_sources_max_two_google
  BEFORE INSERT OR UPDATE ON public.calendar_sources
  FOR EACH ROW EXECUTE FUNCTION public.assert_max_two_google_calendars();

-- 4. App event <-> Google event mapping (server-only) ------------------------
CREATE TABLE IF NOT EXISTS public.event_sync_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  calendar_source_id uuid NOT NULL REFERENCES public.calendar_sources(id) ON DELETE CASCADE,
  google_event_id text NOT NULL,
  google_recurring_event_id text,
  branch_key text NOT NULL DEFAULT '',
  google_etag text,
  google_updated_at timestamptz,
  app_version integer NOT NULL DEFAULT 1,
  last_source text NOT NULL DEFAULT 'app',
  last_pushed_at timestamptz,
  sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sync_links_last_source_check CHECK (last_source IN ('app', 'google')),
  CONSTRAINT event_sync_links_unique_branch UNIQUE (event_id, branch_key),
  CONSTRAINT event_sync_links_unique_google UNIQUE (calendar_source_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS event_sync_links_family_idx ON public.event_sync_links (family_id);
CREATE INDEX IF NOT EXISTS event_sync_links_google_idx ON public.event_sync_links (google_event_id);

GRANT ALL ON public.event_sync_links TO service_role;
ALTER TABLE public.event_sync_links ENABLE ROW LEVEL SECURITY;
-- no client policies: sync bookkeeping is written only by trusted server code

CREATE TRIGGER event_sync_links_updated_at
  BEFORE UPDATE ON public.event_sync_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Events imported from Google without family members ----------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS needs_family_assignment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_change_source text NOT NULL DEFAULT 'app';
