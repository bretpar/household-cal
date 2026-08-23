-- ============================== enums ==============================
create type public.family_role as enum ('owner','editor','viewer');
create type public.member_role as enum ('parent','child','caregiver','other');
create type public.member_access as enum ('full','view_only');
create type public.event_type as enum ('school','activity','work','childcare','appointment','family','other');
create type public.calendar_display_mode as enum ('events','coverage_background');
create type public.calendar_provider as enum ('local','google');

-- ============================== shared helpers ==============================
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ============================== profiles ==============================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at_column();

-- ============================== families ==============================
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.families to authenticated;
grant all on public.families to service_role;
alter table public.families enable row level security;
create trigger families_updated_at before update on public.families
  for each row execute function public.update_updated_at_column();

create table public.family_users (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.family_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, user_id)
);
create index family_users_user_idx on public.family_users(user_id);
create index family_users_family_idx on public.family_users(family_id);
grant select, insert, update, delete on public.family_users to authenticated;
grant all on public.family_users to service_role;
alter table public.family_users enable row level security;
create trigger family_users_updated_at before update on public.family_users
  for each row execute function public.update_updated_at_column();

-- ============================== authorization helpers ==============================
create or replace function public.family_role_of(_family_id uuid)
returns public.family_role language sql stable security definer set search_path = public as $$
  select role from public.family_users where family_id = _family_id and user_id = auth.uid();
$$;

create or replace function public.has_family_access(_family_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.family_users where family_id = _family_id and user_id = auth.uid());
$$;

create or replace function public.can_edit_family(_family_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_users
    where family_id = _family_id and user_id = auth.uid() and role in ('owner','editor')
  );
$$;

create or replace function public.is_family_owner(_family_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_users
    where family_id = _family_id and user_id = auth.uid() and role = 'owner'
  );
$$;

-- families / family_users policies (defined after helpers)
create policy "families_select_members" on public.families for select to authenticated
  using (public.has_family_access(id));
create policy "families_insert_own" on public.families for insert to authenticated
  with check (created_by = auth.uid());
create policy "families_update_owner" on public.families for update to authenticated
  using (public.is_family_owner(id)) with check (public.is_family_owner(id));
create policy "families_delete_owner" on public.families for delete to authenticated
  using (public.is_family_owner(id));

create policy "family_users_select" on public.family_users for select to authenticated
  using (user_id = auth.uid() or public.has_family_access(family_id));
create policy "family_users_insert_owner" on public.family_users for insert to authenticated
  with check (public.is_family_owner(family_id));
create policy "family_users_update_owner" on public.family_users for update to authenticated
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));
create policy "family_users_delete_owner" on public.family_users for delete to authenticated
  using (public.is_family_owner(family_id));

-- ============================== family members ==============================
create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  initial text not null,
  color text not null default 'sky',
  role public.member_role not null default 'other',
  access public.member_access not null default 'view_only',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index family_members_family_idx on public.family_members(family_id);
grant select, insert, update, delete on public.family_members to authenticated;
grant all on public.family_members to service_role;
alter table public.family_members enable row level security;
create policy "family_members_select" on public.family_members for select to authenticated
  using (public.has_family_access(family_id));
create policy "family_members_write_owner" on public.family_members for all to authenticated
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));
create trigger family_members_updated_at before update on public.family_members
  for each row execute function public.update_updated_at_column();

-- ============================== calendar sources ==============================
create table public.calendar_sources (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  provider public.calendar_provider not null default 'local',
  external_calendar_id text,
  display_mode public.calendar_display_mode not null default 'events',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calendar_sources_family_idx on public.calendar_sources(family_id);
grant select, insert, update, delete on public.calendar_sources to authenticated;
grant all on public.calendar_sources to service_role;
alter table public.calendar_sources enable row level security;
create policy "calendar_sources_select" on public.calendar_sources for select to authenticated
  using (public.has_family_access(family_id));
create policy "calendar_sources_write_owner" on public.calendar_sources for all to authenticated
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));
create trigger calendar_sources_updated_at before update on public.calendar_sources
  for each row execute function public.update_updated_at_column();

