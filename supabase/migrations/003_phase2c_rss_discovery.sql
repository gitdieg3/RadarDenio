-- DENIO RADAR — Phase 2C.1 Final Hardened Idempotent Migration (RSS/Atom Discovery Engine)
-- Target: Supabase PostgreSQL 15+
-- Guarantees:
--   * Non-destructive: no DROP, TRUNCATE, DELETE, or enum mutations.
--   * Preserves all Phase 2A/2B/2B.1 rows and tables untouched (except additive nullable discovery_candidates.rss_feed_id).
--   * Never fabricates mandatory column defaults/values; halts with descriptive RAISE EXCEPTION on unsafe existing state.
--   * Validates Primary Keys, Foreign Keys (including differently-named existing FKs), and pg_get_constraintdef() definitions.
--   * Reports NOT VALID constraint status via pg_constraint.convalidated and legacy non-conforming row counts without altering data.

-- ============================================================================
-- 0. Pre-flight Validation of Phase 2A Parent Tables (sources & discovery_candidates)
-- ============================================================================
do $$
declare
  v_sources_id_type text;
  v_sources_id_attnum int2;
  v_sources_has_uk boolean;
  v_cand_id_type text;
  v_cand_id_attnum int2;
  v_cand_has_uk boolean;
begin
  if to_regclass('public.sources') is null then
    raise exception 'Phase 2C.1 aborted: parent table public.sources does not exist. Run Phase 2A migration first.';
  end if;

  select a.attnum, format_type(a.atttypid, a.atttypmod)
  into v_sources_id_attnum, v_sources_id_type
  from pg_attribute a
  where a.attrelid = 'public.sources'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if v_sources_id_attnum is null or v_sources_id_type <> 'uuid' then
    raise exception 'Phase 2C.1 aborted: public.sources.id must exist with type uuid (found: %).', coalesce(v_sources_id_type, 'MISSING');
  end if;

  select exists(
    select 1 from pg_constraint c
    where c.conrelid = 'public.sources'::regclass
      and c.contype in ('p', 'u')
      and c.conkey = array[v_sources_id_attnum]
  ) into v_sources_has_uk;

  if not v_sources_has_uk then
    raise exception 'Phase 2C.1 aborted: public.sources.id lacks a PRIMARY KEY or single-column UNIQUE constraint required for foreign keys.';
  end if;

  if to_regclass('public.discovery_candidates') is null then
    raise exception 'Phase 2C.1 aborted: parent table public.discovery_candidates does not exist. Run Phase 2A migration first.';
  end if;

  select a.attnum, format_type(a.atttypid, a.atttypmod)
  into v_cand_id_attnum, v_cand_id_type
  from pg_attribute a
  where a.attrelid = 'public.discovery_candidates'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if v_cand_id_attnum is null or v_cand_id_type <> 'uuid' then
    raise exception 'Phase 2C.1 aborted: public.discovery_candidates.id must exist with type uuid (found: %).', coalesce(v_cand_id_type, 'MISSING');
  end if;

  select exists(
    select 1 from pg_constraint c
    where c.conrelid = 'public.discovery_candidates'::regclass
      and c.contype in ('p', 'u')
      and c.conkey = array[v_cand_id_attnum]
  ) into v_cand_has_uk;

  if not v_cand_has_uk then
    raise exception 'Phase 2C.1 aborted: public.discovery_candidates.id lacks a PRIMARY KEY or single-column UNIQUE constraint required for foreign keys.';
  end if;
end
$$;

-- ============================================================================
-- 1. Trigger Helper (compatible with Phase 2A/2B.1; immutable search_path)
-- ============================================================================
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

