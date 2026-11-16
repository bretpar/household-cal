CREATE OR REPLACE FUNCTION public.mutate_caregiver_series(_user uuid,_shift uuid,_version uuid,_scope text,_delete boolean,_client uuid,_start timestamptz,_end timestamptz,_days text[],_until date,_notes text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.caregiver_work_shifts; sid uuid; zone text; cutoff date; base_day date; r public.caregiver_work_shifts; new_start timestamptz; day_code text;
BEGIN
 PERFORM public.lock_caregiver_user(_user);
 SELECT timezone INTO zone FROM public.caregiver_workspaces WHERE user_id=_user;
 IF zone IS NULL THEN RAISE EXCEPTION 'Caregiver workspace required'; END IF;
 IF _scope NOT IN ('only','future') THEN RAISE EXCEPTION 'Choose a shift scope'; END IF;
 IF _shift IS NOT NULL THEN
 SELECT * INTO s FROM public.caregiver_work_shifts WHERE id=_shift AND user_id=_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR s.version IS DISTINCT FROM _version THEN RAISE EXCEPTION 'Reload the shift before editing'; END IF;
 IF _scope='only' AND (s.series_id IS NOT NULL OR cardinality(_days)=0) THEN
 UPDATE public.caregiver_work_shifts SET client_id=CASE WHEN _delete THEN client_id ELSE _client END,start_at=CASE WHEN _delete THEN start_at ELSE _start END,end_at=CASE WHEN _delete THEN end_at ELSE _end END,notes=CASE WHEN _delete THEN notes ELSE _notes END,deleted_at=CASE WHEN _delete THEN now() ELSE NULL END,is_exception=series_id IS NOT NULL WHERE id=s.id;
 RETURN s.id;
 END IF;
 IF s.series_id IS NOT NULL THEN
 cutoff:=s.occurrence_date;
 UPDATE public.caregiver_shift_series SET until_date=cutoff-1,version=gen_random_uuid() WHERE id=s.series_id AND user_id=_user;
 IF _delete OR cardinality(_days)=0 THEN UPDATE public.caregiver_work_shifts SET deleted_at=now() WHERE series_id=s.series_id AND occurrence_date>=cutoff AND NOT is_exception AND deleted_at IS NULL; END IF;
 END IF;
 END IF;
 IF _delete THEN RETURN _shift; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.caregiver_clients WHERE id=_client AND user_id=_user AND (NOT archived OR s.client_id=_client)) THEN RAISE EXCEPTION 'Choose an owned active family contact'; END IF;
 IF cardinality(_days)>0 THEN
 base_day:=(_start AT TIME ZONE zone)::date;
 IF _until IS NOT NULL AND _until<base_day THEN RAISE EXCEPTION 'Repeat end cannot precede start'; END IF;
 INSERT INTO public.caregiver_shift_series(user_id,client_id,start_at,end_at,weekdays,until_date,notes) VALUES(_user,_client,_start,_end,_days,_until,_notes) RETURNING id INTO sid;
 IF s.series_id IS NOT NULL THEN
 FOR r IN SELECT * FROM public.caregiver_work_shifts WHERE series_id=s.series_id AND occurrence_date>=cutoff ORDER BY occurrence_date FOR UPDATE LOOP
 IF r.is_exception THEN UPDATE public.caregiver_work_shifts SET series_id=sid WHERE id=r.id;
 ELSE
 day_code:=(ARRAY['SU','MO','TU','WE','TH','FR','SA'])[extract(dow FROM r.occurrence_date)::int+1];
 new_start:=(r.occurrence_date+(_start AT TIME ZONE zone)::time) AT TIME ZONE zone;
 UPDATE public.caregiver_work_shifts SET series_id=sid,client_id=_client,start_at=new_start,end_at=new_start+(_end-_start),notes=_notes,
 deleted_at=CASE WHEN r.occurrence_date<base_day OR (_until IS NOT NULL AND r.occurrence_date>_until) OR NOT(day_code=ANY(_days)) THEN coalesce(r.deleted_at,now()) ELSE NULL END,is_exception=false WHERE id=r.id;
 END IF;
 END LOOP;
 ELSIF s.id IS NOT NULL THEN
 UPDATE public.caregiver_work_shifts SET series_id=sid,occurrence_date=base_day,start_at=_start,end_at=_end,client_id=_client,notes=_notes,is_exception=false WHERE id=s.id;
 END IF;
 RETURN sid;
 END IF;
 IF _shift IS NOT NULL AND s.series_id IS NULL THEN UPDATE public.caregiver_work_shifts SET client_id=_client,start_at=_start,end_at=_end,notes=_notes WHERE id=s.id; RETURN s.id; END IF;
 INSERT INTO public.caregiver_work_shifts(user_id,client_id,start_at,end_at,notes) VALUES(_user,_client,_start,_end,_notes) RETURNING id INTO sid; RETURN sid;
END $$;
CREATE FUNCTION public.mark_caregiver_shift_exception() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.series_id IS NOT NULL AND NEW.series_id IS NOT DISTINCT FROM OLD.series_id AND ROW(NEW.start_at,NEW.end_at,NEW.client_id,NEW.notes,NEW.deleted_at) IS DISTINCT FROM ROW(OLD.start_at,OLD.end_at,OLD.client_id,OLD.notes,OLD.deleted_at) THEN NEW.is_exception:=true; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER caregiver_shift_exception BEFORE UPDATE ON public.caregiver_work_shifts FOR EACH ROW EXECUTE FUNCTION public.mark_caregiver_shift_exception();