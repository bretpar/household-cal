
create type public.babysitter_date_scope as enum ('all_permitted','shift_days_only');

create table public.babysitter_access_profiles (
  family_user_id uuid primary key references public.family_users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  date_scope public.babysitter_date_scope not null default 'shift_days_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.babysitter_access_profiles to authenticated;
grant all on public.babysitter_access_profiles to service_role;
alter table public.babysitter_access_profiles enable row level security;

create table public.babysitter_access_calendars (
  family_user_id uuid not null references public.babysitter_access_profiles(family_user_id) on delete cascade,
  calendar_source_id uuid not null references public.calendar_sources(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (family_user_id, calendar_source_id)
);
grant select, insert, update, delete on public.babysitter_access_calendars to authenticated;
grant all on public.babysitter_access_calendars to service_role;
alter table public.babysitter_access_calendars enable row level security;

create table public.babysitter_shifts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  family_user_id uuid not null references public.babysitter_access_profiles(family_user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, family_user_id)
);
create index babysitter_shifts_user_idx on public.babysitter_shifts(family_user_id);
grant select, insert, update, delete on public.babysitter_shifts to authenticated;
grant all on public.babysitter_shifts to service_role;
alter table public.babysitter_shifts enable row level security;

create trigger babysitter_access_profiles_updated_at before update on public.babysitter_access_profiles
for each row execute function public.update_updated_at_column();

-- Integrity: profile only on a viewer membership of the same household, linked to a family member
create or replace function public.assert_babysitter_profile_valid() returns trigger
language plpgsql security definer set search_path = public as $$
declare fu record;
begin
  select family_id, role, family_member_id into fu from public.family_users where id = new.family_user_id;
  if fu is null or fu.family_id <> new.family_id then raise exception 'Membership does not belong to this household'; end if;
  if fu.role <> 'viewer' then raise exception 'Only viewers can be babysitters'; end if;
  if fu.family_member_id is null then raise exception 'Link this person to a family member first'; end if;
  return new;
end $$;
create trigger babysitter_profile_valid before insert or update on public.babysitter_access_profiles
for each row execute function public.assert_babysitter_profile_valid();

create or replace function public.assert_babysitter_calendar_valid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.babysitter_access_profiles p join public.calendar_sources c on c.family_id = p.family_id
    where p.family_user_id = new.family_user_id and c.id = new.calendar_source_id
  ) then raise exception 'Calendar does not belong to this household'; end if;
  return new;
end $$;
create trigger babysitter_calendar_valid before insert or update on public.babysitter_access_calendars
for each row execute function public.assert_babysitter_calendar_valid();

create or replace function public.assert_babysitter_shift_valid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.events e where e.id = new.event_id and e.family_id = new.family_id)
     or not exists (select 1 from public.babysitter_access_profiles p where p.family_user_id = new.family_user_id and p.family_id = new.family_id)
  then raise exception 'Shift must reference an event and babysitter in the same household'; end if;
  return new;
end $$;
create trigger babysitter_shift_valid before insert or update on public.babysitter_shifts
for each row execute function public.assert_babysitter_shift_valid();

-- Leaving viewer role (or unlinking the member) drops the babysitter profile
create or replace function public.drop_babysitter_profile_on_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role <> 'viewer' or new.family_member_id is null then
    delete from public.babysitter_access_profiles where family_user_id = new.id;
  end if;
  return new;
end $$;
create trigger family_users_babysitter_cleanup after update of role, family_member_id on public.family_users
for each row execute function public.drop_babysitter_profile_on_role_change();

