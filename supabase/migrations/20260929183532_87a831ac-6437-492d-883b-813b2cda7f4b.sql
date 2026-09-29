-- Stage 3: automatic babysitter shifts
alter table public.families
  add column babysitter_calendar_source_id uuid references public.calendar_sources(id) on delete set null,
  add column default_babysitter_family_user_id uuid references public.babysitter_access_profiles(family_user_id) on delete set null;

alter table public.babysitter_shifts
  alter column family_user_id drop not null,
  add column assignment text not null default 'caregiver',
  add column assignee_name text,
  add constraint babysitter_shifts_assignment_check check (
    (assignment = 'caregiver' and family_user_id is not null and assignee_name is null)
    or (assignment = 'other' and family_user_id is null and length(btrim(coalesce(assignee_name,''))) between 1 and 120)
    or (assignment = 'none' and family_user_id is null and assignee_name is null)
  );
create unique index babysitter_shifts_one_per_event on public.babysitter_shifts(event_id);

-- One-time convenience: households with exactly one active calendar named like "Babysitter" get it preselected.
update public.families f set babysitter_calendar_source_id = s.id
from (
  select family_id, (array_agg(id))[1] as id from public.calendar_sources
  where active and name ilike 'babysitter%' group by family_id having count(*) = 1
) s where s.family_id = f.id;

create or replace function public.assert_babysitter_shift_valid()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
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
  return new;
end $function$;

-- Moving an event off the Babysitter calendar removes its shift designation.
create or replace function public.drop_shift_when_event_leaves_babysitter_calendar()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.calendar_source_id is distinct from old.calendar_source_id and not exists (
    select 1 from public.families f where f.id = new.family_id and f.babysitter_calendar_source_id = new.calendar_source_id
  ) then
    delete from public.babysitter_shifts where event_id = new.id;
  end if;
  return new;
end $function$;
create trigger events_drop_shift_on_calendar_change after update of calendar_source_id on public.events
  for each row execute function public.drop_shift_when_event_leaves_babysitter_calendar();

create or replace function public.validate_family_babysitter_settings()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.babysitter_calendar_source_id is not null and not exists (
    select 1 from public.calendar_sources s where s.id = new.babysitter_calendar_source_id and s.family_id = new.id
  ) then raise exception 'Babysitter calendar must belong to this household'; end if;
  if new.default_babysitter_family_user_id is not null and not exists (
    select 1 from public.babysitter_access_profiles p where p.family_user_id = new.default_babysitter_family_user_id and p.family_id = new.id
  ) then raise exception 'Default babysitter must be a caregiver in this household'; end if;
  return new;
end $function$;
create trigger families_validate_babysitter_settings before insert or update of babysitter_calendar_source_id, default_babysitter_family_user_id on public.families
  for each row execute function public.validate_family_babysitter_settings();

-- Recurring shifts unlock their whole series span coarsely at row level; the app then
-- narrows to the exact dates each assigned shift occurs. Other/None never unlock.
create or replace function public.can_read_event(_family_id uuid, _event_id uuid, _source_id uuid, _start timestamp with time zone, _end timestamp with time zone, _recurrence text)
 returns boolean language plpgsql stable security definer set search_path to 'public'
as $function$
declare fu_id uuid; scope public.babysitter_date_scope; tz text; t_until date; t_end_day date;
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
  select coalesce(timezone, 'UTC') into tz from public.families where id = _family_id;
  if _recurrence is not null then
    select recurrence_until into t_until from public.events where id = _event_id;
    t_end_day := coalesce(t_until, 'infinity'::date);
  else
    t_end_day := (greatest(_start, _end - interval '1 microsecond') at time zone tz)::date;
  end if;
  return exists (
    select 1 from public.babysitter_shifts s join public.events e on e.id = s.event_id
    where s.family_user_id = fu_id and s.assignment = 'caregiver'
      and (e.start_at at time zone tz)::date <= t_end_day
      and (case when e.recurrence_rule is not null
             then coalesce(e.recurrence_until + 1, 'infinity'::date)
             else (greatest(e.start_at, e.end_at - interval '1 microsecond') at time zone tz)::date end)
          >= (_start at time zone tz)::date
  );
end $function$;