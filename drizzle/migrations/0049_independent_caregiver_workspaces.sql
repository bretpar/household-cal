CREATE TABLE public.caregiver_workspaces (
 user_id uuid PRIMARY KEY, timezone text NOT NULL DEFAULT 'America/Los_Angeles', created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.caregiver_workspaces TO authenticated;
GRANT ALL ON public.caregiver_workspaces TO service_role;
ALTER TABLE public.caregiver_workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY caregiver_workspace_self ON public.caregiver_workspaces FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TABLE public.caregiver_clients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.caregiver_workspaces(user_id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160), email text, color text NOT NULL DEFAULT 'sky' CHECK (color IN ('sky','rose','amber','sage','teal','lilac','coral','sand')), archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id,user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caregiver_clients TO authenticated;
GRANT ALL ON public.caregiver_clients TO service_role;
ALTER TABLE public.caregiver_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY caregiver_clients_self ON public.caregiver_clients FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TABLE public.caregiver_work_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.caregiver_workspaces(user_id) ON DELETE CASCADE,
 client_id uuid NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, notes text,
 deleted_at timestamptz, version uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (client_id,user_id) REFERENCES public.caregiver_clients(id,user_id), CHECK (end_at > start_at)
);
GRANT SELECT, INSERT, UPDATE ON public.caregiver_work_shifts TO authenticated;
GRANT ALL ON public.caregiver_work_shifts TO service_role;
ALTER TABLE public.caregiver_work_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY caregiver_shifts_self ON public.caregiver_work_shifts FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX caregiver_shifts_window ON public.caregiver_work_shifts(user_id,start_at,end_at);
CREATE TABLE public.caregiver_google_connections (
 user_id uuid PRIMARY KEY REFERENCES public.caregiver_workspaces(user_id) ON DELETE CASCADE,
 connection_key_ciphertext text NOT NULL, account_email text, calendar_id text, calendar_name text,
 status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','reconnect_required','disconnected')),
 last_error text, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.caregiver_google_connections TO service_role;
ALTER TABLE public.caregiver_google_connections ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.caregiver_google_deliveries (
 user_id uuid NOT NULL REFERENCES public.caregiver_workspaces(user_id) ON DELETE CASCADE,
 shift_id uuid NOT NULL REFERENCES public.caregiver_work_shifts(id) ON DELETE CASCADE, calendar_id text NOT NULL,
 version uuid NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','needs_attention')),
 lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, last_error text,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (shift_id,calendar_id)
);
GRANT ALL ON public.caregiver_google_deliveries TO service_role;
ALTER TABLE public.caregiver_google_deliveries ENABLE ROW LEVEL SECURITY;
CREATE INDEX caregiver_google_pending ON public.caregiver_google_deliveries(user_id,status);
CREATE FUNCTION public.caregiver_shift_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE destination text;
BEGIN
 IF TG_OP = 'UPDATE' AND ROW(NEW.client_id,NEW.start_at,NEW.end_at,NEW.notes,NEW.deleted_at) IS NOT DISTINCT FROM ROW(OLD.client_id,OLD.start_at,OLD.end_at,OLD.notes,OLD.deleted_at) THEN
 NEW.version := OLD.version; NEW.updated_at := OLD.updated_at; RETURN NEW;
 END IF;
 IF TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id THEN RAISE EXCEPTION 'Shift ownership cannot change'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.caregiver_clients WHERE id = NEW.client_id AND user_id = NEW.user_id AND (NOT archived OR TG_OP = 'UPDATE')) THEN RAISE EXCEPTION 'Choose an available family contact'; END IF;
 NEW.version := gen_random_uuid(); NEW.updated_at := clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER caregiver_shift_version BEFORE INSERT OR UPDATE ON public.caregiver_work_shifts FOR EACH ROW EXECUTE FUNCTION public.caregiver_shift_changed();