-- Helpers
create or replace function public.babysitter_membership(_family_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select fu.id from public.family_users fu
  join public.babysitter_access_profiles p on p.family_user_id = fu.id
  where fu.family_id = _family_id and fu.user_id = auth.uid() and fu.role = 'viewer'
  limit 1;
$$;

create or replace function public.is_babysitter(_family_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.babysitter_membership(_family_id) is not null;
$$;

create or replace function public.can_read_calendar_source(_family_id uuid, _source_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_family_access(_family_id) and (
    not public.is_babysitter(_family_id)
    or exists (select 1 from public.babysitter_access_calendars c
               where c.family_user_id = public.babysitter_membership(_family_id)
                 and c.calendar_source_id = _source_id)
  );
$$;

create or replace function public.can_read_event(
  _family_id uuid, _event_id uuid, _source_id uuid,
  _start timestamptz, _end timestamptz, _recurrence text
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare fu_id uuid; scope public.babysitter_date_scope; tz text;
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
  if exists (select 1 from public.babysitter_shifts s where s.family_user_id = fu_id and s.event_id = _event_id) then
    return true;
  end if;
  -- Recurring series cannot be matched per occurrence here; only the shift itself is visible.
  if _recurrence is not null then return false; end if;
  select coalesce(timezone, 'UTC') into tz from public.families where id = _family_id;
  return exists (
    select 1 from public.babysitter_shifts s join public.events e on e.id = s.event_id
    where s.family_user_id = fu_id
      and (e.start_at at time zone tz)::date <= (greatest(_start, _end - interval '1 microsecond') at time zone tz)::date
      and (greatest(e.start_at, e.end_at - interval '1 microsecond') at time zone tz)::date >= (_start at time zone tz)::date
  );
end $$;

-- Policies on new tables
create policy bap_select on public.babysitter_access_profiles for select to authenticated
  using (public.is_family_owner(family_id) or family_user_id = public.babysitter_membership(family_id));
create policy bap_write_owner on public.babysitter_access_profiles for all to authenticated
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy bac_select on public.babysitter_access_calendars for select to authenticated
  using (exists (select 1 from public.babysitter_access_profiles p where p.family_user_id = babysitter_access_calendars.family_user_id
    and (public.is_family_owner(p.family_id) or p.family_user_id = public.babysitter_membership(p.family_id))));
create policy bac_write_owner on public.babysitter_access_calendars for all to authenticated
  using (exists (select 1 from public.babysitter_access_profiles p where p.family_user_id = babysitter_access_calendars.family_user_id and public.is_family_owner(p.family_id)))
  with check (exists (select 1 from public.babysitter_access_profiles p where p.family_user_id = babysitter_access_calendars.family_user_id and public.is_family_owner(p.family_id)));

create policy bs_select on public.babysitter_shifts for select to authenticated
  using (public.can_edit_family(family_id) or family_user_id = public.babysitter_membership(family_id));
create policy bs_write_editors on public.babysitter_shifts for all to authenticated
  using (public.can_edit_family(family_id)) with check (public.can_edit_family(family_id));

-- Restrict existing read policies for babysitters (unchanged for everyone else)
drop policy calendar_sources_select on public.calendar_sources;
create policy calendar_sources_select on public.calendar_sources for select to authenticated
  using (public.can_read_calendar_source(family_id, id));

drop policy events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (public.can_read_event(family_id, id, calendar_source_id, start_at, end_at, recurrence_rule));

drop policy event_members_select on public.event_members;
create policy event_members_select on public.event_members for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_members.event_id
    and public.can_read_event(e.family_id, e.id, e.calendar_source_id, e.start_at, e.end_at, e.recurrence_rule)));

drop policy activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated
  using (public.has_family_access(family_id) and not public.is_babysitter(family_id));

drop policy activity_members_select on public.activity_members;
create policy activity_members_select on public.activity_members for select to authenticated
  using (exists (select 1 from public.activities a where a.id = activity_members.activity_id
    and public.has_family_access(a.family_id) and not public.is_babysitter(a.family_id)));

drop policy google_connections_select on public.google_connections;
create policy google_connections_select on public.google_connections for select to authenticated
  using (public.has_family_access(family_id) and not public.is_babysitter(family_id));

drop policy family_users_select on public.family_users;
create policy family_users_select on public.family_users for select to authenticated
  using (user_id = auth.uid() or (public.has_family_access(family_id) and not public.is_babysitter(family_id)));
