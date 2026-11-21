import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateFingerprintDelta, resolveRssItemIdentity } from './rssIdentity';

const migration003Path = path.resolve(
  process.cwd(),
  'supabase/migrations/003_phase2c_rss_discovery.sql'
);
const migration001Path = path.resolve(
  process.cwd(),
  'supabase/migrations/001_phase2a_init.sql'
);
const migration002Path = path.resolve(
  process.cwd(),
  'supabase/migrations/002_phase2b1_discovery_quality.sql'
);

const sql003 = fs.readFileSync(migration003Path, 'utf-8');
const sql001 = fs.readFileSync(migration001Path, 'utf-8');
const sql002 = fs.readFileSync(migration002Path, 'utf-8');

test('SQL Audit 1: Migration 003 is strictly non-destructive (no DROP, TRUNCATE, DELETE, or ALTER TYPE)', () => {
  const executableSql = sql003.replace(/--[^\n]*/g, '');
  assert.equal(/\bdrop\s+(table|column|constraint|index|trigger|policy|type|function)\b/i.test(executableSql), false);
  assert.equal(/\btruncate\b/i.test(executableSql), false);
  assert.equal(/\bdelete\s+from\b/i.test(executableSql), false);
  assert.equal(/\balter\s+type\b/i.test(executableSql), false);
});

test('SQL Audit 2: Pre-flight validates Phase 2A sources.id and discovery_candidates.id UUID + PK/UNIQUE constraints', () => {
  assert.match(sql003, /to_regclass\('public\.sources'\)\s+is\s+null/i);
  assert.match(sql003, /to_regclass\('public\.discovery_candidates'\)\s+is\s+null/i);
  assert.match(sql003, /contype\s+in\s+\('p',\s*'u'\)/i);
  assert.match(sql003, /public\.sources\.id\s+lacks\s+a\s+PRIMARY\s+KEY/i);
  assert.match(sql003, /public\.discovery_candidates\.id\s+lacks\s+a\s+PRIMARY\s+KEY/i);
});

test('SQL Audit 3: All 3 RSS tables enforce UUID PRIMARY KEY on id with NULL/duplicate safety guards', () => {
  for (const tbl of ['rss_feeds', 'rss_fetch_logs', 'rss_item_fingerprints']) {
    assert.match(sql003, new RegExp(`public\\.${tbl}\\.id\\s+must\\s+be\\s+uuid`, 'i'));
    assert.match(
      sql003,
      new RegExp(`public\\.${tbl}\\.id\\s+has\\s+%\\s+NULL\\s+values;\\s+cannot\\s+safely\\s+add\\s+PRIMARY\\s+KEY`, 'i')
    );
    assert.match(
      sql003,
      new RegExp(`public\\.${tbl}\\.id\\s+contains\\s+duplicate\\s+UUIDs;\\s+cannot\\s+safely\\s+add\\s+PRIMARY\\s+KEY`, 'i')
    );
    assert.match(sql003, new RegExp(`alter\\s+table\\s+public\\.${tbl}\\s+add\\s+constraint\\s+${tbl}_pkey\\s+primary\\s+key\\s+\\(id\\)`, 'i'));
  }
});

test('SQL Audit 4: Mandatory columns on existing tables abort with RAISE EXCEPTION instead of fabricating defaults', () => {
  for (const [tbl, col] of [
    ['rss_feeds', 'feed_name'],
    ['rss_feeds', 'feed_url'],
    ['rss_fetch_logs', 'feed_id'],
    ['rss_fetch_logs', 'status'],
    ['rss_item_fingerprints', 'feed_id'],
    ['rss_item_fingerprints', 'content_hash'],
  ]) {
    assert.match(
      sql003,
      new RegExp(`public\\.${tbl}\\s+is\\s+missing\\s+mandatory\\s+column\\s+"${col}"`, 'i')
    );
  }
  assert.match(
    sql003,
    /cannot\s+derive\s+identity\s+safely\s+without\s+fabricating\s+data/i
  );
});

