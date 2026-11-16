ALTER TABLE public.caregiver_workspaces ADD COLUMN timesheet_frequency text NOT NULL DEFAULT 'weekly' CHECK (timesheet_frequency IN ('weekly','biweekly','monthly')), ADD COLUMN timesheet_anchor date NOT NULL DEFAULT '2026-01-05';
CREATE TABLE public.caregiver_shift_series (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.caregiver_workspaces(user_id) ON DELETE CASCADE,
 client_id uuid NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
 weekdays text[] NOT NULL, until_date date, notes text, version uuid NOT NULL DEFAULT gen_random_uuid(),
 FOREIGN KEY(client_id,user_id) REFERENCES public.caregiver_clients(id,user_id), UNIQUE(id,user_id),
 CHECK(end_at > start_at), CHECK(cardinality(weekdays) BETWEEN 1 AND 7), CHECK(weekdays <@ ARRAY['MO','TU','WE','TH','FR','SA','SU']::text[])
);
GRANT SELECT ON public.caregiver_shift_series TO authenticated;
GRANT ALL ON public.caregiver_shift_series TO service_role;
ALTER TABLE public.caregiver_shift_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY caregiver_series_self ON public.caregiver_shift_series FOR SELECT TO authenticated USING(user_id=auth.uid());
ALTER TABLE public.caregiver_work_shifts ADD COLUMN series_id uuid, ADD COLUMN occurrence_date date, ADD COLUMN is_exception boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT caregiver_shift_series_owner FOREIGN KEY(series_id,user_id) REFERENCES public.caregiver_shift_series(id,user_id), ADD CONSTRAINT caregiver_series_occurrence UNIQUE(series_id,occurrence_date);
ALTER TABLE public.caregiver_shift_actuals ADD COLUMN work_date date, ADD COLUMN client_id uuid;
UPDATE public.caregiver_shift_actuals a SET work_date=(s.start_at AT TIME ZONE w.timezone)::date, client_id=s.client_id FROM public.caregiver_work_shifts s JOIN public.caregiver_workspaces w ON w.user_id=s.user_id WHERE a.shift_id=s.id;
CREATE FUNCTION public.caregiver_actual_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN SELECT (s.start_at AT TIME ZONE w.timezone)::date,s.client_id INTO NEW.work_date,NEW.client_id FROM public.caregiver_work_shifts s JOIN public.caregiver_workspaces w ON w.user_id=s.user_id WHERE s.id=NEW.shift_id AND s.user_id=NEW.user_id;
 ELSE NEW.work_date:=OLD.work_date; NEW.client_id:=OLD.client_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER caregiver_actual_snapshot BEFORE INSERT OR UPDATE ON public.caregiver_shift_actuals FOR EACH ROW EXECUTE FUNCTION public.caregiver_actual_snapshot();
CREATE FUNCTION public.mutate_caregiver_series(_user uuid,_shift uuid,_version uuid,_scope text,_delete boolean,_client uuid,_start timestamptz,_end timestamptz,_days text[],_until date,_notes text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.caregiver_work_shifts; sid uuid; zone text; cutoff date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('caregiver:'||_user::text,0));
 SELECT timezone INTO zone FROM public.caregiver_workspaces WHERE user_id=_user;
 IF zone IS NULL THEN RAISE EXCEPTION 'Caregiver workspace required'; END IF;
 IF _shift IS NOT NULL THEN
 SELECT * INTO s FROM public.caregiver_work_shifts WHERE id=_shift AND user_id=_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR s.version<>_version THEN RAISE EXCEPTION 'Reload the shift before editing'; END IF;
 IF _scope='only' THEN
 UPDATE public.caregiver_work_shifts SET client_id=CASE WHEN _delete THEN client_id ELSE _client END,start_at=CASE WHEN _delete THEN start_at ELSE _start END,end_at=CASE WHEN _delete THEN end_at ELSE _end END,notes=CASE WHEN _delete THEN notes ELSE _notes END,deleted_at=CASE WHEN _delete THEN now() ELSE NULL END,is_exception=series_id IS NOT NULL WHERE id=s.id;
 RETURN s.id;
 END IF;
 IF s.series_id IS NOT NULL THEN
 cutoff:=s.occurrence_date;
 UPDATE public.caregiver_shift_series SET until_date=cutoff-1,version=gen_random_uuid() WHERE id=s.series_id AND user_id=_user;
 UPDATE public.caregiver_work_shifts SET deleted_at=now() WHERE series_id=s.series_id AND occurrence_date>=cutoff AND NOT is_exception AND deleted_at IS NULL;
 END IF;
 END IF;
 IF _delete THEN RETURN _shift; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.caregiver_clients WHERE id=_client AND user_id=_user AND (NOT archived OR s.client_id=_client)) THEN RAISE EXCEPTION 'Choose an owned active family contact'; END IF;
 IF cardinality(_days)>0 THEN
 INSERT INTO public.caregiver_shift_series(user_id,client_id,start_at,end_at,weekdays,until_date,notes) VALUES(_user,_client,_start,_end,_days,_until,_notes) RETURNING id INTO sid;
 -- Move retained individual exceptions into the successor without changing their shift IDs or hours.
 IF s.series_id IS NOT NULL THEN UPDATE public.caregiver_work_shifts SET series_id=sid WHERE series_id=s.series_id AND occurrence_date>=cutoff AND is_exception; END IF;
 RETURN sid;
 END IF;
 IF _shift IS NOT NULL AND s.series_id IS NULL THEN
 UPDATE public.caregiver_work_shifts SET client_id=_client,start_at=_start,end_at=_end,notes=_notes WHERE id=s.id; RETURN s.id;
 END IF;
 INSERT INTO public.caregiver_work_shifts(user_id,client_id,start_at,end_at,notes) VALUES(_user,_client,_start,_end,_notes) RETURNING id INTO sid; RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.mutate_caregiver_series(uuid,uuid,uuid,text,boolean,uuid,timestamptz,timestamptz,text[],date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_caregiver_series(uuid,uuid,uuid,text,boolean,uuid,timestamptz,timestamptz,text[],date,text) TO service_role;
CREATE FUNCTION public.materialize_caregiver_occurrences(_user uuid,_series uuid,_version uuid,_rows jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE series public.caregiver_shift_series; row jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('caregiver:'||_user::text,0));
 SELECT * INTO series FROM public.caregiver_shift_series WHERE id=_series AND user_id=_user FOR UPDATE;
 IF NOT FOUND OR series.version<>_version THEN RETURN; END IF;
 IF jsonb_array_length(_rows)>200 THEN RAISE EXCEPTION 'Occurrence window too large'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(_rows) LOOP
 INSERT INTO public.caregiver_work_shifts(user_id,client_id,start_at,end_at,notes,series_id,occurrence_date) VALUES(_user,series.client_id,(row->>'start_at')::timestamptz,(row->>'end_at')::timestamptz,series.notes,series.id,(row->>'date')::date) ON CONFLICT(series_id,occurrence_date) DO NOTHING;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.materialize_caregiver_occurrences(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_caregiver_occurrences(uuid,uuid,uuid,jsonb) TO service_role;