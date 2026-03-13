create extension if not exists pgcrypto;

create table if not exists public.evm_address (
  id bigint generated always as identity primary key,
  wallet_index int not null unique,
  address text not null unique,
  remark text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sol_address (
  id bigint generated always as identity primary key,
  wallet_index int not null unique,
  address text not null unique,
  remark text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  task_date date not null,
  sort_order int not null,
  task_time time,
  url text not null,
  campaign_id text,
  sequence_values jsonb not null default '[]'::jsonb,
  need_create smallint not null default 3,
  remark text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_date, url),
  check (need_create in (1, 2, 3)),
  check (jsonb_typeof(sequence_values) = 'array')
);

create index if not exists idx_tasks_date_order on public.tasks (task_date, sort_order);
create index if not exists idx_tasks_campaign_id on public.tasks (campaign_id);
