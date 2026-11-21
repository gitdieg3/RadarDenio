-- DENIO RADAR — Phase 2B.1 Idempotent Non-Destructive Migration (Final Audited Revision)
-- Target: Supabase PostgreSQL 15+
-- Safe to re-run: preserves all existing rows, never drops tables, columns, or constraints, and never truncates data.
-- Note: Keep ALTER TYPE ... ADD VALUE as a top-level statement (outside DO/EXCEPTION blocks)
--       and do not reference 'static_document' in DEFAULT/DML inside the same uncommitted transaction.

-- 1. Extend public.source_type_enum with 'static_document'
alter type public.source_type_enum add value if not exists 'static_document';

-- 2. Ensure updated_at trigger helper exists with immutable search_path
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

-- 3. Create discovery_raw_batches table to persist Tavily results BEFORE Gemini classification
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

-- 4. Extend public.discovery_candidates with Phase 2B.1 structured quality & metadata columns
-- Notes:
--   * candidate_kind defaults to 'unknown' so legacy Phase 2B rows are not misclassified as single events.
--   * duplicate_status defaults to 'unknown' so legacy rows are not falsely marked as deduplicated ('unique').
--   * audience_compatible is nullable (default NULL) so legacy rows with unknown audience are neither assumed true nor marked mismatch (false).
--   * duplicate_of_candidate_id is a soft uuid (no FK to discovery_candidates) because Level B source_domain dedup can reference sources.id.
--   * raw_batch_id is a soft uuid to tolerate batch IDs generated before migration.
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

-- 5. Safely reconcile column defaults/nullability if partial columns existed from an earlier migration attempt
-- (Never drops constraints or modifies existing row values)
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

-- 6. Idempotent CHECK constraints aligned 1:1 with union types in src/types/radar.ts
-- Added as NOT VALID so any pre-existing partial/legacy rows never block migration while all new writes are enforced.
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

-- 7. Indexes
create index if not exists idx_discovery_candidates_kind on public.discovery_candidates(candidate_kind);
create index if not exists idx_discovery_candidates_temporal on public.discovery_candidates(temporal_status);
create index if not exists idx_discovery_candidates_eligibility on public.discovery_candidates(monitoring_eligibility);
create index if not exists idx_discovery_candidates_domain on public.discovery_candidates(source_domain);
create index if not exists idx_discovery_candidates_dup_status on public.discovery_candidates(duplicate_status);
create index if not exists idx_discovery_candidates_raw_batch_id on public.discovery_candidates(raw_batch_id);
create index if not exists idx_discovery_candidates_audience_compat on public.discovery_candidates(audience_compatible);
create index if not exists idx_discovery_raw_batches_status on public.discovery_raw_batches(status);
create index if not exists idx_discovery_raw_batches_created on public.discovery_raw_batches(created_at desc);

-- 8. Updated-at trigger for discovery_raw_batches
do $$
begin
  if not exists (
    select 1
    from pg_trigger
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

-- 9. Row Level Security (RLS), schema/table grants, and policies on discovery_raw_batches
alter table public.discovery_raw_batches enable row level security;

revoke all on table public.discovery_raw_batches from public;
revoke all on table public.discovery_raw_batches from anon;

grant usage on schema public to service_role;
grant all on table public.discovery_raw_batches to service_role;
grant select, insert, update, delete on table public.discovery_raw_batches to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'discovery_raw_batches'
      and policyname = 'discovery_raw_batches_service_role_all'
  ) then
    create policy discovery_raw_batches_service_role_all
      on public.discovery_raw_batches
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'discovery_raw_batches'
      and policyname = 'discovery_raw_batches_authenticated_admin_all'
  ) then
    create policy discovery_raw_batches_authenticated_admin_all
      on public.discovery_raw_batches
      for all
      to authenticated
      using (
        ((select auth.jwt()) ->> 'role') = 'admin'
        or (((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin'
      )
      with check (
        ((select auth.jwt()) ->> 'role') = 'admin'
        or (((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin'
      );
  end if;
end
$$;