-- ============================================================================
-- 2. RSS/Atom Feed Registry (`public.rss_feeds`)
-- ============================================================================
create table if not exists public.rss_feeds (
  id uuid primary key default gen_random_uuid(),
  source_id uuid,
  feed_name text not null,
  feed_url text not null,
  parent_site_url text,
  source_domain text,
  feed_format text not null default 'unknown',
  discovery_origin text not null default 'manual',
  category text not null default 'General Competitions',
  status text not null default 'pending_verification',
  verified boolean not null default false,
  fetch_interval_minutes integer not null default 60,
  etag text,
  last_modified text,
  last_content_hash text,
  last_http_status integer,
  last_attempted_at timestamptz,
  last_successful_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  items_discovered_total integer not null default 0,
  last_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Operational & nullable column sync (safe defaults only for optional/counter columns)
alter table public.rss_feeds add column if not exists source_id uuid;
alter table public.rss_feeds add column if not exists parent_site_url text;
alter table public.rss_feeds add column if not exists source_domain text;
alter table public.rss_feeds add column if not exists feed_format text not null default 'unknown';
alter table public.rss_feeds add column if not exists discovery_origin text not null default 'manual';
alter table public.rss_feeds add column if not exists category text not null default 'General Competitions';
alter table public.rss_feeds add column if not exists status text not null default 'pending_verification';
alter table public.rss_feeds add column if not exists verified boolean not null default false;
alter table public.rss_feeds add column if not exists fetch_interval_minutes integer not null default 60;
alter table public.rss_feeds add column if not exists etag text;
alter table public.rss_feeds add column if not exists last_modified text;
alter table public.rss_feeds add column if not exists last_content_hash text;
alter table public.rss_feeds add column if not exists last_http_status integer;
alter table public.rss_feeds add column if not exists last_attempted_at timestamptz;
alter table public.rss_feeds add column if not exists last_successful_at timestamptz;
alter table public.rss_feeds add column if not exists last_error text;
alter table public.rss_feeds add column if not exists consecutive_failures integer not null default 0;
alter table public.rss_feeds add column if not exists items_discovered_total integer not null default 0;
alter table public.rss_feeds add column if not exists last_batch_id uuid;
alter table public.rss_feeds add column if not exists created_at timestamptz not null default now();
alter table public.rss_feeds add column if not exists updated_at timestamptz not null default now();

-- Validate PK (id uuid) and mandatory columns (feed_name, feed_url) on `public.rss_feeds`
do $$
declare
  v_has_rows boolean;
  v_type text;
  v_nullable text;
  v_bad_count bigint;
  v_id_attnum int2;
  v_pk_name text;
  v_pk_cols int2[];
  v_has_dups boolean;
begin
  select exists(select 1 from public.rss_feeds) into v_has_rows;

  -- id column
  select a.attnum, format_type(a.atttypid, a.atttypmod)
  into v_id_attnum, v_type
  from pg_attribute a
  where a.attrelid = 'public.rss_feeds'::regclass and a.attname = 'id' and not a.attisdropped;

  if v_id_attnum is null then
    if v_has_rows then
      raise exception 'Phase 2C.1 aborted: existing non-empty public.rss_feeds is missing mandatory column "id".';
    end if;
    alter table public.rss_feeds add column id uuid default gen_random_uuid();
    select a.attnum into v_id_attnum
    from pg_attribute a
    where a.attrelid = 'public.rss_feeds'::regclass and a.attname = 'id' and not a.attisdropped;
  elsif v_type <> 'uuid' then
    raise exception 'Phase 2C.1 aborted: public.rss_feeds.id must be uuid (found: %).', v_type;
  end if;

  -- Verify PRIMARY KEY is strictly on (id)
  select c.conname, c.conkey into v_pk_name, v_pk_cols
  from pg_constraint c
  where c.conrelid = 'public.rss_feeds'::regclass and c.contype = 'p';

  if v_pk_name is not null then
    if v_pk_cols <> array[v_id_attnum] then
      raise exception 'Phase 2C.1 aborted: public.rss_feeds already has PRIMARY KEY "%" on non-id column(s).', v_pk_name;
    end if;
  else
    select count(*) into v_bad_count from public.rss_feeds where id is null;
    if v_bad_count > 0 then
      raise exception 'Phase 2C.1 aborted: public.rss_feeds.id has % NULL values; cannot safely add PRIMARY KEY.', v_bad_count;
    end if;
    select exists(select 1 from public.rss_feeds group by id having count(*) > 1) into v_has_dups;
    if v_has_dups then
      raise exception 'Phase 2C.1 aborted: public.rss_feeds.id contains duplicate UUIDs; cannot safely add PRIMARY KEY.';
    end if;
    alter table public.rss_feeds add constraint rss_feeds_pkey primary key (id);
  end if;

  -- source_id type check
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_feeds' and column_name = 'source_id';
  if v_type <> 'uuid' then
    raise exception 'Phase 2C.1 aborted: public.rss_feeds.source_id must be uuid (found: %).', v_type;
  end if;

  -- feed_name
  select data_type, is_nullable into v_type, v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_feeds' and column_name = 'feed_name';
  if v_type is null then
    if v_has_rows then
      raise exception 'Phase 2C.1 aborted: existing non-empty public.rss_feeds is missing mandatory column "feed_name" (cannot fabricate default).';
    end if;
    alter table public.rss_feeds add column feed_name text not null;
  elsif v_type not in ('text', 'character varying') then
    raise exception 'Phase 2C.1 aborted: public.rss_feeds.feed_name must be text/varchar (found: %).', v_type;
  elsif v_nullable = 'YES' then
    select count(*) into v_bad_count from public.rss_feeds where feed_name is null;
    if v_bad_count > 0 then
      raise exception 'Phase 2C.1 aborted: public.rss_feeds has % rows with NULL feed_name.', v_bad_count;
    end if;
    alter table public.rss_feeds alter column feed_name set not null;
  end if;

  -- feed_url
  select data_type, is_nullable into v_type, v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_feeds' and column_name = 'feed_url';
  if v_type is null then
    if v_has_rows then
      raise exception 'Phase 2C.1 aborted: existing non-empty public.rss_feeds is missing mandatory column "feed_url" (cannot fabricate default).';
    end if;
    alter table public.rss_feeds add column feed_url text not null;
  elsif v_type not in ('text', 'character varying') then
    raise exception 'Phase 2C.1 aborted: public.rss_feeds.feed_url must be text/varchar (found: %).', v_type;
  elsif v_nullable = 'YES' then
    select count(*) into v_bad_count from public.rss_feeds where feed_url is null;
    if v_bad_count > 0 then
      raise exception 'Phase 2C.1 aborted: public.rss_feeds has % rows with NULL feed_url.', v_bad_count;
    end if;
    alter table public.rss_feeds alter column feed_url set not null;
  end if;

  -- Verify data types of remaining constrained/typed columns on existing rss_feeds
  for v_type, v_nullable in
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'rss_feeds'
      and column_name in ('feed_format', 'discovery_origin', 'status')
  loop
    if v_nullable not in ('text', 'character varying') then
      raise exception 'Phase 2C.1 aborted: public.rss_feeds.% must be text/varchar (found: %).', v_type, v_nullable;
    end if;
  end loop;

  for v_type, v_nullable in
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'rss_feeds'
      and column_name in ('fetch_interval_minutes', 'consecutive_failures', 'items_discovered_total')
  loop
    if v_nullable not in ('integer', 'smallint', 'bigint') then
      raise exception 'Phase 2C.1 aborted: public.rss_feeds.% must be integer (found: %).', v_type, v_nullable;
    end if;
  end loop;
end
$$;

-- ============================================================================
-- 3. RSS/Atom Fetch Logs (`public.rss_fetch_logs`)
-- ============================================================================
create table if not exists public.rss_fetch_logs (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null,
  raw_batch_id uuid,
  status text not null,
  http_status integer,
  duration_ms integer,
  items_found integer not null default 0,
  new_items integer not null default 0,
  duplicate_items integer not null default 0,
  changed_items integer not null default 0,
  candidates_saved integer not null default 0,
  error_message text,
  fetched_at timestamptz not null default now()
);

alter table public.rss_fetch_logs add column if not exists raw_batch_id uuid;
alter table public.rss_fetch_logs add column if not exists http_status integer;
alter table public.rss_fetch_logs add column if not exists duration_ms integer;
alter table public.rss_fetch_logs add column if not exists items_found integer not null default 0;
alter table public.rss_fetch_logs add column if not exists new_items integer not null default 0;
alter table public.rss_fetch_logs add column if not exists duplicate_items integer not null default 0;
alter table public.rss_fetch_logs add column if not exists changed_items integer not null default 0;
alter table public.rss_fetch_logs add column if not exists candidates_saved integer not null default 0;
alter table public.rss_fetch_logs add column if not exists error_message text;
alter table public.rss_fetch_logs add column if not exists fetched_at timestamptz not null default now();

-- Validate PK (id uuid) and mandatory columns (feed_id, status) on `public.rss_fetch_logs`
do $$
declare
  v_has_rows boolean;
  v_type text;
  v_nullable text;
  v_bad_count bigint;
  v_id_attnum int2;
  v_pk_name text;
  v_pk_cols int2[];
  v_has_dups boolean;
begin
  select exists(select 1 from public.rss_fetch_logs) into v_has_rows;

  -- id column
  select a.attnum, format_type(a.atttypid, a.atttypmod)
  into v_id_attnum, v_type
  from pg_attribute a
  where a.attrelid = 'public.rss_fetch_logs'::regclass and a.attname = 'id' and not a.attisdropped;

  if v_id_attnum is null then
    if v_has_rows then
      raise exception 'Phase 2C.1 aborted: existing non-empty public.rss_fetch_logs is missing mandatory column "id".';
    end if;
    alter table public.rss_fetch_logs add column id uuid default gen_random_uuid();
    select a.attnum into v_id_attnum
    from pg_attribute a
    where a.attrelid = 'public.rss_fetch_logs'::regclass and a.attname = 'id' and not a.attisdropped;
  elsif v_type <> 'uuid' then
    raise exception 'Phase 2C.1 aborted: public.rss_fetch_logs.id must be uuid (found: %).', v_type;
  end if;

  -- Verify PRIMARY KEY is strictly on (id)
  select c.conname, c.conkey into v_pk_name, v_pk_cols
  from pg_constraint c
  where c.conrelid = 'public.rss_fetch_logs'::regclass and c.contype = 'p';

  if v_pk_name is not null then
    if v_pk_cols <> array[v_id_attnum] then
      raise exception 'Phase 2C.1 aborted: public.rss_fetch_logs already has PRIMARY KEY "%" on non-id column(s).', v_pk_name;
    end if;
  else
    select count(*) into v_bad_count from public.rss_fetch_logs where id is null;
    if v_bad_count > 0 then
      raise exception 'Phase 2C.1 aborted: public.rss_fetch_logs.id has % NULL values; cannot safely add PRIMARY KEY.', v_bad_count;
    end if;
    select exists(select 1 from public.rss_fetch_logs group by id having count(*) > 1) into v_has_dups;
    if v_has_dups then
      raise exception 'Phase 2C.1 aborted: public.rss_fetch_logs.id contains duplicate UUIDs; cannot safely add PRIMARY KEY.';
    end if;
    alter table public.rss_fetch_logs add constraint rss_fetch_logs_pkey primary key (id);
  end if;

  -- feed_id
  select data_type, is_nullable into v_type, v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_fetch_logs' and column_name = 'feed_id';
  if v_type is null then
    if v_has_rows then
      raise exception 'Phase 2C.1 aborted: existing non-empty public.rss_fetch_logs is missing mandatory column "feed_id" (cannot fabricate FK).';
    end if;
    alter table public.rss_fetch_logs add column feed_id uuid not null;
  elsif v_type <> 'uuid' then
    raise exception 'Phase 2C.1 aborted: public.rss_fetch_logs.feed_id must be uuid (found: %).', v_type;
  elsif v_nullable = 'YES' then
    select count(*) into v_bad_count from public.rss_fetch_logs where feed_id is null;
    if v_bad_count > 0 then
      raise exception 'Phase 2C.1 aborted: public.rss_fetch_logs has % rows with NULL feed_id.', v_bad_count;
    end if;
    alter table public.rss_fetch_logs alter column feed_id set not null;
  end if;

  -- status
  select data_type, is_nullable into v_type, v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_fetch_logs' and column_name = 'status';
  if v_type is null then
    if v_has_rows then
      raise exception 'Phase 2C.1 aborted: existing non-empty public.rss_fetch_logs is missing mandatory column "status" (cannot fabricate default).';
    end if;
    alter table public.rss_fetch_logs add column status text not null;
  elsif v_type not in ('text', 'character varying') then
    raise exception 'Phase 2C.1 aborted: public.rss_fetch_logs.status must be text/varchar (found: %).', v_type;
  elsif v_nullable = 'YES' then
    select count(*) into v_bad_count from public.rss_fetch_logs where status is null;
    if v_bad_count > 0 then
      raise exception 'Phase 2C.1 aborted: public.rss_fetch_logs has % rows with NULL status.', v_bad_count;
    end if;
    alter table public.rss_fetch_logs alter column status set not null;
  end if;

  for v_type, v_nullable in
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'rss_fetch_logs'
      and column_name in ('duration_ms', 'items_found', 'new_items', 'duplicate_items', 'changed_items', 'candidates_saved')
  loop
    if v_nullable not in ('integer', 'smallint', 'bigint') then
      raise exception 'Phase 2C.1 aborted: public.rss_fetch_logs.% must be integer (found: %).', v_type, v_nullable;
    end if;
  end loop;
end
$$;

-- ============================================================================
-- 4. RSS/Atom Item Fingerprints (`public.rss_item_fingerprints`)
-- ============================================================================
create table if not exists public.rss_item_fingerprints (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null,
  identity_type text not null,
  item_key text not null,
  normalized_url text,
  item_guid text,
  fallback_fingerprint text,
  content_hash text not null,
  candidate_id uuid,
  item_published_at text,
  change_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rss_item_fingerprints add column if not exists normalized_url text;
alter table public.rss_item_fingerprints add column if not exists item_guid text;
alter table public.rss_item_fingerprints add column if not exists fallback_fingerprint text;
alter table public.rss_item_fingerprints add column if not exists candidate_id uuid;
alter table public.rss_item_fingerprints add column if not exists item_published_at text;
alter table public.rss_item_fingerprints add column if not exists change_count integer not null default 0;
alter table public.rss_item_fingerprints add column if not exists first_seen_at timestamptz not null default now();
alter table public.rss_item_fingerprints add column if not exists last_seen_at timestamptz not null default now();
alter table public.rss_item_fingerprints add column if not exists updated_at timestamptz not null default now();

-- Validate PK (id uuid), mandatory columns (feed_id, content_hash, identity_type, item_key),
-- and safe non-fabricating reconciliation on `public.rss_item_fingerprints`
do $$
declare
  v_has_rows boolean;
  v_type text;
  v_nullable text;
  v_bad_count bigint;
  v_id_attnum int2;
  v_pk_name text;
  v_pk_cols int2[];
  v_has_dups boolean;
begin
  select exists(select 1 from public.rss_item_fingerprints) into v_has_rows;

  -- id column
  select a.attnum, format_type(a.atttypid, a.atttypmod)
  into v_id_attnum, v_type
  from pg_attribute a
  where a.attrelid = 'public.rss_item_fingerprints'::regclass and a.attname = 'id' and not a.attisdropped;

  if v_id_attnum is null then
    if v_has_rows then
      raise exception 'Phase 2C.1 aborted: existing non-empty public.rss_item_fingerprints is missing mandatory column "id".';
    end if;
    alter table public.rss_item_fingerprints add column id uuid default gen_random_uuid();
    select a.attnum into v_id_attnum
    from pg_attribute a
    where a.attrelid = 'public.rss_item_fingerprints'::regclass and a.attname = 'id' and not a.attisdropped;
  elsif v_type <> 'uuid' then
    raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints.id must be uuid (found: %).', v_type;
  end if;

  -- Verify PRIMARY KEY is strictly on (id)
  select c.conname, c.conkey into v_pk_name, v_pk_cols
  from pg_constraint c
  where c.conrelid = 'public.rss_item_fingerprints'::regclass and c.contype = 'p';

  if v_pk_name is not null then
    if v_pk_cols <> array[v_id_attnum] then
      raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints already has PRIMARY KEY "%" on non-id column(s).', v_pk_name;
    end if;
  else
    select count(*) into v_bad_count from public.rss_item_fingerprints where id is null;
    if v_bad_count > 0 then
      raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints.id has % NULL values; cannot safely add PRIMARY KEY.', v_bad_count;
    end if;
    select exists(select 1 from public.rss_item_fingerprints group by id having count(*) > 1) into v_has_dups;
    if v_has_dups then
      raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints.id contains duplicate UUIDs; cannot safely add PRIMARY KEY.';
    end if;
    alter table public.rss_item_fingerprints add constraint rss_item_fingerprints_pkey primary key (id);
  end if;

  -- feed_id
  select data_type, is_nullable into v_type, v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_item_fingerprints' and column_name = 'feed_id';
  if v_type is null then
    if v_has_rows then
      raise exception 'Phase 2C.1 aborted: existing non-empty public.rss_item_fingerprints is missing mandatory column "feed_id" (cannot fabricate FK).';
    end if;
    alter table public.rss_item_fingerprints add column feed_id uuid not null;
  elsif v_type <> 'uuid' then
    raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints.feed_id must be uuid (found: %).', v_type;
  elsif v_nullable = 'YES' then
    select count(*) into v_bad_count from public.rss_item_fingerprints where feed_id is null;
    if v_bad_count > 0 then
      raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints has % rows with NULL feed_id.', v_bad_count;
    end if;
    alter table public.rss_item_fingerprints alter column feed_id set not null;
  end if;

  -- candidate_id type check
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_item_fingerprints' and column_name = 'candidate_id';
  if v_type <> 'uuid' then
    raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints.candidate_id must be uuid (found: %).', v_type;
  end if;

  -- content_hash
  select data_type, is_nullable into v_type, v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_item_fingerprints' and column_name = 'content_hash';
  if v_type is null then
    if v_has_rows then
      raise exception 'Phase 2C.1 aborted: existing non-empty public.rss_item_fingerprints is missing mandatory column "content_hash" (cannot fabricate SHA-256).';
    end if;
    alter table public.rss_item_fingerprints add column content_hash text not null;
  elsif v_type not in ('text', 'character varying') then
    raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints.content_hash must be text/varchar (found: %).', v_type;
  elsif v_nullable = 'YES' then
    select count(*) into v_bad_count from public.rss_item_fingerprints where content_hash is null;
    if v_bad_count > 0 then
      raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints has % rows with NULL content_hash.', v_bad_count;
    end if;
    alter table public.rss_item_fingerprints alter column content_hash set not null;
  end if;

  -- Ensure normalized_url is nullable for GUID-only and fallback_hash items
  select is_nullable into v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_item_fingerprints' and column_name = 'normalized_url';
  if v_nullable = 'NO' then
    alter table public.rss_item_fingerprints alter column normalized_url drop not null;
  end if;

  -- Reconcile identity_type & item_key only when deterministically derivable without fabrication
  alter table public.rss_item_fingerprints add column if not exists identity_type text;
  alter table public.rss_item_fingerprints add column if not exists item_key text;

  for v_type, v_nullable in
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'rss_item_fingerprints'
      and column_name in ('identity_type', 'item_key', 'normalized_url', 'item_guid', 'fallback_fingerprint')
  loop
    if v_nullable not in ('text', 'character varying') then
      raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints.% must be text/varchar (found: %).', v_type, v_nullable;
    end if;
  end loop;

  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_item_fingerprints' and column_name = 'change_count';
  if v_type not in ('integer', 'smallint', 'bigint') then
    raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints.change_count must be integer (found: %).', v_type;
  end if;

  if v_has_rows then
    select count(*) into v_bad_count
    from public.rss_item_fingerprints
    where (identity_type is null or item_key is null)
      and (normalized_url is null or length(btrim(normalized_url)) = 0)
      and (item_guid is null or length(btrim(item_guid)) = 0)
      and (fallback_fingerprint is null or fallback_fingerprint !~ '^[0-9a-f]{64}$');

    if v_bad_count > 0 then
      raise exception 'Phase 2C.1 aborted: % existing rows in public.rss_item_fingerprints lack URL, GUID, and valid 64-hex fallback_fingerprint; cannot derive identity safely without fabricating data.', v_bad_count;
    end if;

    update public.rss_item_fingerprints
    set
      identity_type = case
        when normalized_url is not null and length(btrim(normalized_url)) > 0 then 'url'
        when item_guid is not null and length(btrim(item_guid)) > 0 then 'guid'
        else 'fallback_hash'
      end,
      fallback_fingerprint = case
        when (normalized_url is not null and length(btrim(normalized_url)) > 0)
          or (item_guid is not null and length(btrim(item_guid)) > 0)
        then null
        else fallback_fingerprint
      end,
      item_key = case
        when normalized_url is not null and length(btrim(normalized_url)) > 0 then 'url:' || normalized_url
        when item_guid is not null and length(btrim(item_guid)) > 0 then 'guid:' || item_guid
        else 'fallback:' || fallback_fingerprint
      end
    where identity_type is null or item_key is null;
  end if;

  select is_nullable into v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_item_fingerprints' and column_name = 'identity_type';
  if v_nullable = 'YES' then
    alter table public.rss_item_fingerprints alter column identity_type set not null;
  end if;

  select is_nullable into v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rss_item_fingerprints' and column_name = 'item_key';
  if v_nullable = 'YES' then
    alter table public.rss_item_fingerprints alter column item_key set not null;
  end if;
end
$$;

-- ============================================================================
-- 5. Additive Nullable Column on `public.discovery_candidates`
-- ============================================================================
alter table public.discovery_candidates
  add column if not exists rss_feed_id uuid;

do $$
declare
  v_rss_feed_col_type text;
begin
  select data_type into v_rss_feed_col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'discovery_candidates' and column_name = 'rss_feed_id';

  if v_rss_feed_col_type is distinct from 'uuid' then
    raise exception 'Phase 2C.1 aborted: public.discovery_candidates.rss_feed_id must be uuid (found: %).', coalesce(v_rss_feed_col_type, 'MISSING');
  end if;
end
$$;

-- ============================================================================
-- 6. Explicit Idempotent Foreign Keys (checks differently-named FKs & orphan rows)
-- ============================================================================
do $$
declare
  v_spec record;
  v_child_attnum int2;
  v_parent_attnum int2;
  v_existing_name text;
  v_existing_contype char;
  v_existing_confrelid regclass;
  v_existing_conkey int2[];
  v_existing_confkey int2[];
  v_existing_deltype char;
  v_existing_def text;
  v_orphan_count bigint;
begin
  for v_spec in
    select * from (
      values
        ('public.rss_feeds'::text,             'source_id'::text,    'public.sources'::text,              'id'::text, 'fk_rss_feeds_source'::text,              'n'::char, 'SET NULL'::text),
        ('public.rss_fetch_logs'::text,        'feed_id'::text,      'public.rss_feeds'::text,            'id'::text, 'fk_rss_fetch_logs_feed'::text,           'c'::char, 'CASCADE'::text),
        ('public.rss_item_fingerprints'::text, 'feed_id'::text,      'public.rss_feeds'::text,            'id'::text, 'fk_rss_item_fingerprints_feed'::text,    'c'::char, 'CASCADE'::text),
        ('public.rss_item_fingerprints'::text, 'candidate_id'::text, 'public.discovery_candidates'::text, 'id'::text, 'fk_rss_item_fingerprints_candidate'::text,'n'::char, 'SET NULL'::text),
        ('public.discovery_candidates'::text,  'rss_feed_id'::text,  'public.rss_feeds'::text,            'id'::text, 'fk_discovery_candidates_rss_feed'::text, 'n'::char, 'SET NULL'::text)
    ) as t(child_tbl, child_col, parent_tbl, parent_col, conname, deltype, delsql)
  loop
    select attnum into v_child_attnum
    from pg_attribute
    where attrelid = v_spec.child_tbl::regclass and attname = v_spec.child_col and not attisdropped;

    select attnum into v_parent_attnum
    from pg_attribute
    where attrelid = v_spec.parent_tbl::regclass and attname = v_spec.parent_col and not attisdropped;

    if v_child_attnum is null or v_parent_attnum is null then
      raise exception 'Phase 2C.1 aborted: missing column while verifying FK "%" (%.% -> %.%).',
        v_spec.conname, v_spec.child_tbl, v_spec.child_col, v_spec.parent_tbl, v_spec.parent_col;
    end if;

    -- 1) Check if constraint with expected name already exists
    select c.conname, c.contype, c.confrelid, c.conkey, c.confkey, c.confdeltype, pg_get_constraintdef(c.oid)
    into v_existing_name, v_existing_contype, v_existing_confrelid, v_existing_conkey, v_existing_confkey, v_existing_deltype, v_existing_def
    from pg_constraint c
    where c.conrelid = v_spec.child_tbl::regclass
      and c.conname = v_spec.conname;

    if v_existing_name is not null then
      if v_existing_contype <> 'f'
         or v_existing_confrelid <> v_spec.parent_tbl::regclass
         or v_existing_conkey <> array[v_child_attnum]
         or v_existing_confkey <> array[v_parent_attnum]
         or v_existing_deltype <> v_spec.deltype then
        raise exception 'Phase 2C.1 aborted: existing constraint "%" on % has conflicting definition "%". Expected FOREIGN KEY (%) REFERENCES %(%) ON DELETE %.',
          v_spec.conname, v_spec.child_tbl, v_existing_def, v_spec.child_col, v_spec.parent_tbl, v_spec.parent_col, v_spec.delsql;
      end if;
      continue;
    end if;

    -- 2) Check if another FK already covers the exact same child column under a different name
    select c.conname, c.confrelid, c.conkey, c.confkey, c.confdeltype, pg_get_constraintdef(c.oid)
    into v_existing_name, v_existing_confrelid, v_existing_conkey, v_existing_confkey, v_existing_deltype, v_existing_def
    from pg_constraint c
    where c.conrelid = v_spec.child_tbl::regclass
      and c.contype = 'f'
      and c.conkey = array[v_child_attnum]
    limit 1;

    if v_existing_name is not null then
      if v_existing_confrelid = v_spec.parent_tbl::regclass
         and v_existing_conkey = array[v_child_attnum]
         and v_existing_confkey = array[v_parent_attnum]
         and v_existing_deltype = v_spec.deltype then
        -- Equivalent FK already exists under a different name: keep it without creating a duplicate FK
        continue;
      else
        raise exception 'Phase 2C.1 aborted: % column "%" already has conflicting FK "%" (%). Expected REFERENCES %(%) ON DELETE %.',
          v_spec.child_tbl, v_spec.child_col, v_existing_name, v_existing_def, v_spec.parent_tbl, v_spec.parent_col, v_spec.delsql;
      end if;
    end if;

    -- 3) Verify no orphan references exist before adding FK (never deletes or alters data)
    execute format(
      'select count(*) from %s ch where ch.%I is not null and not exists (select 1 from %s p where p.%I = ch.%I)',
      v_spec.child_tbl, v_spec.child_col, v_spec.parent_tbl, v_spec.parent_col, v_spec.child_col
    ) into v_orphan_count;

    if v_orphan_count > 0 then
      raise exception 'Phase 2C.1 aborted: cannot add FK "%" because % rows in %.% reference missing %.% rows.',
        v_spec.conname, v_orphan_count, v_spec.child_tbl, v_spec.child_col, v_spec.parent_tbl, v_spec.parent_col;
    end if;

    execute format(
      'alter table %s add constraint %I foreign key (%I) references %s(%I) on delete %s;',
      v_spec.child_tbl, v_spec.conname, v_spec.child_col, v_spec.parent_tbl, v_spec.parent_col, v_spec.delsql
    );
  end loop;
