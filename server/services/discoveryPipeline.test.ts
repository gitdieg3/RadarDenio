import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type {
  CompetitionSource,
  DiscoveryCandidate,
  DiscoveryKeyword,
  DiscoveryRawBatch,
  RawBatchStatus,
} from '../../src/types/radar.ts';
import {
  mapCandidateRow,
  type SaveDiscoveredCandidateInput,
} from '../repositories/supabaseRadarRepository.ts';
import { probeUrlCrawlability } from './crawlabilityChecker.ts';
import { classifySearchResultsWithGemini, GeminiClassifierError } from './discoveryClassifier.ts';
import {
  retryRawBatchClassification,
  runLiveSearchDiscovery,
  type DiscoveryRepositoryPort,
} from './searchDiscoveryService.ts';
import { searchTavily } from './tavilyClient.ts';

function createInMemoryRepo(initial?: {
  keywords?: DiscoveryKeyword[];
  sources?: CompetitionSource[];
}): {
  repo: DiscoveryRepositoryPort;
  candidates: DiscoveryCandidate[];
  batches: DiscoveryRawBatch[];
  logs: { level: string; module: string; message: string; details: string | null }[];
} {
  const keywords: DiscoveryKeyword[] = initial?.keywords ?? [
    {
      id: 'kw-1',
      phrase: 'lomba programming mahasiswa 2026',
      category: 'Programming',
      region: 'Indonesia',
      enabled: true,
      matchesFound: 0,
      lastRunAt: null,
      dataOrigin: 'user_created',
    },
  ];
  const sources: CompetitionSource[] = initial?.sources ?? [];
  const candidates: DiscoveryCandidate[] = [];
  const batches: DiscoveryRawBatch[] = [];
  const logs: { level: string; module: string; message: string; details: string | null }[] = [];

  const repo: DiscoveryRepositoryPort = {
    listEnabledKeywords: async (_ids, limit = 3) => keywords.filter((k) => k.enabled).slice(0, limit),
    getKnownNormalizedUrls: async () => {
      const set = new Set<string>();
      for (const s of sources) set.add(s.url);
      for (const c of candidates) set.add(c.url);
      return set;
    },
    listSources: async () => [...sources],
    listCandidatesForDedup: async () =>
      candidates.map((c) => ({
        id: c.id,
        url: c.url,
        suggestedName: c.suggestedName,
        organizer: c.organizer,
        candidateKind: c.candidateKind,
        classification: c.classification,
        sourceDomain: c.sourceDomain,
        eventYear: c.eventYear,
        registrationDeadline: c.registrationDeadline,
      })),
    saveDiscoveredCandidate: async (input: SaveDiscoveredCandidateInput) => {
      if (candidates.some((c) => c.url === input.normalizedUrl)) {
        return { saved: false, duplicate: true };
      }
      const created: DiscoveryCandidate = {
        id: crypto.randomUUID(),
        suggestedName: input.suggestedName,
        url: input.normalizedUrl,
        organizer: input.organizer,
        detectedType: input.detectedType,
        discoveryMethod: 'search_engine',
        matchedKeyword: input.matchedKeyword,
        category: input.category,
        confidenceNote: input.confidenceNote,
        status: 'candidate',
        dataOrigin: 'tavily_discovery',
        discoveredAt: new Date().toISOString(),
        classification: input.classification,
        confidenceScore: input.confidenceScore,
        candidateKind: input.candidateKind,
        temporalStatus: input.temporalStatus,
        registrationOpenDate: input.registrationOpenDate,
        registrationDeadline: input.registrationDeadline,
        competitionStartDate: input.competitionStartDate,
        competitionEndDate: input.competitionEndDate,
        eventYear: input.eventYear,
        temporalEvidence: input.temporalEvidence,
        temporalConfidence: input.temporalConfidence,
        targetAudience: input.targetAudience,
        audienceCompatible: input.audienceCompatible,
        audienceNote: input.audienceNote,
        isMonitorable: input.isMonitorable,
        isRecurringSource: input.isRecurringSource,
        monitoringEligibility: input.monitoringEligibility,
        monitoringBlockReason: input.monitoringBlockReason,
        crawlabilityStatus: input.crawlabilityStatus,
        crawlabilityHttpStatus: input.crawlabilityHttpStatus,
        crawlabilityDetails: input.crawlabilityDetails,
        sourceDomain: input.sourceDomain,
        recommendedMonitoringUrl: input.recommendedMonitoringUrl,
        duplicateStatus: input.duplicateStatus,
        duplicateOfCandidateId: input.duplicateOfCandidateId,
        duplicateReason: input.duplicateReason,
        rawBatchId: input.rawBatchId,
      };
      candidates.push(created);
      return { saved: true, duplicate: false, candidate: created };
    },
    markKeywordRun: async (id, added, ranAt) => {
      const kw = keywords.find((k) => k.id === id);
      if (kw) {
        kw.matchesFound += added;
        kw.lastRunAt = ranAt;
      }
    },
    createRawDiscoveryBatch: async (input) => {
      const now = new Date().toISOString();
      const b: DiscoveryRawBatch = {
        id: crypto.randomUUID(),
        provider: 'tavily',
        modelUsed: input.modelUsed,
        status: input.status,
        keywords: input.keywords,
        rawResults: input.rawResults,
        totalRawHits: input.rawResults.length,
        retryCount: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      batches.push(b);
      return b;
    },
    updateRawDiscoveryBatch: async (
      id,
      patch: {
        status?: RawBatchStatus;
        modelUsed?: string | null;
        keywords?: DiscoveryRawBatch['keywords'];
        retryCount?: number;
        lastError?: string | null;
      }
    ) => {
      const b = batches.find((item) => item.id === id);
      if (!b) return null;
      if (patch.status !== undefined) b.status = patch.status;
      if (patch.modelUsed !== undefined) b.modelUsed = patch.modelUsed;
      if (patch.keywords !== undefined) {
        b.keywords = patch.keywords;
        const hasDup = patch.keywords.some((k) => typeof k.duplicateHits === 'number');
        const hasQueued = patch.keywords.some((k) => typeof k.queuedNewHits === 'number');
        if (hasDup) {
          b.duplicateHits = patch.keywords.reduce((sum, k) => sum + (k.duplicateHits ?? 0), 0);
        }
        if (hasQueued) {
          b.queuedNewHits = patch.keywords.reduce((sum, k) => sum + (k.queuedNewHits ?? 0), 0);
        }
      }
      if (patch.retryCount !== undefined) b.retryCount = patch.retryCount;
      if (patch.lastError !== undefined) b.lastError = patch.lastError;
      b.updatedAt = new Date().toISOString();
      return b;
    },
    getRawDiscoveryBatch: async (id) => batches.find((b) => b.id === id) ?? null,
    listRawDiscoveryBatches: async (limit = 15) => batches.slice(0, limit),
    recordSystemLog: async (level, module, message, details = null) => {
      logs.push({ level, module, message, details });
    },
  };

  return { repo, candidates, batches, logs };
}

test('crawlabilityChecker detects accessible, cloudflare, login_wall, 404, empty_html_shell, static_pdf, and social_single_post', async () => {
  const acc = await probeUrlCrawlability('https://example.org/events', {
    fetchImpl: async () =>
      new Response(
        '<html><head><title>Competition Portal</title></head><body><h1>Active Competitions 2026</h1><p>Register before August 30, 2026 for national robotics and software challenges open to university students.</p></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      ),
  });
  assert.equal(acc.status, 'accessible');
  assert.equal(acc.httpStatus, 200);
  assert.ok(acc.extractedText.includes('Active Competitions'));

  const cf = await probeUrlCrawlability('https://protected.example.org', {
    fetchImpl: async () =>
      new Response('<html><body>Just a moment... _cf_chl_opt</body></html>', {
        status: 403,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
      }),
  });
  assert.equal(cf.status, 'cloudflare_challenge');

  const login = await probeUrlCrawlability('https://portal.example.org/private', {
    fetchImpl: async () =>
      new Response('<html><body>Please sign in to view this content</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  });
  assert.equal(login.status, 'login_wall');

  const notFound = await probeUrlCrawlability('https://example.org/missing', {
    fetchImpl: async () => new Response('Not found', { status: 404 }),
  });
  assert.equal(notFound.status, 'not_found_404');

  const spa = await probeUrlCrawlability('https://spa.example.org/', {
    fetchImpl: async () =>
      new Response('<html><body><div id="root"></div><noscript>Enable JavaScript</noscript></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  });
  assert.equal(spa.status, 'empty_html_shell');

  const pdf = await probeUrlCrawlability('https://kemdikbud.go.id/pedoman.pdf');
  assert.equal(pdf.status, 'static_pdf');

  const ig = await probeUrlCrawlability('https://www.instagram.com/p/C12345/');
  assert.equal(ig.status, 'social_single_post');
});

test('searchTavily passes time_range and exclude_domains cleanly', async () => {
  const prevKey = process.env.SEARCH_ENGINE_API_KEY;
  process.env.SEARCH_ENGINE_API_KEY = 'test_tavily_key_dummy';
  let capturedBody: Record<string, unknown> = {};

  try {
    await searchTavily({
      query: 'lomba programming mahasiswa Indonesia 2026',
      maxResults: 4,
      timeRange: 'month',
      excludeDomains: ['instagram.com', 'https://www.youtube.com/watch'],
      fetchImpl: async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(JSON.stringify({ query: 'ok', results: [] }), { status: 200 });
      },
    });
    assert.equal(capturedBody.time_range, 'month');
    assert.deepEqual(capturedBody.exclude_domains, ['instagram.com', 'www.youtube.com']);
  } finally {
    if (prevKey === undefined) delete process.env.SEARCH_ENGINE_API_KEY;
    else process.env.SEARCH_ENGINE_API_KEY = prevKey;
  }
});

// 26. Gemini 503 1x -> retry succeeds without re-calling Tavily
test('26. Gemini 503 transient failure retries once and succeeds without calling Tavily again', async () => {
  const { repo, batches, logs } = createInMemoryRepo();
  let tavilyCalls = 0;
  let geminiCalls = 0;

  const result = await runLiveSearchDiscovery(
    { maxKeywords: 1, maxResultsPerKeyword: 2 },
    {
      repo,
      bypassCooldown: true,
      isTavilyConfiguredFn: () => true,
      verifyGeminiModelFn: async () => 'gemini-4-hydrogen',
      searchTavilyFn: async ({ query }) => {
        tavilyCalls += 1;
        return {
          query,
          responseTimeSeconds: 0.2,
          results: [
            {
              title: 'Dev Events Asia Tech Hackathons',
              url: 'https://dev.events/AS',
              content: 'Upcoming developer conferences and hackathons in Asia.',
              score: 0.9,
              publishedDate: null,
            },
          ],
        };
      },
      probeBatchCrawlabilityFn: async (urls) =>
        new Map(
          urls.map((u) => [
            u,
            {
              url: u,
              finalUrl: u,
              status: 'accessible',
              httpStatus: 200,
              contentType: 'text/html',
              pageTitle: 'Dev Events Asia',
              extractedText: 'Developer conferences and hackathons directory.',
              details: 'Accessible (HTTP 200)',
            },
          ])
        ),
      classifyFn: async (items, opts) => {
        return classifySearchResultsWithGemini(items, {
          ...opts,
          baseDelayMs: 1,
          sleepFn: async () => {},
          verifyModelFn: async () => 'gemini-4-hydrogen',
          generateContentFn: async () => {
            geminiCalls += 1;
            if (geminiCalls === 1) {
              throw new Error('503 Service Unavailable UNAVAILABLE');
            }
            return JSON.stringify([
              {
                index: 0,
                classification: 'Aggregator',
                confidenceScore: 92,
                reason: 'Directory of recurring developer hackathons in Asia.',
                suggestedName: 'Dev Events Asia',
                organizer: 'dev.events',
                detectedType: 'website',
                temporalStatus: 'open',
                registrationOpenDate: null,
                registrationDeadline: null,
                competitionStartDate: null,
                competitionEndDate: null,
                eventYear: 2026,
                temporalEvidence: null,
                temporalConfidence: 70,
                targetAudience: 'university_student',
              },
            ]);
          },
        });
      },
    }
  );

  assert.equal(tavilyCalls, 1);
  assert.equal(geminiCalls, 2);
  assert.equal(result.retryCount, 1);
  assert.equal(result.savedCandidatesCount, 1);
  assert.equal(batches[0].status, 'completed');
  assert.ok(logs.some((l) => l.message.includes('Classification retry')));
});

// 27. Gemini 503 3x -> no fake candidates, batch classification_failed
test('27. Gemini 503 three times fails cleanly, creates zero fake candidates, and preserves raw batch as classification_failed', async () => {
  const { repo, candidates, batches, logs } = createInMemoryRepo();
  let geminiCalls = 0;

  await assert.rejects(
    () =>
      runLiveSearchDiscovery(
        { maxKeywords: 1, maxResultsPerKeyword: 2 },
        {
          repo,
          bypassCooldown: true,
          isTavilyConfiguredFn: () => true,
          verifyGeminiModelFn: async () => 'gemini-4-hydrogen',
          searchTavilyFn: async ({ query }) => ({
            query,
            responseTimeSeconds: 0.1,
            results: [
              {
                title: 'UI/UX Competition 2026',
                url: 'https://example.id/uiux-2026',
                content: 'Open registration until 2026-09-01',
                score: 0.85,
                publishedDate: null,
              },
            ],
          }),
          probeBatchCrawlabilityFn: async (urls) =>
            new Map(
              urls.map((u) => [
                u,
                {
                  url: u,
                  finalUrl: u,
                  status: 'accessible',
                  httpStatus: 200,
                  contentType: 'text/html',
                  pageTitle: 'UI/UX',
                  extractedText: 'Open registration until 2026-09-01',
                  details: 'OK',
                },
              ])
            ),
          classifyFn: async (items, opts) =>
            classifySearchResultsWithGemini(items, {
              ...opts,
              maxAttempts: 3,
              baseDelayMs: 1,
              sleepFn: async () => {},
              verifyModelFn: async () => 'gemini-4-hydrogen',
              generateContentFn: async () => {
                geminiCalls += 1;
                throw new Error('503 UNAVAILABLE');
              },
            }),
        }
      ),
    (err) => err instanceof GeminiClassifierError && err.statusCode === 503
  );

  assert.equal(geminiCalls, 3);
  assert.equal(candidates.length, 0);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].status, 'classification_failed');
  assert.equal(batches[0].rawResults.length, 1);
  assert.ok(logs.some((l) => l.message.includes('Classification failed')));
});

// 28. Permanent 401/403 API key failure does NOT retry
test('28. Gemini permanent 401/403 auth error fails immediately without retry', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      classifySearchResultsWithGemini(
        [
          {
            index: 0,
            keywordPhrase: 'hackathon',
            targetCategory: 'AI',
            hit: {
              title: 'Test Hackathon',
              url: 'https://example.org/hack',
              content: 'Hackathon info',
              score: 0.8,
              publishedDate: null,
            },
          },
        ],
        {
          maxAttempts: 3,
          baseDelayMs: 1,
          sleepFn: async () => {},
          verifyModelFn: async () => 'gemini-4-hydrogen',
          generateContentFn: async () => {
            calls += 1;
            throw new Error('403 PERMISSION_DENIED API_KEY_INVALID');
          },
        }
      ),
    (err) => err instanceof GeminiClassifierError && err.retryable === false
  );
  assert.equal(calls, 1);
});

// 29 & 30. Raw batch replay without calling Tavily + rerun idempotency (0 duplicates)
test('29-30. Failed raw batch replays without Tavily and subsequent replay inserts zero duplicates', async () => {
  const { repo, candidates, batches } = createInMemoryRepo();
  let tavilyCalls = 0;

  // Step 1: Run where Gemini fails 3x -> raw batch persisted before failure
  await assert.rejects(() =>
    runLiveSearchDiscovery(
      { maxKeywords: 1, maxResultsPerKeyword: 2 },
      {
        repo,
        bypassCooldown: true,
        isTavilyConfiguredFn: () => true,
        verifyGeminiModelFn: async () => 'gemini-4-hydrogen',
        searchTavilyFn: async ({ query }) => {
          tavilyCalls += 1;
          return {
            query,
            responseTimeSeconds: 0.1,
            results: [
              {
                title: 'KabarLomba Directory',
                url: 'https://kabarlomba.com/',
                content: 'Informasi lomba mahasiswa nasional terbaru.',
                score: 0.9,
                publishedDate: null,
              },
            ],
          };
        },
        probeBatchCrawlabilityFn: async (urls) =>
          new Map(
            urls.map((u) => [
              u,
              {
                url: u,
                finalUrl: u,
                status: 'accessible',
                httpStatus: 200,
                contentType: 'text/html',
                pageTitle: 'KabarLomba',
                extractedText: 'Portal informasi lomba mahasiswa nasional.',
                details: 'OK',
              },
            ])
          ),
        classifyFn: async (items, opts) =>
          classifySearchResultsWithGemini(items, {
            ...opts,
            maxAttempts: 3,
            baseDelayMs: 1,
            sleepFn: async () => {},
            verifyModelFn: async () => 'gemini-4-hydrogen',
            generateContentFn: async () => {
              throw new Error('503 UNAVAILABLE');
            },
          }),
      }
    )
  );

  assert.equal(tavilyCalls, 1);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].status, 'classification_failed');

  // Step 2: Replay raw batch without calling Tavily at all
  const replayRes = await retryRawBatchClassification(batches[0].id, {
    repo,
    bypassCooldown: true,
    searchTavilyFn: async () => {
      throw new Error('Tavily MUST NOT be called during raw batch replay!');
    },
    probeBatchCrawlabilityFn: async (urls) =>
      new Map(
        urls.map((u) => [
          u,
          {
            url: u,
            finalUrl: u,
            status: 'accessible',
            httpStatus: 200,
            contentType: 'text/html',
            pageTitle: 'KabarLomba',
            extractedText: 'Portal informasi lomba mahasiswa nasional.',
            details: 'OK',
          },
        ])
      ),
    classifyFn: async (items, opts) =>
      classifySearchResultsWithGemini(items, {
        ...opts,
        verifyModelFn: async () => 'gemini-4-hydrogen',
        generateContentFn: async () =>
          JSON.stringify([
            {
              index: 0,
              classification: 'Aggregator',
              confidenceScore: 94,
              reason: 'Indonesian competition aggregator portal.',
              suggestedName: 'KabarLomba',
              organizer: 'kabarlomba.com',
              detectedType: 'website',
              temporalStatus: 'open',
              registrationOpenDate: null,
              registrationDeadline: null,
              competitionStartDate: null,
              competitionEndDate: null,
              eventYear: 2026,
              temporalEvidence: null,
              temporalConfidence: 80,
              targetAudience: 'university_student',
            },
          ]),
      }),
  });

  assert.equal(tavilyCalls, 1);
  assert.equal(replayRes.savedCandidatesCount, 1);
  assert.equal(batches[0].status, 'completed');
  assert.equal(candidates.length, 1);

  // Step 3: Replay again -> Level A dedup catches already-saved URL, zero new inserts
  const rerunRes = await retryRawBatchClassification(batches[0].id, {
    repo,
    bypassCooldown: true,
    searchTavilyFn: async () => {
      throw new Error('Tavily MUST NOT be called on idempotent replay!');
    },
  });
  assert.equal(rerunRes.savedCandidatesCount, 0);
  assert.equal(rerunRes.duplicatesSkipped, 1);
  assert.equal(candidates.length, 1);
});

// 31. End-to-end pipeline: campus achievement news article vs active campus competition portal
test('31. Pipeline classifies campus achievement article as non-monitorable event while preserving campus competition portal as eligible source', async () => {
  const { repo, candidates } = createInMemoryRepo();

  const res = await runLiveSearchDiscovery(
    { maxKeywords: 1, maxResultsPerKeyword: 2 },
    {
      repo,
      bypassCooldown: true,
      isTavilyConfiguredFn: () => true,
      verifyGeminiModelFn: async () => 'gemini-4-hydrogen',
      searchTavilyFn: async ({ query }) => ({
        query,
        responseTimeSeconds: 0.2,
        results: [
          {
            title: 'Gagas Bisnis UMKM, Mahasiswa UNPAR Juara 3 National Business Plan Competition',
            url: 'https://unpar.ac.id/gagas-bisnis-umkm-mahasiswa-unpar-juara-3-national-business-plan-competition',
            content: 'Mahasiswa UNPAR meraih juara 3 National Business Plan Competition tahun 2022.',
            score: 0.88,
            publishedDate: null,
          },
          {
            title: 'Portal Kompetisi Mahasiswa ITB',
            url: 'https://kompetisi.itb.ac.id/',
            content: 'Portal resmi informasi lomba dan kompetisi mahasiswa ITB.',
            score: 0.91,
            publishedDate: null,
          },
        ],
      }),
      probeBatchCrawlabilityFn: async (urls) =>
        new Map(
          urls.map((u) => [
            u,
            {
              url: u,
              finalUrl: u,
              status: 'accessible',
              httpStatus: 200,
              contentType: 'text/html',
              pageTitle: u.includes('unpar')
                ? 'Mahasiswa UNPAR Juara 3 National Business Plan Competition'
                : 'Portal Kompetisi Mahasiswa ITB',
              extractedText: u.includes('unpar')
                ? 'Tim mahasiswa UNPAR berhasil meraih juara 3 pada tahun 2022.'
                : 'Daftar kompetisi aktif mahasiswa ITB.',
              details: 'Accessible (HTTP 200)',
            },
          ])
        ),
      classifyFn: async (items, opts) =>
        classifySearchResultsWithGemini(items, {
          ...opts,
          verifyModelFn: async () => 'gemini-4-hydrogen',
          generateContentFn: async () =>
            JSON.stringify([
              {
                index: 0,
                classification: 'University',
                confidenceScore: 84,
                reason: 'University news article reporting past competition winner.',
                suggestedName: 'UNPAR Juara 3 Business Plan 2022',
                organizer: 'UNPAR',
                detectedType: 'public_portal',
                temporalStatus: 'completed',
                registrationOpenDate: null,
                registrationDeadline: null,
                competitionStartDate: null,
                competitionEndDate: null,
                eventYear: 2022,
                temporalEvidence: '2022 winner news',
                temporalConfidence: 90,
                targetAudience: 'university_student',
              },
              {
                index: 1,
                classification: 'University',
                confidenceScore: 93,
                reason: 'Official university competition portal.',
                suggestedName: 'Portal Kompetisi Mahasiswa ITB',
                organizer: 'ITB',
                detectedType: 'public_portal',
                temporalStatus: 'open',
                registrationOpenDate: null,
                registrationDeadline: null,
                competitionStartDate: null,
                competitionEndDate: null,
                eventYear: 2026,
                temporalEvidence: 'Active 2026 competition directory',
                temporalConfidence: 85,
                targetAudience: 'university_student',
              },
            ]),
        }),
    }
  );

  assert.equal(res.savedCandidatesCount, 2);
  const unparCand = candidates.find((c) => c.url.includes('unpar.ac.id'));
  const itbCand = candidates.find((c) => c.url.includes('kompetisi.itb.ac.id'));
  assert.ok(unparCand);
  assert.ok(itbCand);

  assert.equal(unparCand.candidateKind, 'event');
  assert.equal(unparCand.isMonitorable, false);
  assert.equal(unparCand.monitoringEligibility, 'ineligible');
  assert.equal(unparCand.recommendedMonitoringUrl, null);

  assert.equal(itbCand.candidateKind, 'source');
  assert.equal(itbCand.isMonitorable, true);
  assert.equal(itbCand.monitoringEligibility, 'eligible');
});

// 32. mapCandidateRow safely recovers [p2b1:...] fallback for pre-migration rows without overriding valid native values
test('32. mapCandidateRow recovers legacy [p2b1:...] metadata when native columns hold migration defaults, and prefers valid native columns otherwise', () => {
  const legacyRow = mapCandidateRow({
    id: 'cand-legacy-1',
    suggested_name: 'Dev Events Asia',
    url: 'https://dev.events/AS',
    organizer: 'dev.events',
    detected_type: 'website',
    discovery_method: 'search_engine',
    matched_keyword: 'hackathon',
    category: 'AI',
    confidence_note:
      '[Aggregator · 92%] Directory\n[p2b1:{"cl":"Aggregator","cs":92,"ck":"source","ts":"open","ta":"university_student","ac":true,"im":true,"ir":true,"me":"eligible","cr":"accessible","ds":"unique"}]',
    status: 'candidate',
    data_origin: 'tavily_discovery',
    discovered_at: '2026-06-10T00:00:00Z',
    // Migration 002 defaults on pre-existing row:
    classification: null,
    confidence_score: null,
    candidate_kind: 'unknown',
    temporal_status: 'unknown',
    target_audience: 'unknown',
    audience_compatible: null,
    is_monitorable: false,
    is_recurring_source: false,
    monitoring_eligibility: 'unknown',
    crawlability_status: 'unknown',
    duplicate_status: 'unknown',
  });

  assert.equal(legacyRow.confidenceNote, '[Aggregator · 92%] Directory');
  assert.equal(legacyRow.classification, 'Aggregator');
  assert.equal(legacyRow.candidateKind, 'source');
  assert.equal(legacyRow.temporalStatus, 'open');
  assert.equal(legacyRow.targetAudience, 'university_student');
  assert.equal(legacyRow.audienceCompatible, true);
  assert.equal(legacyRow.isMonitorable, true);
  assert.equal(legacyRow.isRecurringSource, true);
  assert.equal(legacyRow.monitoringEligibility, 'eligible');
  assert.equal(legacyRow.crawlabilityStatus, 'accessible');
  assert.equal(legacyRow.duplicateStatus, 'unique');

  // When native columns have valid non-default values, native columns MUST take precedence
  const nativeRow = mapCandidateRow({
    id: 'cand-native-1',
    suggested_name: 'Native Backfilled Row',
    url: 'https://unpar.ac.id/news-1',
    organizer: 'UNPAR',
    detected_type: 'public_portal',
    discovery_method: 'search_engine',
    matched_keyword: 'business plan',
    category: 'Business',
    confidence_note:
      '[University · 85%] Native\n[p2b1:{"ck":"source","im":true,"ir":true,"me":"eligible","ts":"open"}]',
    status: 'candidate',
    data_origin: 'tavily_discovery',
    discovered_at: '2026-06-18T00:00:00Z',
    classification: 'University',
    confidence_score: 85,
    candidate_kind: 'event',
    temporal_status: 'completed',
    target_audience: 'university_student',
    audience_compatible: true,
    is_monitorable: false,
    is_recurring_source: false,
    monitoring_eligibility: 'ineligible',
    crawlability_status: 'accessible',
    duplicate_status: 'unique',
  });

  assert.equal(nativeRow.candidateKind, 'event');
  assert.equal(nativeRow.temporalStatus, 'completed');
  assert.equal(nativeRow.isMonitorable, false);
  assert.equal(nativeRow.isRecurringSource, false);
  assert.equal(nativeRow.monitoringEligibility, 'ineligible');
});

// 33. Raw Tavily auditability: 12 raw hits, 7 duplicates, 5 new URLs
test('33. Raw batch persists ALL 12 Tavily hits before Level A dedup while queuing only 5 new URLs to Gemini', async () => {
  const preExistingSources: CompetitionSource[] = Array.from({ length: 7 }, (_, i) => ({
    id: `src-dup-${i}`,
    name: `Known Aggregator ${i}`,
    url: `https://known-agg-${i}.example.org/events`,
    sourceType: 'website',
    discoveryMethod: 'search_engine',
    monitoringMethod: 'polling',
    category: 'Programming',
    priority: 'medium',
    status: 'active',
    pollingIntervalMinutes: 360,
    lastCheckedAt: null,
    lastSuccessfulCheckAt: null,
    errorInfo: null,
    contentFingerprint: null,
    dataOrigin: 'user_created',
    createdAt: '2026-06-01T00:00:00Z',
  }));

  const { repo, candidates, batches, logs } = createInMemoryRepo({
    sources: preExistingSources,
  });

  const tavily12Hits = [
    ...Array.from({ length: 7 }, (_, i) => ({
      title: `Known Source ${i}`,
      url: `https://known-agg-${i}.example.org/events?utm_source=tavily`,
      content: 'Existing competition portal.',
      score: 0.9,
      publishedDate: null,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      title: `New Portal ${i}`,
      url: `https://new-hub-${i}.example.id/`,
      content: 'Directory of university tech competitions in Indonesia 2026.',
      score: 0.88,
      publishedDate: null,
    })),
  ];

  let probedUrls: string[] = [];
  let geminiItemIndices: number[] = [];

  const res = await runLiveSearchDiscovery(
    { maxKeywords: 1, maxResultsPerKeyword: 5 },
    {
      repo,
      bypassCooldown: true,
      isTavilyConfiguredFn: () => true,
      verifyGeminiModelFn: async () => 'gemini-4-hydrogen',
      searchTavilyFn: async ({ query }) => ({
        query,
        responseTimeSeconds: 0.2,
        results: tavily12Hits,
      }),
      probeBatchCrawlabilityFn: async (urls) => {
        probedUrls = urls;
        return new Map(
          urls.map((u) => [
            u,
            {
              url: u,
              finalUrl: u,
              status: 'accessible',
              httpStatus: 200,
              contentType: 'text/html',
              pageTitle: 'New Competition Portal',
              extractedText: 'Active competitions open for university students in 2026.',
              details: 'Accessible (HTTP 200)',
            },
          ])
        );
      },
      classifyFn: async (items, opts) => {
        geminiItemIndices = items.map((it) => it.index);
        return classifySearchResultsWithGemini(items, {
          ...opts,
          verifyModelFn: async () => 'gemini-4-hydrogen',
          generateContentFn: async () =>
            JSON.stringify(
              items.map((it, idx) => ({
                index: it.index,
                classification: 'Organizer',
                confidenceScore: 90,
                reason: `Active competition hub ${idx}.`,
                suggestedName: `New Hub ${idx}`,
                organizer: `Organizer ${idx}`,
                detectedType: 'website',
                temporalStatus: 'open',
                registrationOpenDate: null,
                registrationDeadline: null,
                competitionStartDate: null,
                competitionEndDate: null,
                eventYear: 2026,
                temporalEvidence: 'Open 2026',
                temporalConfidence: 85,
                targetAudience: 'university_student',
              }))
            ),
        });
      },
    }
  );

  // Proof 1: raw batch stored ALL 12 hits BEFORE Level A dedup
  assert.equal(batches.length, 1);
  assert.equal(batches[0].rawResults.length, 12);
  assert.equal(batches[0].totalRawHits, 12);
  assert.equal(batches[0].duplicateHits, 7);
  assert.equal(batches[0].queuedNewHits, 5);

  // Proof 2: Level A dedup filtered 7 duplicates BEFORE crawlability probe and BEFORE Gemini
  assert.equal(probedUrls.length, 5);
  assert.equal(geminiItemIndices.length, 5);

  // Proof 3: Separated metrics in API response and system logs
  assert.equal(res.totalResultsFound, 12);
  assert.equal(res.totalRawHits, 12);
  assert.equal(res.duplicateHits, 7);
  assert.equal(res.queuedNewHits, 5);
  assert.deepEqual(res.rawBatchMetrics, {
    total_raw_hits: 12,
    duplicate_hits: 7,
    queued_new_hits: 5,
  });
  assert.equal(res.duplicatesSkipped, 7);
  assert.equal(res.savedCandidatesCount, 5);
  assert.equal(candidates.length, 5);
  assert.ok(
    logs.some((l) =>
      l.message.includes('total_raw_hits=12, duplicate_hits=7, queued_new_hits=5')
    )
  );
});

// 34. Raw Tavily auditability: 12 raw hits, ALL 12 duplicates -> 12 saved in raw batch, 0 Gemini calls
test('34. When all 12 Tavily hits are duplicates, all 12 raw hits still persist to raw batch and Gemini is skipped cleanly', async () => {
  const preExistingSources: CompetitionSource[] = Array.from({ length: 12 }, (_, i) => ({
    id: `src-alldup-${i}`,
    name: `Existing Hub ${i}`,
    url: `https://alldup-${i}.example.org/`,
    sourceType: 'website',
    discoveryMethod: 'search_engine',
    monitoringMethod: 'polling',
    category: 'Programming',
    priority: 'medium',
    status: 'active',
    pollingIntervalMinutes: 360,
    lastCheckedAt: null,
    lastSuccessfulCheckAt: null,
    errorInfo: null,
    contentFingerprint: null,
    dataOrigin: 'user_created',
    createdAt: '2026-06-01T00:00:00Z',
  }));

  const { repo, candidates, batches } = createInMemoryRepo({
    sources: preExistingSources,
  });

  let probeCalls = 0;
  let geminiCalls = 0;

  const res = await runLiveSearchDiscovery(
    { maxKeywords: 1, maxResultsPerKeyword: 5 },
    {
      repo,
      bypassCooldown: true,
      isTavilyConfiguredFn: () => true,
      verifyGeminiModelFn: async () => 'gemini-4-hydrogen',
      searchTavilyFn: async ({ query }) => ({
        query,
        responseTimeSeconds: 0.15,
        results: Array.from({ length: 12 }, (_, i) => ({
          title: `Existing Hub ${i}`,
          url: `https://www.alldup-${i}.example.org/?utm_medium=search`,
          content: 'Already registered source.',
          score: 0.9,
          publishedDate: null,
        })),
      }),
      probeBatchCrawlabilityFn: async () => {
        probeCalls += 1;
        return new Map();
      },
      classifyFn: async () => {
        geminiCalls += 1;
        throw new Error('Gemini MUST NOT be called when all 12 hits are Level A duplicates!');
      },
    }
  );

  assert.equal(batches.length, 1);
  assert.equal(batches[0].rawResults.length, 12);
  assert.equal(batches[0].totalRawHits, 12);
  assert.equal(batches[0].duplicateHits, 12);
  assert.equal(batches[0].queuedNewHits, 0);
  assert.equal(batches[0].status, 'completed');

  assert.equal(probeCalls, 0);
  assert.equal(geminiCalls, 0);
  assert.equal(res.totalRawHits, 12);
  assert.equal(res.duplicateHits, 12);
  assert.equal(res.queuedNewHits, 0);
  assert.equal(res.duplicatesSkipped, 12);
  assert.equal(res.savedCandidatesCount, 0);
  assert.equal(candidates.length, 0);
});

// 35. Replay of 12-hit failed raw batch (7 known + 5 new) preserves total_raw_hits=12, skips Tavily, and never duplicates candidates
test('35. Replay of 12-hit raw batch after Gemini 503 failure does not call Tavily, keeps total_raw_hits=12, and never duplicates candidates on repeat replay', async () => {
  const preExistingSources: CompetitionSource[] = Array.from({ length: 7 }, (_, i) => ({
    id: `src-replay-dup-${i}`,
    name: `Preexisting Source ${i}`,
    url: `https://replay-known-${i}.example.org/`,
    sourceType: 'website',
    discoveryMethod: 'search_engine',
    monitoringMethod: 'polling',
    category: 'AI',
    priority: 'medium',
    status: 'active',
    pollingIntervalMinutes: 360,
    lastCheckedAt: null,
    lastSuccessfulCheckAt: null,
    errorInfo: null,
    contentFingerprint: null,
    dataOrigin: 'user_created',
    createdAt: '2026-06-01T00:00:00Z',
  }));

  const { repo, candidates, batches } = createInMemoryRepo({
    sources: preExistingSources,
  });

  let tavilyCalls = 0;

  const hits12 = [
    ...Array.from({ length: 7 }, (_, i) => ({
      title: `Preexisting Source ${i}`,
      url: `https://replay-known-${i}.example.org/`,
      content: 'Known portal.',
      score: 0.9,
      publishedDate: null,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      title: `Fresh Portal ${i}`,
      url: `https://fresh-portal-${i}.example.id/`,
      content: 'Active national competition directory 2026.',
      score: 0.89,
      publishedDate: null,
    })),
  ];

  // Step 1: Initial run persists all 12 raw hits, then fails after 3 Gemini 503 retries
  await assert.rejects(() =>
    runLiveSearchDiscovery(
      { maxKeywords: 1, maxResultsPerKeyword: 5 },
      {
        repo,
        bypassCooldown: true,
        isTavilyConfiguredFn: () => true,
        verifyGeminiModelFn: async () => 'gemini-4-hydrogen',
        searchTavilyFn: async ({ query }) => {
          tavilyCalls += 1;
          return {
            query,
            responseTimeSeconds: 0.2,
            results: hits12,
          };
        },
        probeBatchCrawlabilityFn: async (urls) =>
          new Map(
            urls.map((u) => [
              u,
              {
                url: u,
                finalUrl: u,
                status: 'accessible',
                httpStatus: 200,
                contentType: 'text/html',
                pageTitle: 'Fresh Portal',
                extractedText: 'Active competitions 2026.',
                details: 'OK',
              },
            ])
          ),
        classifyFn: async (items, opts) =>
          classifySearchResultsWithGemini(items, {
            ...opts,
            maxAttempts: 3,
            baseDelayMs: 1,
            sleepFn: async () => {},
            verifyModelFn: async () => 'gemini-4-hydrogen',
            generateContentFn: async () => {
              throw new Error('503 Service Unavailable');
            },
          }),
      }
    )
  );

  assert.equal(tavilyCalls, 1);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].status, 'classification_failed');
  assert.equal(batches[0].rawResults.length, 12);
  assert.equal(batches[0].totalRawHits, 12);
  assert.equal(candidates.length, 0);

  // Step 2: Replay raw batch -> Tavily MUST NOT be called, only 5 new URLs sent to Gemini
  let replayGeminiCount = 0;
  const replayRes = await retryRawBatchClassification(batches[0].id, {
    repo,
    bypassCooldown: true,
    searchTavilyFn: async () => {
      throw new Error('Tavily MUST NOT be called during raw batch replay!');
    },
    probeBatchCrawlabilityFn: async (urls) =>
      new Map(
        urls.map((u) => [
          u,
          {
            url: u,
            finalUrl: u,
            status: 'accessible',
            httpStatus: 200,
            contentType: 'text/html',
            pageTitle: 'Fresh Portal',
            extractedText: 'Active competitions 2026.',
            details: 'OK',
          },
        ])
      ),
    classifyFn: async (items, opts) => {
      replayGeminiCount = items.length;
      return classifySearchResultsWithGemini(items, {
        ...opts,
        verifyModelFn: async () => 'gemini-4-hydrogen',
        generateContentFn: async () =>
          JSON.stringify(
            items.map((it, idx) => ({
              index: it.index,
              classification: 'Organizer',
              confidenceScore: 91,
              reason: `Fresh portal ${idx}.`,
              suggestedName: `Fresh Portal ${idx}`,
              organizer: `Org ${idx}`,
              detectedType: 'website',
              temporalStatus: 'open',
              registrationOpenDate: null,
              registrationDeadline: null,
              competitionStartDate: null,
              competitionEndDate: null,
              eventYear: 2026,
              temporalEvidence: 'Open 2026',
              temporalConfidence: 85,
              targetAudience: 'university_student',
            }))
          ),
      });
    },
  });

  assert.equal(tavilyCalls, 1);
  assert.equal(replayGeminiCount, 5);
  assert.equal(batches[0].totalRawHits, 12);
  assert.equal(batches[0].status, 'completed');
  assert.equal(replayRes.totalRawHits, 12);
  assert.equal(replayRes.duplicateHits, 7);
  assert.equal(replayRes.queuedNewHits, 5);
  assert.equal(replayRes.savedCandidatesCount, 5);
  assert.equal(candidates.length, 5);

  // Step 3: Second replay -> all 12 now known -> 0 Gemini calls, 0 new inserts, totalRawHits still 12
  const secondReplay = await retryRawBatchClassification(batches[0].id, {
    repo,
    bypassCooldown: true,
    searchTavilyFn: async () => {
      throw new Error('Tavily MUST NOT be called on repeat replay!');
    },
    classifyFn: async () => {
      throw new Error('Gemini MUST NOT be called when all URLs in batch are already saved!');
    },
  });

  assert.equal(secondReplay.totalRawHits, 12);
  assert.equal(secondReplay.duplicateHits, 12);
  assert.equal(secondReplay.queuedNewHits, 0);
  assert.equal(secondReplay.savedCandidatesCount, 0);
  assert.equal(secondReplay.duplicatesSkipped, 12);
  assert.equal(candidates.length, 5);
});

