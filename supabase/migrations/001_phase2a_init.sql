-- DENIO RADAR — Phase 2A Idempotent Non-Destructive Migration
-- Target: Supabase PostgreSQL 15+
-- Safe to re-run: preserves all existing rows, never drops tables or truncates data.

create extension if not exists "pgcrypto" with schema extensions;

-- 1. Idempotent ENUM types
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'source_type_enum' and n.nspname = 'public'
  ) then
    create type public.source_type_enum as enum (
      'website',
      'rss_feed',
      'public_portal',
      'social_reference',
      'newsletter_archive'
    );
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'discovery_method_enum' and n.nspname = 'public'
  ) then
    create type public.discovery_method_enum as enum (
      'search_engine',
      'rss_autodiscovery',
      'manual_registration'
    );
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'monitoring_method_enum' and n.nspname = 'public'
  ) then
    create type public.monitoring_method_enum as enum (
      'polling',
      'rss_feed',
      'search_discovery'
    );
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'priority_level_enum' and n.nspname = 'public'
  ) then
    create type public.priority_level_enum as enum (
      'critical',
      'high',
      'medium',
      'low'
    );
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'source_status_enum' and n.nspname = 'public'
  ) then
    create type public.source_status_enum as enum (
      'active',
      'paused',
      'error',
      'pending_connector'
    );
  end if;
end
$$;

-- 2. Tables
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,
  source_type public.source_type_enum not null,
  discovery_method public.discovery_method_enum not null,
  monitoring_method public.monitoring_method_enum not null,
  category text not null,
  priority public.priority_level_enum not null default 'medium',
  status public.source_status_enum not null default 'active',
  polling_interval_minutes integer not null default 60 check (polling_interval_minutes >= 5),
  last_checked_at timestamptz,
  last_successful_check_at timestamptz,
  last_error text,
  content_fingerprint text,
  data_origin text not null default 'user_created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discovery_keywords (
  id uuid primary key default gen_random_uuid(),
  phrase text not null unique,
  category text not null,
  region text not null default 'Global',
  enabled boolean not null default true,
  matches_found integer not null default 0,
  last_run_at timestamptz,
  data_origin text not null default 'user_created',
  created_at timestamptz not null default now()
);

create table if not exists public.discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  suggested_name text not null,
  url text not null unique,
  organizer text not null,
  detected_type public.source_type_enum not null,
  discovery_method public.discovery_method_enum not null,
  matched_keyword text not null,
  category text not null,
  confidence_note text not null default '',
  status text not null default 'candidate' check (status in ('candidate', 'promoted', 'dismissed')),
  promoted_source_id uuid references public.sources(id) on delete set null,
  data_origin text not null default 'user_created',
  discovered_at timestamptz not null default now()
);

create table if not exists public.monitoring_jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_id uuid references public.sources(id) on delete set null,
  source_name text not null default 'Global Discovery Pool',
  monitoring_method public.monitoring_method_enum not null,
  interval_minutes integer not null check (interval_minutes >= 5),
  dedup_strategy text not null default 'url_and_fingerprint' check (dedup_strategy in ('url_and_fingerprint', 'feed_guid', 'timestamp_delta')),
  status text not null default 'scheduled' check (status in ('scheduled', 'running', 'paused', 'blocked_no_connector', 'failed')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  items_detected integer not null default 0,
  duplicates_skipped integer not null default 0,
  last_error text,
  data_origin text not null default 'user_created',
  created_at timestamptz not null default now()
);

create table if not exists public.discovered_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources(id) on delete set null,
  source_name text not null,
  title text not null,
  organizer text not null,
  competition_url text not null,
  category text not null,
  discovery_method public.discovery_method_enum not null,
  fingerprint_hash text not null unique,
  deadline_date text,
  prize_pool text,
  review_status text not null default 'new' check (review_status in ('new', 'verified', 'archived')),
  data_origin text not null default 'user_created',
  discovered_at timestamptz not null default now()
);

create table if not exists public.system_logs (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz not null default now(),
  level text not null check (level in ('info', 'warn', 'error')),
  module text not null,
  message text not null,
  details text
);

create table if not exists public.engine_settings (
  id integer primary key default 1 check (id = 1),
  default_polling_interval_minutes integer not null default 60 check (default_polling_interval_minutes >= 5),
  default_dedup_strategy text not null default 'url_and_fingerprint' check (default_dedup_strategy in ('url_and_fingerprint', 'feed_guid', 'timestamp_delta')),
  max_concurrent_jobs integer not null default 4 check (max_concurrent_jobs >= 1 and max_concurrent_jobs <= 32),
  auto_promote_verified_rss boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Non-destructive column sync if Phase 1 schema existed earlier
alter table public.sources add column if not exists content_fingerprint text;
alter table public.sources add column if not exists data_origin text not null default 'user_created';
alter table public.discovery_keywords add column if not exists last_run_at timestamptz;
alter table public.discovery_keywords add column if not exists data_origin text not null default 'user_created';
alter table public.monitoring_jobs add column if not exists source_name text not null default 'Global Discovery Pool';
alter table public.monitoring_jobs add column if not exists data_origin text not null default 'user_created';
alter table public.discovered_items add column if not exists data_origin text not null default 'user_created';

-- Ensure singleton default settings row exists without overwriting existing settings
insert into public.engine_settings (id)
values (1)
on conflict (id) do nothing;

-- 3. Indexes
create index if not exists idx_sources_status on public.sources(status);
create index if not exists idx_sources_monitoring_method on public.sources(monitoring_method);
create index if not exists idx_discovery_candidates_status on public.discovery_candidates(status);
create index if not exists idx_monitoring_jobs_status on public.monitoring_jobs(status);
create index if not exists idx_monitoring_jobs_source_id on public.monitoring_jobs(source_id);
create index if not exists idx_discovered_items_fingerprint on public.discovered_items(fingerprint_hash);
create index if not exists idx_discovered_items_review_status on public.discovered_items(review_status);
create index if not exists idx_discovered_items_discovered_at on public.discovered_items(discovered_at desc);
create index if not exists idx_system_logs_timestamp on public.system_logs(timestamp desc);

-- 4. Updated-at triggers
create or replace function public.denio_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_sources_updated_at') then
    create trigger trg_sources_updated_at
    before update on public.sources
    for each row execute function public.denio_set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_engine_settings_updated_at') then
    create trigger trg_engine_settings_updated_at
    before update on public.engine_settings
    for each row execute function public.denio_set_updated_at();
  end if;
end
$$;

-- 5. Row Level Security (RLS) & Privileges
-- Backend connects using service_role (bypasses RLS by default and retains full grants).
-- Public anon role has zero access to operational tables.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

do $$
declare
  tbl text;
  tables text[] := array[
    'sources',
    'discovery_keywords',
    'discovery_candidates',
    'monitoring_jobs',
    'discovered_items',
    'system_logs',
    'engine_settings'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table public.%I enable row level security;', tbl);
    execute format('revoke all on table public.%I from anon;', tbl);
    execute format('grant all on table public.%I to service_role;', tbl);

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl and policyname = tbl || '_service_role_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true);',
        tbl || '_service_role_all',
        tbl
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl and policyname = tbl || '_authenticated_admin_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using ((auth.jwt() ->> ''role'') = ''admin'' or (auth.jwt() -> ''app_metadata'' ->> ''role'') = ''admin'') with check ((auth.jwt() ->> ''role'') = ''admin'' or (auth.jwt() -> ''app_metadata'' ->> ''role'') = ''admin'');',
        tbl || '_authenticated_admin_all',
        tbl
      );
    end if;
  end loop;
end
$$;