test('SQL Audit 5: All 5 Foreign Keys are verified idempotently including differently-named existing FKs & orphan checks', () => {
  const expectedFks = [
    ['public.rss_feeds', 'source_id', 'public.sources', 'fk_rss_feeds_source', 'SET NULL'],
    ['public.rss_fetch_logs', 'feed_id', 'public.rss_feeds', 'fk_rss_fetch_logs_feed', 'CASCADE'],
    ['public.rss_item_fingerprints', 'feed_id', 'public.rss_feeds', 'fk_rss_item_fingerprints_feed', 'CASCADE'],
    ['public.rss_item_fingerprints', 'candidate_id', 'public.discovery_candidates', 'fk_rss_item_fingerprints_candidate', 'SET NULL'],
    ['public.discovery_candidates', 'rss_feed_id', 'public.rss_feeds', 'fk_discovery_candidates_rss_feed', 'SET NULL'],
  ] as const;

  for (const [child, col, parent, conname, onDelete] of expectedFks) {
    assert.ok(sql003.includes(`'${child}'::text`), `Missing FK spec for child ${child}`);
    assert.ok(sql003.includes(`'${col}'::text`), `Missing FK spec for column ${col}`);
    assert.ok(sql003.includes(`'${parent}'::text`), `Missing FK spec for parent ${parent}`);
    assert.ok(sql003.includes(`'${conname}'::text`), `Missing FK spec for ${conname}`);
    assert.ok(sql003.includes(`'${onDelete}'::text`), `Missing ON DELETE ${onDelete} for ${conname}`);
  }
  assert.match(sql003, /already\s+has\s+conflicting\s+FK/i);
  assert.match(sql003, /cannot\s+add\s+FK\s+"%"\s+because\s+%\s+rows/i);
});

test('SQL Audit 6: All named UNIQUE & CHECK constraints verify pg_get_constraintdef() and raise on mismatch', () => {
  const expectedConstraints = [
    'uq_rss_feeds_feed_url',
    'chk_rss_feeds_format',
    'chk_rss_feeds_origin',
    'chk_rss_feeds_status',
    'chk_rss_feeds_interval',
    'chk_rss_feeds_counters',
    'chk_rss_fetch_logs_status',
    'chk_rss_fetch_logs_counters',
    'uq_rss_item_fingerprints_feed_item_key',
    'chk_rss_item_fingerprints_identity_type',
    'chk_rss_item_fingerprints_identity_consistency',
    'chk_rss_item_fingerprints_content_hash',
    'chk_rss_item_fingerprints_change_count',
  ];

  for (const conname of expectedConstraints) {
    assert.ok(sql003.includes(conname), `Missing constraint ${conname}`);
    assert.match(
      sql003,
      new RegExp(`constraint\\s+"${conname}"\\s+on\\s+public\\.\\w+\\s+has\\s+(?:invalid|wrong)\\s+definition`, 'i')
    );
  }
  assert.match(sql003, /pg_get_constraintdef\(c\.oid\)/i);
});

test('SQL Audit 7: No redundant unique index on normalized_url; partial indexes on normalized_url & feed_guid are non-unique', () => {
  assert.equal(
    /create\s+unique\s+index\b/i.test(sql003),
    false,
    'Expected zero redundant CREATE UNIQUE INDEX statements since uq_rss_item_fingerprints_feed_item_key covers URL uniqueness'
  );
  assert.match(
    sql003,
    /create\s+index\s+if\s+not\s+exists\s+idx_rss_item_fingerprints_normalized_url\s+on\s+public\.rss_item_fingerprints\(normalized_url\)\s+where\s+normalized_url\s+is\s+not\s+null/i
  );
  assert.match(
    sql003,
    /create\s+index\s+if\s+not\s+exists\s+idx_rss_item_fingerprints_feed_guid\s+on\s+public\.rss_item_fingerprints\(feed_id,\s*item_guid\)\s+where\s+item_guid\s+is\s+not\s+null/i
  );
});

test('SQL Audit 8: NOT VALID audit reports pg_constraint.convalidated and legacy bad row counts without mutating data', () => {
  assert.match(sql003, /pg_constraint[\s\S]*convalidated\s*=\s*false/i);
  assert.match(sql003, /UNVALIDATED\s+CONSTRAINT\s+\(NOT\s+VALID,\s+convalidated=false\)/i);
  assert.match(sql003, /Legacy\s+validation\s+report\s+on\s+public\.rss_item_fingerprints/i);
});