// 36. mapCandidateRow maps rss_feed_id (UUID, null, omitted) to rssFeedId while preserving legacy fields
test('36. mapCandidateRow maps rss_feed_id UUID, null, and omitted cleanly to rssFeedId without affecting legacy fields', () => {
  const feedUuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

  const withFeedUuid = mapCandidateRow({
    id: 'cand-rss-1',
    suggested_name: 'GEMASTIK 2027 Feed Item',
    url: 'https://kemahasiswaan.kampus.ac.id/lomba/gemastik-2027',
    organizer: 'Kemahasiswaan Kampus',
    detected_type: 'website',
    discovery_method: 'rss_autodiscovery',
    matched_keyword: 'gemastik',
    category: 'Programming',
    confidence_note: '[Competition · 95%] Active university competition.',
    status: 'candidate',
    data_origin: 'supabase_db',
    discovered_at: '2026-11-20T09:00:00Z',
    classification: 'Competition',
    confidence_score: 95,
    candidate_kind: 'event',
    temporal_status: 'open',
    target_audience: 'university_student',
    audience_compatible: true,
    is_monitorable: false,
    is_recurring_source: false,
    monitoring_eligibility: 'ineligible',
    crawlability_status: 'accessible',
    duplicate_status: 'unique',
    raw_batch_id: '11111111-2222-3333-4444-555555555555',
    rss_feed_id: feedUuid,
  });

  assert.equal(withFeedUuid.rssFeedId, feedUuid);
  assert.equal(withFeedUuid.rawBatchId, '11111111-2222-3333-4444-555555555555');
  assert.equal(withFeedUuid.discoveryMethod, 'rss_autodiscovery');
  assert.equal(withFeedUuid.classification, 'Competition');

  const withNullFeed = mapCandidateRow({
    id: 'cand-rss-null',
    suggested_name: 'Tavily Search Candidate',
    url: 'https://example.org/lomba-2027',
    organizer: 'Example Org',
    detected_type: 'website',
    discovery_method: 'search_engine',
    matched_keyword: 'lomba',
    category: 'General',
    confidence_note: 'Search candidate',
    status: 'candidate',
    data_origin: 'tavily_discovery',
    discovered_at: '2026-11-20T09:00:00Z',
    rss_feed_id: null,
  });

  assert.equal(withNullFeed.rssFeedId, null);
  assert.equal(withNullFeed.suggestedName, 'Tavily Search Candidate');

  const withoutFeedColumn = mapCandidateRow({
    id: 'cand-pre-003',
    suggested_name: 'Legacy Pre-003 Candidate',
    url: 'https://legacy.example.org/portal',
    organizer: 'Legacy Org',
    detected_type: 'public_portal',
    discovery_method: 'search_engine',
    matched_keyword: 'hackathon',
    category: 'AI',
    confidence_note:
      '[Aggregator · 88%] Legacy portal\n[p2b1:{"cl":"Aggregator","cs":88,"ck":"source","ts":"open","im":true,"me":"eligible"}]',
    status: 'candidate',
    data_origin: 'tavily_discovery',
    discovered_at: '2026-06-01T00:00:00Z',
  });

  assert.equal(withoutFeedColumn.rssFeedId, null);
  assert.equal(withoutFeedColumn.confidenceNote, '[Aggregator · 88%] Legacy portal');
  assert.equal(withoutFeedColumn.classification, 'Aggregator');
  assert.equal(withoutFeedColumn.candidateKind, 'source');
  assert.equal(withoutFeedColumn.isMonitorable, true);
  assert.equal(withoutFeedColumn.monitoringEligibility, 'eligible');
});