end
$$;

-- ============================================================================
-- 7. Idempotent UNIQUE & CHECK Constraints (validates pg_get_constraintdef() on existing names)
-- ============================================================================
do $$
declare
  v_con_oid oid;
  v_contype char;
  v_def text;
  v_norm_def text;
  v_cols text[];
  v_has_dups boolean := false;
  v_invalid_identity_count bigint := 0;
  v_invalid_hash_count bigint := 0;
  v_use_not_valid_identity boolean := false;
  v_use_not_valid_hash boolean := false;
begin
  -- Helper logic inline: normalize pg_get_constraintdef() by lowercasing, stripping trailing NOT VALID,
  -- removing ::text / ::character varying / ::varchar casts, and removing whitespace and parentheses.

  -- 7.1 uq_rss_feeds_feed_url (also detects differently-named equivalent UNIQUE and duplicate feed_url rows)
  select c.oid, c.contype, pg_get_constraintdef(c.oid),
         array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord)
  into v_con_oid, v_contype, v_def, v_cols
  from pg_constraint c
  where c.conrelid = 'public.rss_feeds'::regclass and c.conname = 'uq_rss_feeds_feed_url';
  if v_con_oid is not null then
    if v_contype <> 'u' or v_cols <> array['feed_url'] then
      raise exception 'Phase 2C.1 aborted: constraint "uq_rss_feeds_feed_url" on public.rss_feeds has invalid definition "%". Expected UNIQUE (feed_url).', v_def;
    end if;
  elsif not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.rss_feeds'::regclass
      and c.contype = 'u'
      and array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord) = array['feed_url']
  ) then
    select exists(select 1 from public.rss_feeds group by feed_url having count(*) > 1) into v_has_dups;
    if v_has_dups then
      raise exception 'Phase 2C.1 aborted: public.rss_feeds.feed_url contains duplicate values; cannot safely add UNIQUE constraint without deleting or merging feeds.';
    end if;
    alter table public.rss_feeds add constraint uq_rss_feeds_feed_url unique (feed_url);
  end if;

  -- 7.2 chk_rss_feeds_format
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_feeds'::regclass and c.conname = 'chk_rss_feeds_format';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checkfeed_format=anyarray[''rss2'',''rss1_rdf'',''atom'',''unknown'']' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_feeds_format" on public.rss_feeds has wrong definition "%". Expected CHECK (feed_format in (''rss2'',''rss1_rdf'',''atom'',''unknown'')).', v_def;
    end if;
  else
    alter table public.rss_feeds add constraint chk_rss_feeds_format check (feed_format in ('rss2', 'rss1_rdf', 'atom', 'unknown'));
  end if;

  -- 7.3 chk_rss_feeds_origin
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_feeds'::regclass and c.conname = 'chk_rss_feeds_origin';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checkdiscovery_origin=anyarray[''autodiscovered'',''manual'',''promoted_candidate'']' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_feeds_origin" on public.rss_feeds has wrong definition "%". Expected CHECK (discovery_origin in (''autodiscovered'',''manual'',''promoted_candidate'')).', v_def;
    end if;
  else
    alter table public.rss_feeds add constraint chk_rss_feeds_origin check (discovery_origin in ('autodiscovered', 'manual', 'promoted_candidate'));
  end if;

  -- 7.4 chk_rss_feeds_status
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_feeds'::regclass and c.conname = 'chk_rss_feeds_status';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checkstatus=anyarray[''pending_verification'',''active'',''paused'',''error'']' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_feeds_status" on public.rss_feeds has wrong definition "%". Expected CHECK (status in (''pending_verification'',''active'',''paused'',''error'')).', v_def;
    end if;
  else
    alter table public.rss_feeds add constraint chk_rss_feeds_status check (status in ('pending_verification', 'active', 'paused', 'error'));
  end if;

  -- 7.5 chk_rss_feeds_interval
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_feeds'::regclass and c.conname = 'chk_rss_feeds_interval';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checkfetch_interval_minutes>=5' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_feeds_interval" on public.rss_feeds has wrong definition "%". Expected CHECK (fetch_interval_minutes >= 5).', v_def;
    end if;
  else
    alter table public.rss_feeds add constraint chk_rss_feeds_interval check (fetch_interval_minutes >= 5);
  end if;

  -- 7.6 chk_rss_feeds_counters
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_feeds'::regclass and c.conname = 'chk_rss_feeds_counters';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checkconsecutive_failures>=0anditems_discovered_total>=0' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_feeds_counters" on public.rss_feeds has wrong definition "%". Expected CHECK (consecutive_failures >= 0 and items_discovered_total >= 0).', v_def;
    end if;
  else
    alter table public.rss_feeds add constraint chk_rss_feeds_counters check (consecutive_failures >= 0 and items_discovered_total >= 0);
  end if;

  -- 7.7 chk_rss_fetch_logs_status
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_fetch_logs'::regclass and c.conname = 'chk_rss_fetch_logs_status';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checkstatus=anyarray[''fetched_new'',''not_modified_304'',''no_new_items'',''fetch_failed'',''parse_failed'',''classification_failed'']' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_fetch_logs_status" on public.rss_fetch_logs has wrong definition "%".', v_def;
    end if;
  else
    alter table public.rss_fetch_logs add constraint chk_rss_fetch_logs_status check (
      status in ('fetched_new', 'not_modified_304', 'no_new_items', 'fetch_failed', 'parse_failed', 'classification_failed')
    );
  end if;

  -- 7.8 chk_rss_fetch_logs_counters
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_fetch_logs'::regclass and c.conname = 'chk_rss_fetch_logs_counters';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checkduration_msisnullorduration_ms>=0anditems_found>=0andnew_items>=0andduplicate_items>=0andchanged_items>=0andcandidates_saved>=0' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_fetch_logs_counters" on public.rss_fetch_logs has wrong definition "%".', v_def;
    end if;
  else
    alter table public.rss_fetch_logs add constraint chk_rss_fetch_logs_counters check (
      (duration_ms is null or duration_ms >= 0)
      and items_found >= 0
      and new_items >= 0
      and duplicate_items >= 0
      and changed_items >= 0
      and candidates_saved >= 0
    );
  end if;

  -- 7.9 uq_rss_item_fingerprints_feed_item_key (Authoritative unique identity; supports ON CONFLICT (feed_id, item_key))
  select c.oid, c.contype, pg_get_constraintdef(c.oid),
         array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord)
  into v_con_oid, v_contype, v_def, v_cols
  from pg_constraint c
  where c.conrelid = 'public.rss_item_fingerprints'::regclass and c.conname = 'uq_rss_item_fingerprints_feed_item_key';
  if v_con_oid is not null then
    if v_contype <> 'u' or v_cols <> array['feed_id', 'item_key'] then
      raise exception 'Phase 2C.1 aborted: constraint "uq_rss_item_fingerprints_feed_item_key" on public.rss_item_fingerprints has wrong definition "%". Expected UNIQUE (feed_id, item_key).', v_def;
    end if;
  elsif not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.rss_item_fingerprints'::regclass
      and c.contype = 'u'
      and array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord) = array['feed_id', 'item_key']
  ) then
    select exists(select 1 from public.rss_item_fingerprints group by feed_id, item_key having count(*) > 1) into v_has_dups;
    if v_has_dups then
      raise exception 'Phase 2C.1 aborted: public.rss_item_fingerprints (feed_id, item_key) contains duplicate pairs; cannot safely add UNIQUE constraint without altering existing rows.';
    end if;
    alter table public.rss_item_fingerprints add constraint uq_rss_item_fingerprints_feed_item_key unique (feed_id, item_key);
  end if;

  -- 7.10 chk_rss_item_fingerprints_identity_type
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_item_fingerprints'::regclass and c.conname = 'chk_rss_item_fingerprints_identity_type';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checkidentity_type=anyarray[''url'',''guid'',''fallback_hash'']' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_item_fingerprints_identity_type" on public.rss_item_fingerprints has wrong definition "%".', v_def;
    end if;
  else
    alter table public.rss_item_fingerprints add constraint chk_rss_item_fingerprints_identity_type check (
      identity_type in ('url', 'guid', 'fallback_hash')
    );
  end if;

  -- Check existing rows before adding identity consistency & SHA-256 constraints:
  -- Only use NOT VALID when non-conforming legacy rows exist (so new INSERT/UPDATE are enforced while legacy rows remain untouched & visibly unvalidated).
  select count(*) into v_invalid_identity_count
  from public.rss_item_fingerprints
  where not (
    length(btrim(item_key)) > 0
    and (
      (
        identity_type = 'url'
        and normalized_url is not null
        and length(btrim(normalized_url)) > 0
        and fallback_fingerprint is null
        and (item_guid is null or length(btrim(item_guid)) > 0)
        and item_key = ('url:' || normalized_url)
      )
      or (
        identity_type = 'guid'
        and normalized_url is null
        and item_guid is not null
        and length(btrim(item_guid)) > 0
        and fallback_fingerprint is null
        and item_key = ('guid:' || item_guid)
      )
      or (
        identity_type = 'fallback_hash'
        and normalized_url is null
        and item_guid is null
        and fallback_fingerprint is not null
        and fallback_fingerprint ~ '^[0-9a-f]{64}$'
        and item_key = ('fallback:' || fallback_fingerprint)
      )
    )
  );
  v_use_not_valid_identity := v_invalid_identity_count > 0;

  select count(*) into v_invalid_hash_count
  from public.rss_item_fingerprints
  where content_hash !~ '^[0-9a-f]{64}$';
  v_use_not_valid_hash := v_invalid_hash_count > 0;

  -- 7.11 chk_rss_item_fingerprints_identity_consistency
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_item_fingerprints'::regclass and c.conname = 'chk_rss_item_fingerprints_identity_consistency';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checklengthbtrimitem_key>0andidentity_type=''url''andnormalized_urlisnotnullandlengthbtrimnormalized_url>0andfallback_fingerprintisnullanditem_guidisnullorlengthbtrimitem_guid>0anditem_key=''url:''||normalized_urloridentity_type=''guid''andnormalized_urlisnullanditem_guidisnotnullandlengthbtrimitem_guid>0andfallback_fingerprintisnullanditem_key=''guid:''||item_guidoridentity_type=''fallback_hash''andnormalized_urlisnullanditem_guidisnullandfallback_fingerprintisnotnullandfallback_fingerprint~''^[0-9a-f]{64}$''anditem_key=''fallback:''||fallback_fingerprint' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_item_fingerprints_identity_consistency" on public.rss_item_fingerprints has wrong definition "%".', v_def;
    end if;
  else
    if v_use_not_valid_identity then
      alter table public.rss_item_fingerprints
        add constraint chk_rss_item_fingerprints_identity_consistency
        check (
          length(btrim(item_key)) > 0
          and (
            (
              identity_type = 'url'
              and normalized_url is not null
              and length(btrim(normalized_url)) > 0
              and fallback_fingerprint is null
              and (item_guid is null or length(btrim(item_guid)) > 0)
              and item_key = ('url:' || normalized_url)
            )
            or (
              identity_type = 'guid'
              and normalized_url is null
              and item_guid is not null
              and length(btrim(item_guid)) > 0
              and fallback_fingerprint is null
              and item_key = ('guid:' || item_guid)
            )
            or (
              identity_type = 'fallback_hash'
              and normalized_url is null
              and item_guid is null
              and fallback_fingerprint is not null
              and fallback_fingerprint ~ '^[0-9a-f]{64}$'
              and item_key = ('fallback:' || fallback_fingerprint)
            )
          )
        ) not valid;
    else
      alter table public.rss_item_fingerprints
        add constraint chk_rss_item_fingerprints_identity_consistency
        check (
          length(btrim(item_key)) > 0
          and (
            (
              identity_type = 'url'
              and normalized_url is not null
              and length(btrim(normalized_url)) > 0
              and fallback_fingerprint is null
              and (item_guid is null or length(btrim(item_guid)) > 0)
              and item_key = ('url:' || normalized_url)
            )
            or (
              identity_type = 'guid'
              and normalized_url is null
              and item_guid is not null
              and length(btrim(item_guid)) > 0
              and fallback_fingerprint is null
              and item_key = ('guid:' || item_guid)
            )
            or (
              identity_type = 'fallback_hash'
              and normalized_url is null
              and item_guid is null
              and fallback_fingerprint is not null
              and fallback_fingerprint ~ '^[0-9a-f]{64}$'
              and item_key = ('fallback:' || fallback_fingerprint)
            )
          )
        );
    end if;
  end if;

  -- 7.12 chk_rss_item_fingerprints_content_hash
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_item_fingerprints'::regclass and c.conname = 'chk_rss_item_fingerprints_content_hash';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checkcontent_hash~''^[0-9a-f]{64}$''' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_item_fingerprints_content_hash" on public.rss_item_fingerprints has wrong definition "%". Expected CHECK (content_hash ~ ''^[0-9a-f]{64}$'').', v_def;
    end if;
  else
    if v_use_not_valid_hash then
      alter table public.rss_item_fingerprints
        add constraint chk_rss_item_fingerprints_content_hash
        check (content_hash ~ '^[0-9a-f]{64}$') not valid;
    else
      alter table public.rss_item_fingerprints
        add constraint chk_rss_item_fingerprints_content_hash
        check (content_hash ~ '^[0-9a-f]{64}$');
    end if;
  end if;

  -- 7.13 chk_rss_item_fingerprints_change_count
  select c.oid, c.contype, pg_get_constraintdef(c.oid)
  into v_con_oid, v_contype, v_def
  from pg_constraint c
  where c.conrelid = 'public.rss_item_fingerprints'::regclass and c.conname = 'chk_rss_item_fingerprints_change_count';
  if v_con_oid is not null then
    v_norm_def := regexp_replace(regexp_replace(regexp_replace(lower(v_def), '\s+not\s+valid\s*$', '', 'i'), '::(text|character varying|varchar)', '', 'gi'), '[()\s]+', '', 'g');
    if v_contype <> 'c' or v_norm_def <> 'checkchange_count>=0' then
      raise exception 'Phase 2C.1 aborted: constraint "chk_rss_item_fingerprints_change_count" on public.rss_item_fingerprints has wrong definition "%". Expected CHECK (change_count >= 0).', v_def;
    end if;
  else
    alter table public.rss_item_fingerprints
      add constraint chk_rss_item_fingerprints_change_count
      check (change_count >= 0);
  end if;
