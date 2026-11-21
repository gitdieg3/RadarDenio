import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscoveryQuery,
  clampDiscoveryRunLimits,
  computeOverviewMetrics,
  filterSources,
  formatIntervalLabel,
  generateDeterministicFingerprint,
  normalizeDiscoveryUrl,
  validateCreateSourceForm,
  validateSourceUrl,
} from './radarLogic';
import type {
  CompetitionSource,
  DiscoveredContentItem,
  MonitoringJob,
  SystemLogEntry,
} from '../types/radar';

const sampleSources: CompetitionSource[] = [
  {
    id: 'src-1',
    name: 'Global Robotics Challenge',
    url: 'https://robotics.example.org/rss.xml',
    sourceType: 'rss_feed',
    discoveryMethod: 'rss_autodiscovery',
    monitoringMethod: 'rss_feed',
    category: 'Robotics & Hardware',
    priority: 'high',
    status: 'active',
    pollingIntervalMinutes: 30,
    lastCheckedAt: '2026-11-18T10:00:00Z',
    lastSuccessfulCheckAt: '2026-11-18T10:00:00Z',
    errorInfo: null,
    contentFingerprint: 'fp_1111aaaa',
    dataOrigin: 'seeded_demo',
    createdAt: '2026-11-10T09:00:00Z',
  },
  {
    id: 'src-2',
    name: 'Civic AI Prize Portal',
    url: 'https://civicai.example.org/challenges',
    sourceType: 'public_portal',
    discoveryMethod: 'search_engine',
    monitoringMethod: 'polling',
    category: 'AI & Data Science',
    priority: 'critical',
    status: 'error',
    pollingIntervalMinutes: 60,
    lastCheckedAt: '2026-11-18T09:30:00Z',
    lastSuccessfulCheckAt: '2026-11-17T09:30:00Z',
    errorInfo: 'Connector unconfigured: live HTTP polling disabled in Phase 1',
    contentFingerprint: 'fp_2222bbbb',
    dataOrigin: 'seeded_demo',
    createdAt: '2026-11-11T09:00:00Z',
  },
];

test('validateSourceUrl accepts https/http URLs and rejects invalid protocols', () => {
  assert.equal(validateSourceUrl('https://example.org/feed.xml').valid, true);
  assert.equal(validateSourceUrl('ftp://example.org/feed.xml').valid, false);
  assert.equal(validateSourceUrl('not-a-url').valid, false);
  assert.equal(validateSourceUrl('   ').valid, false);
});

test('validateCreateSourceForm catches missing fields and low polling interval', () => {
  const errors = validateCreateSourceForm({
    name: 'A',
    url: 'bad',
    category: '',
    pollingIntervalMinutes: 2,
  });
  assert.ok(errors.name);
  assert.ok(errors.url);
  assert.ok(errors.category);
  assert.ok(errors.pollingIntervalMinutes);

  const valid = validateCreateSourceForm({
    name: 'Climate Tech Cup',
    url: 'https://climatecup.example.org/competitions',
    category: 'Climate & Energy',
    pollingIntervalMinutes: 30,
  });
  assert.deepEqual(valid, {});
});

test('filterSources filters by query, status, monitoringMethod, and priority', () => {
  assert.equal(
    filterSources(sampleSources, {
      query: 'robotics',
      status: 'all',
      monitoringMethod: 'all',
      priority: 'all',
    }).length,
    1
  );

  assert.equal(
    filterSources(sampleSources, {
      query: '',
      status: 'error',
      monitoringMethod: 'polling',
      priority: 'critical',
    }).length,
    1
  );

  assert.equal(
    filterSources(sampleSources, {
      query: '',
      status: 'active',
      monitoringMethod: 'polling',
      priority: 'all',
    }).length,
    0
  );
});