-- ============================== events ==============================
create table public.events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  calendar_source_id uuid references public.calendar_sources(id) on delete set null,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  location text,
  notes text,
  event_type public.event_type not null default 'other',
  recurrence_rule text,
  recurrence_until date,
  excluded_dates date[] not null default '{}',
  external_event_id text,
  external_recurring_event_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_family_idx on public.events(family_id);
create index events_source_idx on public.events(calendar_source_id);
grant select, insert, update, delete on public.events to authenticated;
grant all on public.events to service_role;
alter table public.events enable row level security;
create policy "events_select" on public.events for select to authenticated
  using (public.has_family_access(family_id));
create policy "events_write_editors" on public.events for all to authenticated
  using (public.can_edit_family(family_id)) with check (public.can_edit_family(family_id));
create trigger events_updated_at before update on public.events
  for each row execute function public.update_updated_at_column();

create table public.event_members (
  event_id uuid not null references public.events(id) on delete cascade,
  family_member_id uuid not null references public.family_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, family_member_id)
);
create index event_members_member_idx on public.event_members(family_member_id);
grant select, insert, update, delete on public.event_members to authenticated;
grant all on public.event_members to service_role;
alter table public.event_members enable row level security;
create policy "event_members_select" on public.event_members for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.has_family_access(e.family_id)));
create policy "event_members_write" on public.event_members for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.can_edit_family(e.family_id)))
  with check (exists (select 1 from public.events e where e.id = event_id and public.can_edit_family(e.family_id)));

-- keep event <-> member assignments inside one household
create or replace function public.assert_event_member_same_family()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ev_family uuid;
  mem_family uuid;
begin
  select family_id into ev_family from public.events where id = new.event_id;
  select family_id into mem_family from public.family_members where id = new.family_member_id;
  if ev_family is null or mem_family is null or ev_family <> mem_family then
    raise exception 'family member and event must belong to the same family';
  end if;
  return new;
end; $$;
create trigger event_members_same_family before insert or update on public.event_members
  for each row execute function public.assert_event_member_same_family();

-- ============================== activities ==============================
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  event_type public.event_type not null default 'activity',
  location text,
  schedule_label text,
  recurrence_rule text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index activities_family_idx on public.activities(family_id);
grant select, insert, update, delete on public.activities to authenticated;
grant all on public.activities to service_role;
alter table public.activities enable row level security;
create policy "activities_select" on public.activities for select to authenticated
  using (public.has_family_access(family_id));
create policy "activities_write_editors" on public.activities for all to authenticated
  using (public.can_edit_family(family_id)) with check (public.can_edit_family(family_id));
create trigger activities_updated_at before update on public.activities
  for each row execute function public.update_updated_at_column();

create table public.activity_members (
  activity_id uuid not null references public.activities(id) on delete cascade,
  family_member_id uuid not null references public.family_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, family_member_id)
);
grant select, insert, update, delete on public.activity_members to authenticated;
grant all on public.activity_members to service_role;
alter table public.activity_members enable row level security;
create policy "activity_members_select" on public.activity_members for select to authenticated
  using (exists (select 1 from public.activities a where a.id = activity_id and public.has_family_access(a.family_id)));
create policy "activity_members_write" on public.activity_members for all to authenticated
  using (exists (select 1 from public.activities a where a.id = activity_id and public.can_edit_family(a.family_id)))
  with check (exists (select 1 from public.activities a where a.id = activity_id and public.can_edit_family(a.family_id)));

create or replace function public.assert_activity_member_same_family()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  act_family uuid;
  mem_family uuid;
begin
  select family_id into act_family from public.activities where id = new.activity_id;
  select family_id into mem_family from public.family_members where id = new.family_member_id;
  if act_family is null or mem_family is null or act_family <> mem_family then
    raise exception 'family member and activity must belong to the same family';
  end if;
  return new;
end; $$;
create trigger activity_members_same_family before insert or update on public.activity_members
  for each row execute function public.assert_activity_member_same_family();

-- ============================== google connections (future sync) ==============================
create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  connected_by uuid references auth.users(id) on delete set null,
  account_email text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, account_email)
);
grant select, insert, update, delete on public.google_connections to authenticated;
grant all on public.google_connections to service_role;
alter table public.google_connections enable row level security;
create policy "google_connections_select" on public.google_connections for select to authenticated
  using (public.has_family_access(family_id));
