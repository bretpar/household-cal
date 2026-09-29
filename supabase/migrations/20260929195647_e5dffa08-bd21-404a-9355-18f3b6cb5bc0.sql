CREATE OR REPLACE FUNCTION public.can_read_event(_family_id uuid, _event_id uuid, _source_id uuid, _start timestamp with time zone, _end timestamp with time zone, _recurrence text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fu_id uuid; scope public.babysitter_date_scope; tz text; t_end_day date;
begin
  if not public.has_family_access(_family_id) then return false; end if;
  fu_id := public.babysitter_membership(_family_id);
  if fu_id is null then return true; end if;
  if _source_id is null or not exists (
    select 1 from public.babysitter_access_calendars c
    where c.family_user_id = fu_id and c.calendar_source_id = _source_id
  ) then return false; end if;
  select date_scope into scope from public.babysitter_access_profiles where family_user_id = fu_id;
  if scope = 'all_permitted' then return true; end if;
  if exists (select 1 from public.babysitter_shifts s where s.family_user_id = fu_id and s.event_id = _event_id and s.assignment = 'caregiver') then
    return true;
  end if;
  -- Shift-days-only caregivers never read raw recurring masters; the server
  -- returns sanitized per-date occurrences instead.
  if _recurrence is not null then return false; end if;
  select coalesce(timezone, 'UTC') into tz from public.families where id = _family_id;
  t_end_day := (greatest(_start, _end - interval '1 microsecond') at time zone tz)::date;
  return exists (
    select 1 from public.babysitter_shifts s join public.events e on e.id = s.event_id
    where s.family_user_id = fu_id and s.assignment = 'caregiver'
      and (e.start_at at time zone tz)::date <= t_end_day
      and (case when e.recurrence_rule is not null
             then coalesce(e.recurrence_until + 1, 'infinity'::date)
             else (greatest(e.start_at, e.end_at - interval '1 microsecond') at time zone tz)::date + 1 end)
          >= (_start at time zone tz)::date
  );
end $function$;