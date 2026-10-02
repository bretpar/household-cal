ALTER TABLE public.family_members ADD COLUMN IF NOT EXISTS timesheets_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.timesheets ADD COLUMN IF NOT EXISTS owner_managed boolean NOT NULL DEFAULT false;
ALTER TABLE public.families ADD COLUMN IF NOT EXISTS default_babysitter_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.validate_family_babysitter_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  if new.babysitter_calendar_source_id is not null and not exists (
    select 1 from public.calendar_sources s where s.id = new.babysitter_calendar_source_id and s.family_id = new.id
  ) then raise exception 'Babysitter calendar must belong to this household'; end if;
  if new.default_babysitter_family_user_id is not null and not exists (
    select 1 from public.babysitter_access_profiles p where p.family_user_id = new.default_babysitter_family_user_id and p.family_id = new.id
  ) then raise exception 'Default babysitter must be a caregiver in this household'; end if;
  if new.default_babysitter_member_id is not null and not exists (
    select 1 from public.family_members m where m.id = new.default_babysitter_member_id and m.family_id = new.id
      and m.role = 'caregiver' and m.active and m.removed_at is null
  ) then raise exception 'Default babysitter must be an active caregiver in this household'; end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.assert_babysitter_shift_valid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  if not exists (
    select 1 from public.events e join public.families f on f.id = e.family_id
    where e.id = new.event_id and e.family_id = new.family_id
      and e.calendar_source_id is not null
      and e.calendar_source_id = f.babysitter_calendar_source_id
  ) then raise exception 'Shifts can only be set on the household Babysitter calendar'; end if;
  if new.family_user_id is not null and not exists (
    select 1 from public.babysitter_access_profiles p where p.family_user_id = new.family_user_id and p.family_id = new.family_id
  ) then raise exception 'Shift must reference a babysitter in the same household'; end if;
  if new.assignee_member_id is not null and not exists (
    select 1 from public.family_members m where m.id = new.assignee_member_id and m.family_id = new.family_id
  ) then raise exception 'Shift caregiver must belong to this household'; end if;
  return new;
end $$;

-- Shift-days-only caregivers: a shift assigned to their caregiver record unlocks
-- dates whether it was assigned before or after they received sign-in access.
CREATE OR REPLACE FUNCTION public.can_read_event(_family_id uuid, _event_id uuid, _source_id uuid, _start timestamp with time zone, _end timestamp with time zone, _recurrence text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare fu_id uuid; mem_id uuid; scope public.babysitter_date_scope; tz text; t_start_day date; t_end_day date;
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
  if _recurrence is not null then return false; end if;
  select family_member_id into mem_id from public.family_users where id = fu_id;
  if exists (select 1 from public.babysitter_shifts s where s.event_id = _event_id and s.assignment = 'caregiver'
             and (s.family_user_id = fu_id or (mem_id is not null and s.assignee_member_id = mem_id))) then
    return true;
  end if;
  select coalesce(timezone, 'UTC') into tz from public.families where id = _family_id;
  t_start_day := (_start at time zone tz)::date;
  t_end_day := (greatest(_start, _end - interval '1 microsecond') at time zone tz)::date;
  return exists (
    select 1 from public.babysitter_shifts s join public.events e on e.id = s.event_id
    where s.assignment = 'caregiver'
      and (s.family_user_id = fu_id or (mem_id is not null and s.assignee_member_id = mem_id))
      and e.recurrence_rule is null
      and (e.start_at at time zone tz)::date <= t_end_day
      and (greatest(e.start_at, e.end_at - interval '1 microsecond') at time zone tz)::date >= t_start_day
  );
end $$;