end
$$;

-- ============================================================================
-- 8. Non-Redundant Indexes
-- ============================================================================
create index if not exists idx_rss_feeds_status on public.rss_feeds(status);
create index if not exists idx_rss_feeds_source_id on public.rss_feeds(source_id);
create index if not exists idx_rss_feeds_domain on public.rss_feeds(source_domain);
create index if not exists idx_rss_feeds_verified on public.rss_feeds(verified);
create index if not exists idx_rss_feeds_last_attempted on public.rss_feeds(last_attempted_at desc);

create index if not exists idx_rss_fetch_logs_feed_fetched on public.rss_fetch_logs(feed_id, fetched_at desc);
create index if not exists idx_rss_fetch_logs_status on public.rss_fetch_logs(status);
create index if not exists idx_rss_fetch_logs_fetched_at on public.rss_fetch_logs(fetched_at desc);
create index if not exists idx_rss_fetch_logs_raw_batch on public.rss_fetch_logs(raw_batch_id);

-- Note: uq_rss_item_fingerprints_feed_item_key ALREADY enforces per-feed normalized_url uniqueness.
-- No redundant unique URL index is created; only non-unique partial lookup indexes are added.
create index if not exists idx_rss_item_fingerprints_candidate_id on public.rss_item_fingerprints(candidate_id);
create index if not exists idx_rss_item_fingerprints_last_seen on public.rss_item_fingerprints(last_seen_at desc);
create index if not exists idx_rss_item_fingerprints_identity_type on public.rss_item_fingerprints(identity_type);
create index if not exists idx_rss_item_fingerprints_normalized_url
  on public.rss_item_fingerprints(normalized_url)
  where normalized_url is not null;
