-- DENIO RADAR — Supabase PostgreSQL Schema (Phase 2A + Phase 2B.1 Production Blueprint)
-- Target: Supabase PostgreSQL 15+
-- Aligned with 001_phase2a_init.sql + audited 002_phase2b1_discovery_quality.sql (idempotent & non-destructive).

create extension if not exists "pgcrypto" with schema extensions;

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
      'newsletter_archive',
      'static_document'
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

alter type public.source_type_enum add value if not exists 'static_document';

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

create table if not exists public.discovery_raw_batches (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'tavily',
  model_used text,
  status text not null default 'search_completed'
    check (status in ('search_completed', 'classifying', 'completed', 'classification_failed')),
  keywords_json jsonb not null default '[]'::jsonb,
  raw_results_json jsonb not null default '[]'::jsonb,
  total_raw_hits integer not null default 0,
  retry_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  discovered_at timestamptz not null default now(),
  classification text,
  confidence_score integer,
  candidate_kind text not null default 'unknown',
  temporal_status text not null default 'unknown',
  registration_open_date text,
  registration_deadline text,
  competition_start_date text,
  competition_end_date text,
  event_year integer,
  temporal_evidence text,
  temporal_confidence integer,
  target_audience text not null default 'unknown',
  audience_compatible boolean default null,
  audience_note text,
  is_monitorable boolean not null default false,
  is_recurring_source boolean not null default false,
  monitoring_eligibility text not null default 'unknown',
  monitoring_block_reason text,
  crawlability_status text not null default 'unknown',
  crawlability_http_status integer,
  crawlability_details text,
  source_domain text,
  recommended_monitoring_url text,
  duplicate_status text not null default 'unknown',
  duplicate_of_candidate_id uuid,
  duplicate_reason text,
  raw_batch_id uuid
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

alter table public.sources add column if not exists content_fingerprint text;
alter table public.sources add column if not exists data_origin text not null default 'user_created';
alter table public.discovery_keywords add column if not exists last_run_at timestamptz;
alter table public.discovery_keywords add column if not exists data_origin text not null default 'user_created';
alter table public.monitoring_jobs add column if not exists source_name text not null default 'Global Discovery Pool';
alter table public.monitoring_jobs add column if not exists data_origin text not null default 'user_created';
alter table public.discovered_items add column if not exists data_origin text not null default 'user_created';

alter table public.discovery_candidates add column if not exists classification text;
alter table public.discovery_candidates add column if not exists confidence_score integer;
alter table public.discovery_candidates add column if not exists candidate_kind text not null default 'unknown';
alter table public.discovery_candidates add column if not exists temporal_status text not null default 'unknown';
alter table public.discovery_candidates add column if not exists registration_open_date text;
alter table public.discovery_candidates add column if not exists registration_deadline text;
alter table public.discovery_candidates add column if not exists competition_start_date text;
alter table public.discovery_candidates add column if not exists competition_end_date text;
alter table public.discovery_candidates add column if not exists event_year integer;
alter table public.discovery_candidates add column if not exists temporal_evidence text;
alter table public.discovery_candidates add column if not exists temporal_confidence integer;
alter table public.discovery_candidates add column if not exists target_audience text not null default 'unknown';
alter table public.discovery_candidates add column if not exists audience_compatible boolean default null;
alter table public.discovery_candidates add column if not exists audience_note text;
alter table public.discovery_candidates add column if not exists is_monitorable boolean not null default false;
alter table public.discovery_candidates add column if not exists is_recurring_source boolean not null default false;
alter table public.discovery_candidates add column if not exists monitoring_eligibility text not null default 'unknown';
alter table public.discovery_candidates add column if not exists monitoring_block_reason text;
alter table public.discovery_candidates add column if not exists crawlability_status text not null default 'unknown';
alter table public.discovery_candidates add column if not exists crawlability_http_status integer;
alter table public.discovery_candidates add column if not exists crawlability_details text;
alter table public.discovery_candidates add column if not exists source_domain text;
alter table public.discovery_candidates add column if not exists recommended_monitoring_url text;
alter table public.discovery_candidates add column if not exists duplicate_status text not null default 'unknown';
alter table public.discovery_candidates add column if not exists duplicate_of_candidate_id uuid;
alter table public.discovery_candidates add column if not exists duplicate_reason text;
alter table public.discovery_candidates add column if not exists raw_batch_id uuid;

do $$
declare
  v_kind_default text;
  v_dup_default text;
  v_aud_nullable text;
  v_aud_default text;
begin
  select column_default into v_kind_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'discovery_candidates' and column_name = 'candidate_kind';

  if v_kind_default is not null and v_kind_default ilike '%''event''%' then
    alter table public.discovery_candidates alter column candidate_kind set default 'unknown';
  end if;

  select column_default into v_dup_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'discovery_candidates' and column_name = 'duplicate_status';

  if v_dup_default is not null and v_dup_default ilike '%''unique''%' then
    alter table public.discovery_candidates alter column duplicate_status set default 'unknown';
  end if;

  select is_nullable, column_default into v_aud_nullable, v_aud_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'discovery_candidates' and column_name = 'audience_compatible';

  if v_aud_nullable = 'NO' then
    alter table public.discovery_candidates alter column audience_compatible drop not null;
  end if;
  if v_aud_default is not null and v_aud_default ilike '%true%' then
    alter table public.discovery_candidates alter column audience_compatible set default null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_discovery_candidates_classification'
      and conrelid = 'public.discovery_candidates'::regclass
  ) then
    alter table public.discovery_candidates
      add constraint chk_discovery_candidates_classification
      check (
        classification is null
        or classification in ('Competition', 'Organizer', 'University', 'Aggregator', 'Community', 'Irrelevant')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_discovery_candidates_kind'
      and conrelid = 'public.discovery_candidates'::regclass
  ) then
    alter table public.discovery_candidates
      add constraint chk_discovery_candidates_kind
      check (candidate_kind in ('event', 'source', 'unknown')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_discovery_candidates_temporal_status'
      and conrelid = 'public.discovery_candidates'::regclass
  ) then
    alter table public.discovery_candidates
      add constraint chk_discovery_candidates_temporal_status
      check (temporal_status in ('open', 'upcoming', 'closed', 'completed', 'archived', 'unknown')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_discovery_candidates_target_audience'
      and conrelid = 'public.discovery_candidates'::regclass
  ) then
    alter table public.discovery_candidates
      add constraint chk_discovery_candidates_target_audience
      check (
        target_audience in (
          'elementary_school',
          'junior_high_school',
          'senior_high_school',
          'university_student',
          'general_public',
          'professional',
          'mixed',
          'unknown'
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_discovery_candidates_monitoring_eligibility'
      and conrelid = 'public.discovery_candidates'::regclass
  ) then
    alter table public.discovery_candidates
      add constraint chk_discovery_candidates_monitoring_eligibility
      check (monitoring_eligibility in ('eligible', 'conditional', 'ineligible', 'unknown')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_discovery_candidates_crawlability_status'
      and conrelid = 'public.discovery_candidates'::regclass
  ) then
    alter table public.discovery_candidates
      add constraint chk_discovery_candidates_crawlability_status
      check (
        crawlability_status in (
          'accessible',
          'redirect',
          'login_wall',
          'forbidden_403',
          'not_found_404',
          'rate_limited_429',
          'cloudflare_challenge',
          'captcha_blocked',
          'timeout',
          'empty_html_shell',
          'static_pdf',
          'social_single_post',
          'http_error',
          'unknown'
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_discovery_candidates_duplicate_status'
      and conrelid = 'public.discovery_candidates'::regclass
  ) then
    alter table public.discovery_candidates
      add constraint chk_discovery_candidates_duplicate_status
      check (duplicate_status in ('unique', 'possible_duplicate', 'confirmed_duplicate', 'unknown')) not valid;
  end if;
end
$$;

insert into public.engine_settings (id)
values (1)
on conflict (id) do nothing;

create index if not exists idx_sources_status on public.sources(status);
create index if not exists idx_sources_monitoring_method on public.sources(monitoring_method);
create index if not exists idx_discovery_candidates_status on public.discovery_candidates(status);
create index if not exists idx_discovery_candidates_kind on public.discovery_candidates(candidate_kind);
create index if not exists idx_discovery_candidates_temporal on public.discovery_candidates(temporal_status);
create index if not exists idx_discovery_candidates_eligibility on public.discovery_candidates(monitoring_eligibility);
create index if not exists idx_discovery_candidates_domain on public.discovery_candidates(source_domain);
create index if not exists idx_discovery_candidates_dup_status on public.discovery_candidates(duplicate_status);
create index if not exists idx_discovery_candidates_raw_batch_id on public.discovery_candidates(raw_batch_id);
create index if not exists idx_discovery_candidates_audience_compat on public.discovery_candidates(audience_compatible);
create index if not exists idx_discovery_raw_batches_status on public.discovery_raw_batches(status);
create index if not exists idx_discovery_raw_batches_created on public.discovery_raw_batches(created_at desc);
create index if not exists idx_monitoring_jobs_status on public.monitoring_jobs(status);
create index if not exists idx_monitoring_jobs_source_id on public.monitoring_jobs(source_id);
create index if not exists idx_discovered_items_fingerprint on public.discovered_items(fingerprint_hash);
create index if not exists idx_discovered_items_review_status on public.discovered_items(review_status);
create index if not exists idx_discovered_items_discovered_at on public.discovered_items(discovered_at desc);
create index if not exists idx_system_logs_timestamp on public.system_logs(timestamp desc);

create or replace function public.denio_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_sources_updated_at'
      and tgrelid = 'public.sources'::regclass
      and not tgisinternal
  ) then
    create trigger trg_sources_updated_at
    before update on public.sources
    for each row execute function public.denio_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_engine_settings_updated_at'
      and tgrelid = 'public.engine_settings'::regclass
      and not tgisinternal
  ) then
    create trigger trg_engine_settings_updated_at
    before update on public.engine_settings
    for each row execute function public.denio_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_discovery_raw_batches_updated_at'
      and tgrelid = 'public.discovery_raw_batches'::regclass
      and not tgisinternal
  ) then
    create trigger trg_discovery_raw_batches_updated_at
    before update on public.discovery_raw_batches
    for each row execute function public.denio_set_updated_at();
  end if;
end
$$;

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
    'discovery_raw_batches',
    'monitoring_jobs',
    'discovered_items',
    'system_logs',
    'engine_settings'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table public.%I enable row level security;', tbl);
    execute format('revoke all on table public.%I from public;', tbl);
    execute format('revoke all on table public.%I from anon;', tbl);
    execute format('grant all on table public.%I to service_role;', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated;', tbl);

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
        'create policy %I on public.%I for all to authenticated using (((select auth.jwt()) ->> ''role'') = ''admin'' or (((select auth.jwt()) -> ''app_metadata'') ->> ''role'') = ''admin'') with check (((select auth.jwt()) ->> ''role'') = ''admin'' or (((select auth.jwt()) -> ''app_metadata'') ->> ''role'') = ''admin'');',
        tbl || '_authenticated_admin_all',
        tbl
      );
    end if;
  end loop;
end
$$;
