create or replace function public.accept_household_invitation(_invitation_id uuid, _user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv record; fu_id uuid; m record;
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
    if inv.is_babysitter then
      select id, family_id, role, active, removed_at into m
      from public.family_members where id = inv.babysitter_family_member_id for update;
      if m.id is null or m.family_id <> inv.family_id or m.role <> 'caregiver'
         or m.active is not true or m.removed_at is not null
         or exists (select 1 from public.family_users where family_member_id = m.id and family_id = inv.family_id) then
        raise exception 'This invitation is no longer valid. Ask the household owner to send a new one.';
      end if;
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

create or replace function public.revoke_caregiver_invites_on_termination()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update public.family_invitations set status = 'revoked', updated_at = now()
    where babysitter_family_member_id = old.id and status = 'pending';
    return old;
  end if;
  if (new.active is not true and old.active is true)
     or (new.removed_at is not null and old.removed_at is null) then
    update public.family_invitations set status = 'revoked', updated_at = now()
    where babysitter_family_member_id = new.id and status = 'pending';
  end if;
  return new;
end $$;
revoke execute on function public.revoke_caregiver_invites_on_termination() from public, anon, authenticated;

drop trigger if exists revoke_caregiver_invites_on_termination on public.family_members;
create trigger revoke_caregiver_invites_on_termination
before update of active, removed_at or delete on public.family_members
for each row execute function public.revoke_caregiver_invites_on_termination();