CREATE FUNCTION public.caregiver_queue_shift() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE destination text;
BEGIN
 SELECT calendar_id INTO destination FROM public.caregiver_google_connections WHERE user_id = NEW.user_id AND status <> 'disconnected';
 IF destination IS NOT NULL THEN
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version) VALUES (NEW.user_id,NEW.id,destination,NEW.version)
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET version = EXCLUDED.version,status = 'pending',attempts = 0,last_error = NULL,updated_at = clock_timestamp();
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER caregiver_shift_outbound AFTER INSERT OR UPDATE ON public.caregiver_work_shifts FOR EACH ROW WHEN (NEW.version IS NOT NULL) EXECUTE FUNCTION public.caregiver_queue_shift();
CREATE FUNCTION public.caregiver_queue_contact_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NEW.name IS DISTINCT FROM OLD.name THEN
 UPDATE public.caregiver_work_shifts SET version = gen_random_uuid() WHERE client_id = NEW.id AND deleted_at IS NULL;
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version)
 SELECT s.user_id,s.id,c.calendar_id,s.version FROM public.caregiver_work_shifts s JOIN public.caregiver_google_connections c ON c.user_id = s.user_id
 WHERE s.client_id = NEW.id AND s.deleted_at IS NULL AND c.calendar_id IS NOT NULL AND c.status <> 'disconnected'
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET status='pending',last_error=NULL,updated_at=clock_timestamp();
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER caregiver_contact_outbound AFTER UPDATE ON public.caregiver_clients FOR EACH ROW EXECUTE FUNCTION public.caregiver_queue_contact_changes();
CREATE FUNCTION public.claim_caregiver_google_delivery(_user uuid) RETURNS SETOF public.caregiver_google_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE chosen public.caregiver_google_deliveries;
BEGIN
 SELECT d.* INTO chosen FROM public.caregiver_google_deliveries d JOIN public.caregiver_google_connections c ON c.user_id=d.user_id
 WHERE d.user_id=_user AND d.status <> 'synced' AND c.status='connected' AND c.calendar_id=d.calendar_id
 AND (d.lease_until IS NULL OR d.lease_until < now()) ORDER BY d.updated_at FOR UPDATE OF d SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY UPDATE public.caregiver_google_deliveries SET lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',attempts=attempts+1 WHERE shift_id=chosen.shift_id AND calendar_id=chosen.calendar_id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.claim_caregiver_google_delivery(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_caregiver_google_delivery(uuid) TO service_role;
CREATE FUNCTION public.finish_caregiver_google_delivery(_shift uuid,_calendar text,_lease uuid,_version uuid,_error text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 UPDATE public.caregiver_google_deliveries SET status=CASE WHEN version<>_version THEN 'pending' WHEN _error IS NULL THEN 'synced' ELSE 'needs_attention' END,
 last_error=CASE WHEN version=_version THEN _error ELSE NULL END,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE shift_id=_shift AND calendar_id=_calendar AND lease_token=_lease;
END $$;
REVOKE ALL ON FUNCTION public.finish_caregiver_google_delivery(uuid,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_caregiver_google_delivery(uuid,text,uuid,uuid,text) TO service_role;
CREATE FUNCTION public.select_caregiver_google_calendar(_user uuid,_calendar text,_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prior text;
BEGIN
 SELECT calendar_id INTO prior FROM public.caregiver_google_connections WHERE user_id=_user AND status='connected' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Connect Google Calendar first'; END IF;
 IF prior IS NOT NULL AND prior<>_calendar THEN RAISE EXCEPTION 'Keep the current work calendar to preserve existing Google shift identities'; END IF;
 UPDATE public.caregiver_google_connections SET calendar_id=_calendar,calendar_name=_name,updated_at=now() WHERE user_id=_user;
 INSERT INTO public.caregiver_google_deliveries(user_id,shift_id,calendar_id,version)
 SELECT user_id,id,_calendar,version FROM public.caregiver_work_shifts WHERE user_id=_user AND deleted_at IS NULL
 ON CONFLICT (shift_id,calendar_id) DO UPDATE SET version=EXCLUDED.version,status='pending',last_error=NULL,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.select_caregiver_google_calendar(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_caregiver_google_calendar(uuid,text,text) TO service_role;
CREATE FUNCTION public.clean_independent_caregiver_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN DELETE FROM public.caregiver_workspaces WHERE user_id=OLD.id; RETURN OLD; END $$;
CREATE TRIGGER clean_independent_caregiver_account BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.clean_independent_caregiver_account();