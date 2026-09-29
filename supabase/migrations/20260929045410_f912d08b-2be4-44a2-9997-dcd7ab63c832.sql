alter table public.family_invitations
  add column is_babysitter boolean not null default false,
  add column babysitter_family_member_id uuid references public.family_members(id) on delete set null,
  add column babysitter_date_scope public.babysitter_date_scope,
  add column babysitter_calendar_ids uuid[] not null default '{}';

create or replace function public.assert_invitation_babysitter_valid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.is_babysitter then
    new.babysitter_family_member_id := null;
    new.babysitter_date_scope := null;
    new.babysitter_calendar_ids := '{}';
    return new;
  end if;
  if new.role <> 'viewer' then raise exception 'Babysitter invitations must use the viewer role'; end if;
  if new.babysitter_family_member_id is null or not exists (
    select 1 from public.family_members m where m.id = new.babysitter_family_member_id and m.family_id = new.family_id
  ) then raise exception 'Choose which family member this babysitter is'; end if;
  if new.babysitter_date_scope is null then new.babysitter_date_scope := 'shift_days_only'; end if;
  if exists (
    select 1 from unnest(new.babysitter_calendar_ids) cid
    where not exists (select 1 from public.calendar_sources c where c.id = cid and c.family_id = new.family_id)
  ) then raise exception 'Calendar does not belong to this household'; end if;
  return new;
end $$;
revoke execute on function public.assert_invitation_babysitter_valid() from public, anon, authenticated;
create trigger family_invitations_babysitter_valid before insert or update on public.family_invitations
for each row execute function public.assert_invitation_babysitter_valid();

-- Atomic acceptance: membership + babysitter restrictions commit together or not at all.
create or replace function public.accept_household_invitation(_invitation_id uuid, _user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv record; fu_id uuid;
begin
  select * into inv from public.family_invitations where id = _invitation_id for update;
  if inv is null then raise exception 'This invitation link is not valid'; end if;
  if inv.status = 'revoked' then raise exception 'This invitation was revoked'; end if;

  select id into fu_id from public.family_users where family_id = inv.family_id and user_id = _user_id;
  if fu_id is null then
    if inv.status <> 'pending' then raise exception 'This invitation is no longer active'; end if;
    if inv.is_babysitter and inv.babysitter_family_member_id is null then
      raise exception 'This babysitter invitation is incomplete. Ask the owner to send a new one.';
    end if;
    insert into public.family_users (family_id, user_id, role, family_member_id)
    values (inv.family_id, _user_id, inv.role,
            case when inv.is_babysitter then inv.babysitter_family_member_id else null end)
    returning id into fu_id;
    if inv.is_babysitter then
      insert into public.babysitter_access_profiles (family_user_id, family_id, date_scope)
      values (fu_id, inv.family_id, coalesce(inv.babysitter_date_scope, 'shift_days_only'));
      insert into public.babysitter_access_calendars (family_user_id, calendar_source_id)
      select fu_id, c.id from public.calendar_sources c
      where c.family_id = inv.family_id and c.id = any(inv.babysitter_calendar_ids);
    end if;
  end if;

  if inv.status = 'pending' then
    update public.family_invitations set status = 'accepted', accepted_at = now(), accepted_by = _user_id
    where id = inv.id;
  end if;
  return jsonb_build_object('family_id', inv.family_id, 'role', inv.role);
end $$;
revoke execute on function public.accept_household_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_household_invitation(uuid, uuid) to service_role;