test('computeOverviewMetrics aggregates counts accurately', () => {
  const jobs: MonitoringJob[] = [
    {
      id: 'job-1',
      name: 'RSS Poll',
      sourceId: 'src-1',
      sourceName: 'Global Robotics Challenge',
      monitoringMethod: 'rss_feed',
      intervalMinutes: 30,
      dedupStrategy: 'feed_guid',
      status: 'scheduled',
      lastRunAt: null,
      nextRunAt: null,
      itemsDetected: 3,
      duplicatesSkipped: 1,
      lastError: null,
      dataOrigin: 'seeded_demo',
    },
    {
      id: 'job-2',
      name: 'Search Discovery',
      sourceId: null,
      sourceName: 'Search Engine Query',
      monitoringMethod: 'search_discovery',
      intervalMinutes: 120,
      dedupStrategy: 'url_and_fingerprint',
      status: 'blocked_no_connector',
      lastRunAt: null,
      nextRunAt: null,
      itemsDetected: 0,
      duplicatesSkipped: 0,
      lastError: 'Search API key not configured',
      dataOrigin: 'seeded_demo',
    },
  ];
  const content: DiscoveredContentItem[] = [
    {
      id: 'cnt-1',
      sourceId: 'src-1',
      sourceName: 'Global Robotics Challenge',
      title: 'Autonomous Drone Sprint 2027',
      organizer: 'Robotics Foundation',
      competitionUrl: 'https://robotics.example.org/sprint-2027',
      category: 'Robotics & Hardware',
      discoveryMethod: 'rss_autodiscovery',
      fingerprintHash: 'fp_9999',
      deadlineDate: '2027-03-01',
      prizePool: '$50,000',
      reviewStatus: 'new',
      dataOrigin: 'seeded_demo',
      discoveredAt: '2026-11-18T10:00:00Z',
    },
  ];
  const logs: SystemLogEntry[] = [
    {
      id: 'log-1',
      timestamp: '2026-11-18T10:00:00Z',
      level: 'error',
      module: 'MonitoringJobs',
      message: 'Connector missing',
      details: null,
    },
  ];

  const metrics = computeOverviewMetrics(sampleSources, jobs, content, logs);
  assert.equal(metrics.totalSources, 2);
  assert.equal(metrics.activeSources, 1);
  assert.equal(metrics.errorSources, 1);
  assert.equal(metrics.scheduledJobs, 1);
  assert.equal(metrics.blockedJobs, 1);
  assert.equal(metrics.discoveredItems, 1);
  assert.equal(metrics.newItemsCount, 1);
  assert.equal(metrics.errorLogsCount, 1);
  assert.equal(metrics.methodCounts.rss_feed, 1);
  assert.equal(metrics.methodCounts.polling, 1);
});

test('generateDeterministicFingerprint is stable and normalizes casing/whitespace', () => {
  const a = generateDeterministicFingerprint(' https://Example.ORG/a ', ' My Comp ');
  const b = generateDeterministicFingerprint('https://example.org/a', 'my comp');
  assert.equal(a, b);
  assert.match(a, /^fp_[0-9a-f]{8}$/);
});

test('formatIntervalLabel renders clean human durations', () => {
  assert.equal(formatIntervalLabel(15), 'Every 15m');
  assert.equal(formatIntervalLabel(60), 'Every 1h');
  assert.equal(formatIntervalLabel(180), 'Every 3h');
});

test('normalizeDiscoveryUrl strips tracking params, www, hash, and trailing slash', () => {
  assert.equal(
    normalizeDiscoveryUrl('https://WWW.Example.org/hackathon-2027/?utm_source=x&fbclid=y#apply'),
    'https://example.org/hackathon-2027'
  );
  assert.equal(
    normalizeDiscoveryUrl('https://example.org/events/?b=2&a=1&ref=newsletter'),
    'https://example.org/events?a=1&b=2'
  );
  assert.equal(normalizeDiscoveryUrl('javascript:alert(1)'), '');
});

test('buildDiscoveryQuery builds natural-language query without gluing category onto Indonesian keywords', () => {
  assert.equal(
    buildDiscoveryQuery('AI hackathon 2027', 'AI & Data Science', 'Southeast Asia'),
    'AI hackathon Southeast Asia 2027'
  );
  assert.equal(
    buildDiscoveryQuery('lomba programming mahasiswa 2026', 'Programming & Hackathon', 'Indonesia'),
    'lomba programming mahasiswa Indonesia 2026'
  );
  assert.equal(
    buildDiscoveryQuery('Robotics Cup', 'Robotics', 'Global'),
    'Robotics Cup'
  );
});

test('clampDiscoveryRunLimits enforces safe cost boundaries', () => {
  assert.deepEqual(clampDiscoveryRunLimits({ maxKeywords: 99, maxResultsPerKeyword: 50 }), {
    maxKeywords: 3,
    maxResultsPerKeyword: 6,
  });
  assert.deepEqual(clampDiscoveryRunLimits({ maxKeywords: -5, maxResultsPerKeyword: 0 }), {
    maxKeywords: 1,
    maxResultsPerKeyword: 1,
  });
});