create policy "google_connections_write_owner" on public.google_connections for all to authenticated
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));
create trigger google_connections_updated_at before update on public.google_connections
  for each row execute function public.update_updated_at_column();

-- ============================== seed: two unclaimed test households ==============================
do $seed$
declare
  fam uuid;
  cal_events uuid;
  cal_coverage uuid;
  mon date := (date_trunc('week', now()))::date;
  m_d uuid; m_m uuid; m_b uuid; m_e uuid; m_j uuid;
  ev uuid;
  t_fam uuid; t_cal uuid; t_a uuid; t_b uuid; t_ev uuid;
begin
  -- ---------- Parker Family (primary test household) ----------
  insert into public.families (name) values ('Parker Family') returning id into fam;

  insert into public.calendar_sources (family_id, name, provider, display_mode, sort_order)
    values (fam, 'Parker Family', 'local', 'events', 0) returning id into cal_events;
  insert into public.calendar_sources (family_id, name, provider, display_mode, sort_order)
    values (fam, 'Babysitter', 'local', 'coverage_background', 1) returning id into cal_coverage;

  insert into public.family_members (family_id, name, initial, color, role, access, sort_order)
    values (fam, 'Dad', 'D', 'sky', 'parent', 'full', 0) returning id into m_d;
  insert into public.family_members (family_id, name, initial, color, role, access, sort_order)
    values (fam, 'Mom', 'M', 'rose', 'parent', 'full', 1) returning id into m_m;
  insert into public.family_members (family_id, name, initial, color, role, access, sort_order)
    values (fam, 'Bailey', 'B', 'amber', 'child', 'view_only', 2) returning id into m_b;
  insert into public.family_members (family_id, name, initial, color, role, access, sort_order)
    values (fam, 'Ellison', 'E', 'sage', 'child', 'view_only', 3) returning id into m_e;
  insert into public.family_members (family_id, name, initial, color, role, access, sort_order)
    values (fam, 'Jack', 'J', 'teal', 'child', 'view_only', 4) returning id into m_j;

  -- School (Mon-Fri, backdated 6 weeks so earlier weeks look populated)
  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, recurrence_rule)
    values (fam, cal_events, 'School', (mon - 42) + time '08:00', (mon - 42) + time '15:00', false,
            'Maplewood Elementary', 'Regular school day', 'school', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    returning id into ev;
  insert into public.event_members (event_id, family_member_id) values (ev, m_b), (ev, m_e), (ev, m_j);

  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, recurrence_rule)
    values (fam, cal_events, 'Soccer Practice', (mon - 41) + time '16:30', (mon - 41) + time '17:30', false,
            'Riverside Fields', 'Bring water bottle + shin guards', 'activity', 'FREQ=WEEKLY;BYDAY=TU')
    returning id into ev;
  insert into public.event_members (event_id, family_member_id) values (ev, m_j);

  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, recurrence_rule)
    values (fam, cal_events, 'Dance', (mon - 40) + time '16:00', (mon - 40) + time '17:00', false,
            'Studio 12', 'Recital prep', 'activity', 'FREQ=WEEKLY;BYDAY=WE')
    returning id into ev;
  insert into public.event_members (event_id, family_member_id) values (ev, m_e);

  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, recurrence_rule)
    values (fam, cal_events, 'Dentist Appointment', mon + 3 + time '15:30', mon + 3 + time '16:30', false,
            'Bright Smiles Pediatric Dentistry', '6-month cleaning', 'appointment', null)
    returning id into ev;
  insert into public.event_members (event_id, family_member_id) values (ev, m_b);

  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, recurrence_rule)
    values (fam, cal_events, 'Family Dinner', (mon - 36) + time '17:30', (mon - 36) + time '19:00', false,
            'Home', 'Sunday pasta night', 'family', 'FREQ=WEEKLY;BYDAY=SU')
    returning id into ev;
  insert into public.event_members (event_id, family_member_id) values (ev, m_d), (ev, m_m), (ev, m_b), (ev, m_e), (ev, m_j);

  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, location, event_type, recurrence_rule)
    values (fam, cal_events, 'Dad Work', (mon - 42) + time '09:00', (mon - 42) + time '17:00', false,
            'Downtown office', 'work', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    returning id into ev;
  insert into public.event_members (event_id, family_member_id) values (ev, m_d);

  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, location, event_type, recurrence_rule)
    values (fam, cal_events, 'Mom Work', (mon - 42) + time '08:30', (mon - 42) + time '16:00', false,
            'Clinic', 'work', 'FREQ=WEEKLY;BYDAY=MO,WE,TH,FR')
    returning id into ev;
  insert into public.event_members (event_id, family_member_id) values (ev, m_m);

  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, notes, event_type, recurrence_rule)
    values (fam, cal_events, 'Teacher In-Service — No School', mon + 4 + time '00:00', mon + 4 + time '23:59', true,
            'Plan childcare', 'school', null)
    returning id into ev;
  insert into public.event_members (event_id, family_member_id) values (ev, m_b), (ev, m_e), (ev, m_j);

  -- babysitter coverage (renders as background layer because of display_mode)
  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, recurrence_rule)
    values (fam, cal_coverage, 'Babysitter', (mon - 41) + time '08:00', (mon - 41) + time '17:00', false,
            'Home', 'Maya', 'childcare', 'FREQ=WEEKLY;BYDAY=TU,TH');
  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, recurrence_rule)
    values (fam, cal_coverage, 'Babysitter', mon + 4 + time '12:00', mon + 4 + time '18:00', false,
            'Home', 'Maya — in-service day', 'childcare', null);
  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, recurrence_rule)
    values (fam, cal_coverage, 'Babysitter', (mon - 37) + time '17:00', (mon - 37) + time '22:00', false,
            'Home', 'Date night', 'childcare', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA');

  -- activities
  insert into public.activities (family_id, name, event_type, location, schedule_label, recurrence_rule)
    values (fam, 'Jack Soccer', 'activity', 'Riverside Fields', 'Tuesdays · 4:30–5:30 PM', 'FREQ=WEEKLY;BYDAY=TU')
    returning id into ev;
  insert into public.activity_members (activity_id, family_member_id) values (ev, m_j);
  insert into public.activities (family_id, name, event_type, location, schedule_label, recurrence_rule)
    values (fam, 'Ellison Dance', 'activity', 'Studio 12', 'Wednesdays · 4:00–5:00 PM', 'FREQ=WEEKLY;BYDAY=WE')
    returning id into ev;
  insert into public.activity_members (activity_id, family_member_id) values (ev, m_e);
  insert into public.activities (family_id, name, event_type, location, schedule_label, recurrence_rule)
    values (fam, 'School', 'school', 'Maplewood Elementary', 'Mon–Fri · 8:00 AM–3:00 PM', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    returning id into ev;
  insert into public.activity_members (activity_id, family_member_id) values (ev, m_b), (ev, m_e), (ev, m_j);

  -- ---------- Test Family (isolation check household) ----------
  insert into public.families (name) values ('Test Family') returning id into t_fam;
  insert into public.calendar_sources (family_id, name, provider, display_mode)
    values (t_fam, 'Test Household', 'local', 'events') returning id into t_cal;
  insert into public.family_members (family_id, name, initial, color, role, access, sort_order)
    values (t_fam, 'Alex', 'A', 'lilac', 'parent', 'full', 0) returning id into t_a;
  insert into public.family_members (family_id, name, initial, color, role, access, sort_order)
    values (t_fam, 'Nina', 'N', 'coral', 'child', 'view_only', 1) returning id into t_b;
  insert into public.events (family_id, calendar_source_id, title, start_at, end_at, event_type)
    values (t_fam, t_cal, 'Swim Lessons', mon + 2 + time '17:00', mon + 2 + time '18:00', 'activity')
    returning id into t_ev;
  insert into public.event_members (event_id, family_member_id) values (t_ev, t_b);
  insert into public.activities (family_id, name, event_type, location, schedule_label, recurrence_rule)
    values (t_fam, 'Nina Swim', 'activity', 'Community Pool', 'Wednesdays · 5:00–6:00 PM', 'FREQ=WEEKLY;BYDAY=WE')
    returning id into t_ev;
  insert into public.activity_members (activity_id, family_member_id) values (t_ev, t_b);
end $seed$;
