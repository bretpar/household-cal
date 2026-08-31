-- One randomly generated scheduler token, stored encrypted in Vault.
do $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'scheduler_token';
  if existing is null then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'scheduler_token',
      'Shared token used by scheduled jobs to authenticate to app cron endpoints'
    );
  end if;
end $$;

-- Boolean-only verifier. Never returns the stored secret.
create or replace function public.verify_scheduler_token(_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
declare
  stored text;
begin
  if _token is null or length(_token) = 0 then
    return false;
  end if;
  select decrypted_secret into stored
    from vault.decrypted_secrets
   where name = 'scheduler_token'
   limit 1;
  if stored is null then
    return false;
  end if;
  -- constant-time-ish comparison on digests
  return encode(extensions.digest(_token, 'sha256'), 'hex')
       = encode(extensions.digest(stored, 'sha256'), 'hex');
end $$;

revoke all on function public.verify_scheduler_token(text) from public;
revoke all on function public.verify_scheduler_token(text) from anon;
revoke all on function public.verify_scheduler_token(text) from authenticated;
grant execute on function public.verify_scheduler_token(text) to service_role;