create index if not exists idx_rss_item_fingerprints_feed_guid
  on public.rss_item_fingerprints(feed_id, item_guid)
  where item_guid is not null;

create index if not exists idx_discovery_candidates_rss_feed_id on public.discovery_candidates(rss_feed_id);

-- ============================================================================
-- 9. Updated-at Triggers
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_rss_feeds_updated_at'
      and tgrelid = 'public.rss_feeds'::regclass
      and not tgisinternal
  ) then
    create trigger trg_rss_feeds_updated_at
    before update on public.rss_feeds
    for each row execute function public.denio_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_rss_item_fingerprints_updated_at'
      and tgrelid = 'public.rss_item_fingerprints'::regclass
      and not tgisinternal
  ) then
    create trigger trg_rss_item_fingerprints_updated_at
    before update on public.rss_item_fingerprints
    for each row execute function public.denio_set_updated_at();
  end if;
end
$$;

-- ============================================================================
-- 10. Row Level Security (RLS), Grants, and Policies (Backend service_role-only)
-- ============================================================================
grant usage on schema public to service_role;

do $$
declare
  tbl text;
  rss_tables text[] := array[
    'rss_feeds',
    'rss_fetch_logs',
    'rss_item_fingerprints'
  ];
begin
  foreach tbl in array rss_tables loop
    execute format('alter table public.%I enable row level security;', tbl);
    execute format('revoke all on table public.%I from public;', tbl);
    execute format('revoke all on table public.%I from anon;', tbl);
    execute format('revoke all on table public.%I from authenticated;', tbl);
    execute format('grant all on table public.%I to service_role;', tbl);

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = tbl
        and policyname = tbl || '_service_role_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true);',
        tbl || '_service_role_all',
        tbl
      );
    end if;
  end loop;
