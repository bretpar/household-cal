create table if not exists public.scheduler_credentials (
  name text primary key,
  token text not null,
  updated_at timestamptz not null default now()
);
grant all on public.scheduler_credentials to service_role;
alter table public.scheduler_credentials enable row level security;

create table if not exists public.scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('ok','failed')),
  detail text,
  ran_at timestamptz not null default now()
);
create index if not exists scheduler_runs_job_ran_at_idx on public.scheduler_runs (job_name, ran_at desc);
grant all on public.scheduler_runs to service_role;
alter table public.scheduler_runs enable row level security;

insert into public.scheduler_credentials (name, token)
values ('scheduler', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do update set token = encode(extensions.gen_random_bytes(32), 'hex'), updated_at = now();

drop function if exists public.verify_scheduler_token(text);