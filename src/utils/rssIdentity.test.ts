import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRssItemContentHash,
  evaluateFingerprintDelta,
  normalizeRssFeedUrl,
  normalizeRssItemUrl,
  resolveRssItemIdentity,
  sha256Hex,
} from './rssIdentity';
import { normalizeDiscoveryUrl } from './radarLogic';

test('1. sha256Hex matches standard FIPS 180-4 test vectors', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('2. normalizeRssFeedUrl normalizes casing, default ports, fragments, trailing slash, and relative feed links', () => {
  assert.equal(
    normalizeRssFeedUrl('HTTPS://HMIF.ITB.AC.ID:443/feed/?utm_source=radar#top'),
    'https://hmif.itb.ac.id/feed'
  );
  assert.equal(
    normalizeRssFeedUrl('http://Portal.Kampus.ac.id:80/rss.xml?feed=rss2&fbclid=123'),
    'http://portal.kampus.ac.id/rss.xml?feed=rss2'
  );
  // Preserves non-default port and www subdomain on feed_url so strict DNS hosts fetch safely
  assert.equal(
    normalizeRssFeedUrl('https://WWW.Kampus.ac.id:8443/atom.xml/'),
    'https://www.kampus.ac.id:8443/atom.xml'
  );
  // Resolves autodiscovered relative feed URL against parent_site_url
  assert.equal(
    normalizeRssFeedUrl('/berita/feed.xml', 'https://bem.ui.ac.id/kompetisi'),
    'https://bem.ui.ac.id/berita/feed.xml'
  );
});

test('3. normalizeRssItemUrl resolves relative links, preserves content query params, and aligns with normalizeDiscoveryUrl', () => {
  const fromRss = normalizeRssItemUrl(
    'https://WWW.Example.org:443/article.php/?b=2&id=99&utm_campaign=spring&fbclid=abc#register'
  );
  assert.equal(fromRss, 'https://example.org/article.php?b=2&id=99');
  assert.equal(
    fromRss,
    normalizeDiscoveryUrl('https://example.org/article.php?id=99&b=2&utm_source=google')
  );

  // Relative paths resolved against feed_url
  assert.equal(
    normalizeRssItemUrl('/lomba/gemastik-2027/?ref=rss', 'https://kemahasiswaan.kampus.ac.id/feed.xml'),
    'https://kemahasiswaan.kampus.ac.id/lomba/gemastik-2027'
  );
  assert.equal(
    normalizeRssItemUrl('events/detail?p=412', 'https://bem.example.ac.id/news/rss.xml'),
    'https://bem.example.ac.id/news/events/detail?p=412'
  );
  assert.equal(
    normalizeRssItemUrl('//cdn.example.ac.id/lomba/2027/', 'https://bem.example.ac.id/feed.xml'),
    'https://cdn.example.ac.id/lomba/2027'
  );
});

test('4. normalizeRssItemUrl rejects unsafe schemes and non-URL placeholder text', () => {
  assert.equal(normalizeRssItemUrl('javascript:alert(1)', 'https://example.org/feed.xml'), null);
  assert.equal(normalizeRssItemUrl('mailto:panitia@example.org', 'https://example.org/feed.xml'), null);
  assert.equal(normalizeRssItemUrl('urn:uuid:1234-5678', 'https://example.org/feed.xml'), null);
  assert.equal(normalizeRssItemUrl('N/A', 'https://example.org/feed.xml'), null);
  assert.equal(normalizeRssItemUrl('TBD', 'https://example.org/feed.xml'), null);
  assert.equal(normalizeRssItemUrl('no link available', 'https://example.org/feed.xml'), null);
});

test('5. Tier 1 (url): prioritizes normalized URL even when buggy CMS emits duplicate GUID across items', () => {
  const itemA = resolveRssItemIdentity({
    feedUrl: 'https://bem.kampus.ac.id/feed.xml',
    link: 'https://www.bem.kampus.ac.id/lomba-ai-2027/?utm_medium=rss',
    guid: 'same-buggy-guid',
    title: 'Lomba AI Nasional 2027',
    publishedAt: '2026-11-20T08:00:00Z',
  });
  const itemB = resolveRssItemIdentity({
    feedUrl: 'https://bem.kampus.ac.id/feed.xml',
    link: '/lomba-bisnis-2027/',
    guid: 'same-buggy-guid',
    title: 'Lomba Bisnis Mahasiswa 2027',
    publishedAt: '2026-11-20T09:00:00Z',
  });

  assert.equal(itemA.identityType, 'url');
  assert.equal(itemA.normalizedUrl, 'https://bem.kampus.ac.id/lomba-ai-2027');
  assert.equal(itemA.itemKey, 'url:https://bem.kampus.ac.id/lomba-ai-2027');
  assert.equal(itemA.fallbackFingerprint, null);

  assert.equal(itemB.identityType, 'url');
  assert.equal(itemB.normalizedUrl, 'https://bem.kampus.ac.id/lomba-bisnis-2027');
  assert.notEqual(itemA.itemKey, itemB.itemKey);
});

test('6. Tier 2 (guid): stores linkless item with GUID/Atom ID and null normalizedUrl without collision', () => {
  const item1 = resolveRssItemIdentity({
    feedUrl: 'https://feeds.example.org/atom.xml',
    link: null,
    guid: '  urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6  ',
    title: 'Hackathon Nasional Linkless #1',
    summary: 'Pendaftaran dibuka hingga 15 Desember 2026.',
  });
  const item2 = resolveRssItemIdentity({
    feedUrl: 'https://feeds.example.org/atom.xml',
    link: '',
    guid: 'urn:uuid:11111111-2222-3333-4444-555555555555',
    title: 'Hackathon Nasional Linkless #2',
    summary: 'Batch 2 dibuka.',
  });

  assert.equal(item1.identityType, 'guid');
  assert.equal(item1.normalizedUrl, null);
  assert.equal(item1.itemGuid, 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6');
  assert.equal(item1.itemKey, 'guid:urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6');
  assert.equal(item1.fallbackFingerprint, null);

  assert.equal(item2.identityType, 'guid');
  assert.equal(item2.normalizedUrl, null);
  assert.notEqual(item1.itemKey, item2.itemKey);
});

test('7. Tier 3 (fallback_hash): handles items with neither URL nor GUID and distinguishes distinct items', () => {
  const itemA = resolveRssItemIdentity({
    feedUrl: 'https://minimal.example.org/rss',
    link: null,
    guid: null,
    title: 'Olimpiade Sains Mahasiswa 2027',
    publishedAt: '2026-11-20',
    summary: 'Hadiah total Rp 50 juta.',
  });
  const itemB = resolveRssItemIdentity({
    feedUrl: 'https://minimal.example.org/rss',
    link: undefined,
    guid: '   ',
    title: 'Kompetisi Desain Produk 2027',
    publishedAt: '2026-11-20',
    summary: 'Terbuka untuk S1/D4.',
  });

  assert.equal(itemA.identityType, 'fallback_hash');
  assert.equal(itemA.normalizedUrl, null);
  assert.equal(itemA.itemGuid, null);
  assert.match(itemA.fallbackFingerprint ?? '', /^[0-9a-f]{64}$/);
  assert.equal(itemA.itemKey, `fallback:${itemA.fallbackFingerprint}`);

  assert.equal(itemB.identityType, 'fallback_hash');
  assert.notEqual(itemA.itemKey, itemB.itemKey);
});

test('8. Edited item content updates contentHash while keeping itemKey stable across all 3 tiers and avoids duplicate candidate', () => {
  const v1 = resolveRssItemIdentity({
    feedUrl: 'https://minimal.example.org/rss',
    link: null,
    guid: null,
    title: 'Kompetisi Riset Nasional 2027',
    publishedAt: '2026-11-20',
    summary: 'Deadline 10 Desember 2026.',
  });
  const v2 = resolveRssItemIdentity({
    feedUrl: 'https://minimal.example.org/rss',
    link: null,
    guid: null,
    title: 'Kompetisi Riset Nasional 2027',
    publishedAt: '2026-11-20',
    summary: 'Deadline diperpanjang hingga 20 Desember 2026.',
  });

  assert.equal(v1.itemKey, v2.itemKey);
  assert.notEqual(v1.contentHash, v2.contentHash);

  const unchanged = evaluateFingerprintDelta(
    {
      itemKey: v1.itemKey,
      contentHash: v1.contentHash,
      candidateId: 'cand-123',
      changeCount: 0,
    },
    v1
  );
  assert.deepEqual(unchanged, {
    action: 'unchanged',
    shouldCreateCandidate: false,
    nextChangeCount: 0,
  });

  const edited = evaluateFingerprintDelta(
    {
      itemKey: v1.itemKey,
      contentHash: v1.contentHash,
      candidateId: 'cand-123',
      changeCount: 0,
    },
    v2
  );
  assert.deepEqual(edited, {
    action: 'changed',
    shouldCreateCandidate: false,
    nextChangeCount: 1,
  });

  // Also check URL tier contentHash determinism when whitespace differs
  assert.equal(
    computeRssItemContentHash({
      title: '  Lomba   Data  ',
      summary: 'Terbuka\nuntuk mahasiswa.',
      categories: ['Data', 'AI'],
    }),
    computeRssItemContentHash({
      title: 'Lomba Data',
      summary: 'Terbuka untuk mahasiswa.',
      categories: ['ai', 'data'],
    })
  );
});

test('9. Fallback fingerprint & contentHash are independent of XML category/field ordering and satisfy SQL 64-hex SHA-256 invariants', () => {
  const xmlOrderA = resolveRssItemIdentity({
    feedUrl: 'https://minimal.example.org/rss',
    link: null,
    guid: null,
    title: '  Hackathon   Kampus 2027 ',
    publishedAt: '2026-11-20T09:00:00Z',
    summary: 'Pendaftaran tim 3 mahasiswa.',
    categories: ['AI', 'Software', 'Data'],
  });

  const xmlOrderB = resolveRssItemIdentity({
    categories: ['data', 'AI', 'software', 'ai'],
    summary: 'Pendaftaran   tim 3   mahasiswa.',
    publishedAt: '2026-11-20T09:00:00Z',
    title: 'Hackathon Kampus 2027',
    guid: '',
    link: undefined,
    feedUrl: 'https://minimal.example.org/rss',
  });

  assert.equal(xmlOrderA.identityType, 'fallback_hash');
  assert.equal(xmlOrderA.normalizedUrl, null);
  assert.equal(xmlOrderA.itemGuid, null);
  assert.match(xmlOrderA.fallbackFingerprint ?? '', /^[0-9a-f]{64}$/);
  assert.match(xmlOrderA.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(xmlOrderA.itemKey, `fallback:${xmlOrderA.fallbackFingerprint}`);
  assert.equal(xmlOrderA.itemKey, xmlOrderB.itemKey);
  assert.equal(xmlOrderA.contentHash, xmlOrderB.contentHash);
});

test('10. Tier 1 (url) and Tier 2 (guid) detect content updates while preserving identity and matching SQL CHECK invariants', () => {
  const urlV1 = resolveRssItemIdentity({
    feedUrl: 'https://bem.kampus.ac.id/feed.xml',
    link: '/lomba/gemastik-2027',
    guid: 'post-401',
    title: 'GEMASTIK 2027 Dibuka',
    summary: 'Deadline 1 Mei 2027.',
  });
  const urlV2 = resolveRssItemIdentity({
    feedUrl: 'https://bem.kampus.ac.id/feed.xml',
    link: 'https://www.bem.kampus.ac.id/lomba/gemastik-2027/',
    guid: 'post-401',
    title: 'GEMASTIK 2027 Dibuka (Extended)',
    summary: 'Deadline diperpanjang hingga 15 Mei 2027.',
  });

  assert.equal(urlV1.identityType, 'url');
  assert.equal(urlV1.fallbackFingerprint, null);
  assert.equal(urlV1.itemKey, `url:${urlV1.normalizedUrl}`);
  assert.match(urlV1.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(urlV1.itemKey, urlV2.itemKey);
  assert.notEqual(urlV1.contentHash, urlV2.contentHash);

  const guidV1 = resolveRssItemIdentity({
    feedUrl: 'https://bem.kampus.ac.id/atom.xml',
    link: null,
    guid: 'urn:uuid:aaaa-bbbb-cccc',
    title: 'Lomba IoT 2027',
    summary: 'Tahap seleksi abstrak.',
  });
  const guidV2 = resolveRssItemIdentity({
    feedUrl: 'https://bem.kampus.ac.id/atom.xml',
    link: null,
    guid: 'urn:uuid:aaaa-bbbb-cccc',
    title: 'Lomba IoT 2027',
    summary: 'Tahap seleksi abstrak diperpanjang 7 hari.',
  });

  assert.equal(guidV1.identityType, 'guid');
  assert.equal(guidV1.normalizedUrl, null);
  assert.equal(guidV1.fallbackFingerprint, null);
  assert.equal(guidV1.itemKey, `guid:${guidV1.itemGuid}`);
  assert.match(guidV1.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(guidV1.itemKey, guidV2.itemKey);
  assert.notEqual(guidV1.contentHash, guidV2.contentHash);
});