end
$$;

-- ============================================================================
-- 11. Post-Migration Validation Status Audit (pg_constraint.convalidated)
-- ============================================================================
-- Inspects all Phase 2C constraints and transparently reports any NOT VALID constraint
-- alongside legacy row counts that do not conform (never claims invalid legacy data is clean).
do $$
declare
  v_unvalidated record;
  v_unvalidated_count integer := 0;
  v_legacy_bad_identity bigint := 0;
  v_legacy_bad_hash bigint := 0;
begin
  for v_unvalidated in
    select conrelid::regclass::text as tbl_name, conname, pg_get_constraintdef(oid) as condef
    from pg_constraint
    where (
      conrelid in (
        'public.rss_feeds'::regclass,
        'public.rss_fetch_logs'::regclass,
        'public.rss_item_fingerprints'::regclass
      )
      or (
        conrelid = 'public.discovery_candidates'::regclass
        and conname = 'fk_discovery_candidates_rss_feed'
      )
    )
      and convalidated = false
  loop
    v_unvalidated_count := v_unvalidated_count + 1;
    raise notice 'UNVALIDATED CONSTRAINT (NOT VALID, convalidated=false): %.% -> %. New INSERT/UPDATE are enforced, but legacy rows remain unvalidated.',
      v_unvalidated.tbl_name, v_unvalidated.conname, v_unvalidated.condef;
  end loop;

  if v_unvalidated_count > 0 then
    select count(*) into v_legacy_bad_identity
    from public.rss_item_fingerprints
    where not (
      length(btrim(item_key)) > 0
      and (
        (
          identity_type = 'url'
          and normalized_url is not null
          and length(btrim(normalized_url)) > 0
          and fallback_fingerprint is null
          and (item_guid is null or length(btrim(item_guid)) > 0)
          and item_key = ('url:' || normalized_url)
        )
        or (
          identity_type = 'guid'
          and normalized_url is null
          and item_guid is not null
          and length(btrim(item_guid)) > 0
          and fallback_fingerprint is null
          and item_key = ('guid:' || item_guid)
        )
        or (
          identity_type = 'fallback_hash'
          and normalized_url is null
          and item_guid is null
          and fallback_fingerprint is not null
          and fallback_fingerprint ~ '^[0-9a-f]{64}$'
          and item_key = ('fallback:' || fallback_fingerprint)
        )
      )
    );

    select count(*) into v_legacy_bad_hash
    from public.rss_item_fingerprints
    where content_hash !~ '^[0-9a-f]{64}$';

    raise notice 'Legacy validation report on public.rss_item_fingerprints: % rows fail identity_consistency, % rows fail SHA-256 content_hash. Run VALIDATE CONSTRAINT after manual remediation.',
      v_legacy_bad_identity, v_legacy_bad_hash;
  end if;
end
$$;