test('SQL Audit 9: RLS enforces backend service_role-only least-privilege and Phase 2A/2B.1 migration files were not altered', () => {
  const executableSql003 = sql003.replace(/--[^\n]*/g, '');
  assert.match(sql003, /grant\s+usage\s+on\s+schema\s+public\s+to\s+service_role/i);
  assert.match(sql003, /for\s+all\s+to\s+service_role\s+using\s+\(true\)\s+with\s+check\s+\(true\)/i);
  assert.match(sql003, /alter\s+table\s+public\.%I\s+enable\s+row\s+level\s+security/i);
  assert.match(sql003, /revoke\s+all\s+on\s+table\s+public\.%I\s+from\s+public/i);
  assert.match(sql003, /revoke\s+all\s+on\s+table\s+public\.%I\s+from\s+anon/i);
  assert.match(sql003, /revoke\s+all\s+on\s+table\s+public\.%I\s+from\s+authenticated/i);
  assert.match(sql003, /grant\s+all\s+on\s+table\s+public\.%I\s+to\s+service_role/i);
  assert.equal(/grant\s+[^;]*\bto\s+authenticated\b/i.test(executableSql003), false);
  assert.equal(/_authenticated_admin_all|\bto\s+authenticated\b/i.test(executableSql003), false);
  assert.ok(sql001.includes('create table if not exists public.sources'));
  assert.ok(sql002.includes('create table if not exists public.discovery_raw_batches'));
  assert.equal(sql001.includes('rss_feeds'), false);
  assert.equal(sql002.includes('rss_feeds'), false);
});

test('SQL Audit 10: TypeScript 3-tier resolveRssItemIdentity outputs match SQL CHECK & ON CONFLICT (feed_id, item_key) contract', () => {
  const urlTier = resolveRssItemIdentity({
    feedUrl: 'https://bem.kampus.ac.id/feed.xml',
    link: '/lomba/gemastik-2027/?utm_source=rss&id=9',
    guid: 'dup-guid',
    title: 'GEMASTIK 2027',
  });
  assert.equal(urlTier.identityType, 'url');
  assert.equal(urlTier.itemKey, `url:${urlTier.normalizedUrl}`);
  assert.equal(urlTier.fallbackFingerprint, null);
  assert.match(urlTier.contentHash, /^[0-9a-f]{64}$/);

  const guidTier = resolveRssItemIdentity({
    feedUrl: 'https://bem.kampus.ac.id/feed.xml',
    link: null,
    guid: 'urn:uuid:7777-8888',
    title: 'Lomba Linkless',
  });
  assert.equal(guidTier.identityType, 'guid');
  assert.equal(guidTier.normalizedUrl, null);
  assert.equal(guidTier.fallbackFingerprint, null);
  assert.equal(guidTier.itemKey, 'guid:urn:uuid:7777-8888');
  assert.match(guidTier.contentHash, /^[0-9a-f]{64}$/);

  const fallbackTier = resolveRssItemIdentity({
    feedUrl: 'https://bem.kampus.ac.id/feed.xml',
    link: null,
    guid: null,
    title: 'Kompetisi Minimalis 2027',
    publishedAt: '2026-11-20',
  });
  assert.equal(fallbackTier.identityType, 'fallback_hash');
  assert.equal(fallbackTier.normalizedUrl, null);
  assert.equal(fallbackTier.itemGuid, null);
  assert.match(fallbackTier.fallbackFingerprint ?? '', /^[0-9a-f]{64}$/);
  assert.equal(fallbackTier.itemKey, `fallback:${fallbackTier.fallbackFingerprint}`);
  assert.match(fallbackTier.contentHash, /^[0-9a-f]{64}$/);

  const delta = evaluateFingerprintDelta(
    {
      itemKey: urlTier.itemKey,
      contentHash: urlTier.contentHash,
      candidateId: 'existing-cand-uuid',
      changeCount: 0,
    },
    {
      ...urlTier,
      contentHash: fallbackTier.contentHash,
    }
  );
  assert.equal(delta.action, 'changed');
  assert.equal(delta.shouldCreateCandidate, false);
  assert.equal(delta.nextChangeCount, 1);
});

test('SQL Audit 11: Migration 003 is pure SQL (no Markdown/reports) with duplicate UNIQUE & column-type guards', () => {
  assert.equal(/```/.test(sql003), false, 'Migration SQL must not contain Markdown code fences');
  assert.equal(/^#{1,6}\s/m.test(sql003), false, 'Migration SQL must not contain Markdown headings');
  assert.match(sql003, /public\.rss_feeds\.feed_url\s+contains\s+duplicate\s+values/i);
  assert.match(sql003, /public\.rss_item_fingerprints\s+\(feed_id,\s*item_key\)\s+contains\s+duplicate\s+pairs/i);
  assert.match(sql003, /public\.rss_feeds\.%\s+must\s+be\s+text\/varchar/i);
  assert.match(sql003, /public\.rss_fetch_logs\.%\s+must\s+be\s+integer/i);
  assert.match(sql003, /public\.rss_item_fingerprints\.%\s+must\s+be\s+text\/varchar/i);
  assert.match(sql003, /::\(text\|character varying\|varchar\)/i);
});

