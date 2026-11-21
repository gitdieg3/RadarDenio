import type {
  DiscoveryRawBatch,
  DiscoveryRunCandidatePreview,
  DiscoveryRunKeywordSummary,
  DiscoveryRunRequest,
  DiscoveryRunResult,
  LogLevel,
  RawBatchSearchHit,
} from '../../src/types/radar.ts';
import {
  detectIndividualNewsOrResultArticle,
  detectThreeLevelDuplicate,
  evaluateCandidateKindAndEligibility,
  evaluateTargetAudienceCompatibility,
  evaluateTemporalStatus,
  extractSourceDomain,
  getJakartaDateTimeContext,
  resolveClassificationDeterministic,
  resolveDetectedTypeDeterministic,
  type DeduplicationCandidateRecord,
} from '../../src/utils/discoveryQuality.ts';
import {
  buildDiscoveryQuery,
  clampDiscoveryRunLimits,
  normalizeDiscoveryUrl,
} from '../../src/utils/radarLogic.ts';
import {
  radarRepository,
  SupabaseRepositoryError,
  type SaveDiscoveredCandidateInput,
} from '../repositories/radarRepository.ts';
import {
  probeBatchCrawlability,
  type CrawlabilityProbeResult,
} from './crawlabilityChecker.ts';
import {
  classifySearchResultsWithGemini,
  GeminiClassifierError,
  verifyDiscoveryGeminiModel,
} from './discoveryClassifier.ts';
import { isTavilyConfigured, searchTavily, TavilyApiError } from './tavilyClient.ts';

export class DiscoveryOrchestrationError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'DiscoveryOrchestrationError';
    this.statusCode = statusCode;
  }
}

export interface DiscoveryRepositoryPort {
  listEnabledKeywords: typeof radarRepository.listEnabledKeywords;
  getKnownNormalizedUrls: typeof radarRepository.getKnownNormalizedUrls;
  listSources: typeof radarRepository.listSources;
  listCandidatesForDedup: typeof radarRepository.listCandidatesForDedup;
  saveDiscoveredCandidate: (
    input: SaveDiscoveredCandidateInput
  ) => ReturnType<typeof radarRepository.saveDiscoveredCandidate>;
  markKeywordRun: typeof radarRepository.markKeywordRun;
  createRawDiscoveryBatch: typeof radarRepository.createRawDiscoveryBatch;
  updateRawDiscoveryBatch: typeof radarRepository.updateRawDiscoveryBatch;
  getRawDiscoveryBatch: typeof radarRepository.getRawDiscoveryBatch;
  listRawDiscoveryBatches: typeof radarRepository.listRawDiscoveryBatches;
  recordSystemLog: (
    level: LogLevel,
    module: string,
    message: string,
    details?: string | null
  ) => Promise<void>;
}

export interface DiscoveryPipelineDependencies {
  repo?: DiscoveryRepositoryPort;
  isTavilyConfiguredFn?: () => boolean;
  searchTavilyFn?: typeof searchTavily;
  verifyGeminiModelFn?: () => Promise<string>;
  probeBatchCrawlabilityFn?: (urls: string[]) => Promise<Map<string, CrawlabilityProbeResult>>;
  classifyFn?: typeof classifySearchResultsWithGemini;
  jakartaNow?: Date;
  bypassCooldown?: boolean;
}

let isRunInFlight = false;
let lastCompletedRunAtMs = 0;
let lastDiscoveryRun: DiscoveryRunResult | null = null;
const recentRunTimestamps: number[] = [];

const MIN_COOLDOWN_MS = 3_000;
const RATE_WINDOW_MS = 5 * 60_000;
const MAX_RUNS_PER_WINDOW = 12;

export function getLastDiscoveryRun(): DiscoveryRunResult | null {
  return lastDiscoveryRun;
}

function getDefaultDeps(deps?: DiscoveryPipelineDependencies) {
  return {
    repo: deps?.repo ?? radarRepository,
    isTavilyConfiguredFn: deps?.isTavilyConfiguredFn ?? isTavilyConfigured,
    searchTavilyFn: deps?.searchTavilyFn ?? searchTavily,
    verifyGeminiModelFn: deps?.verifyGeminiModelFn ?? verifyDiscoveryGeminiModel,
    probeBatchCrawlabilityFn:
      deps?.probeBatchCrawlabilityFn ?? ((urls: string[]) => probeBatchCrawlability(urls)),
    classifyFn: deps?.classifyFn ?? classifySearchResultsWithGemini,
    jakartaNow: deps?.jakartaNow,
    bypassCooldown: deps?.bypassCooldown ?? false,
  };
}

async function processRawHitsPipeline(params: {
  batch: DiscoveryRawBatch;
  keywordSummaries: DiscoveryRunKeywordSummary[];
  knownNormalizedUrls: Set<string>;
  executedAt: string;
  firstSearchError: string | null;
  deps: ReturnType<typeof getDefaultDeps>;
}): Promise<DiscoveryRunResult> {
  const { batch, keywordSummaries, knownNormalizedUrls, executedAt, firstSearchError, deps } =
    params;
  const previewItems: DiscoveryRunCandidatePreview[] = [];
  let duplicatesSkipped = 0;
  let levelADuplicateHits = 0;

  const wibCtx = getJakartaDateTimeContext(deps.jakartaNow);
  let relevantCount = 0;
  let savedCandidatesCount = 0;
  let rejectedIrrelevantCount = 0;
  let retryCount = batch.retryCount;

  const perKeywordDupCounts = new Map<string, number>();
  const perKeywordQueuedCounts = new Map<string, number>();

  // Level A exact-URL deduplication runs BEFORE crawlability probes and BEFORE Gemini classification
  // (applies consistently to both initial live runs and raw batch replays)
  const hitsToEvaluate: RawBatchSearchHit[] = [];
  for (const rawHit of batch.rawResults) {
    const norm = rawHit.normalizedUrl || normalizeDiscoveryUrl(rawHit.hit.url);
    if (!norm) continue;
    if (knownNormalizedUrls.has(norm)) {
      duplicatesSkipped += 1;
      levelADuplicateHits += 1;
      perKeywordDupCounts.set(
        rawHit.keywordId,
        (perKeywordDupCounts.get(rawHit.keywordId) ?? 0) + 1
      );
      const kwSum = keywordSummaries.find((s) => s.keywordId === rawHit.keywordId);
      if (kwSum) kwSum.duplicateCount += 1;
      previewItems.push({
        title: rawHit.hit.title,
        url: rawHit.hit.url,
        normalizedUrl: norm,
        matchedKeyword: rawHit.keywordPhrase,
        classification: 'Organizer',
        confidenceScore: 100,
        reason: 'Level A exact URL already exists in Discovery Candidates or Source Registry.',
        outcome: 'duplicate',
        duplicateStatus: 'confirmed_duplicate',
        sourceDomain: extractSourceDomain(rawHit.hit.url),
      });
      continue;
    }
    knownNormalizedUrls.add(norm);
    perKeywordQueuedCounts.set(
      rawHit.keywordId,
      (perKeywordQueuedCounts.get(rawHit.keywordId) ?? 0) + 1
    );
    hitsToEvaluate.push({ ...rawHit, normalizedUrl: norm });
  }

  const totalRawHits = batch.totalRawHits;
  const queuedNewHits = hitsToEvaluate.length;
  const updatedBatchKeywords: DiscoveryRawBatch['keywords'] = batch.keywords.map((kwMeta) => ({
    ...kwMeta,
    duplicateHits: perKeywordDupCounts.get(kwMeta.keywordId) ?? 0,
    queuedNewHits: perKeywordQueuedCounts.get(kwMeta.keywordId) ?? 0,
  }));

  await deps.repo.recordSystemLog(
    'info',
    'SourceDiscovery',
    `Level A deduplication result: total_raw_hits=${totalRawHits}, duplicate_hits=${levelADuplicateHits}, queued_new_hits=${queuedNewHits}.`
  );

  let modelUsed = batch.modelUsed ?? 'gemini-4-hydrogen';

  if (hitsToEvaluate.length > 0) {
    await deps.repo.updateRawDiscoveryBatch(batch.id, {
      status: 'classifying',
      keywords: updatedBatchKeywords,
    });

    // 1. Polite single-GET crawlability checks + page text snippet extraction
    const crawlMap = await deps.probeBatchCrawlabilityFn(hitsToEvaluate.map((h) => h.hit.url));
    const accessibleCount = Array.from(crawlMap.values()).filter(
      (c) => c.status === 'accessible' || c.status === 'redirect'
    ).length;

    await deps.repo.recordSystemLog(
      'info',
      'SourceDiscovery',
      `Crawlability result: ${accessibleCount}/${hitsToEvaluate.length} URLs accessible.`,
      Array.from(crawlMap.entries())
        .slice(0, 8)
        .map(([u, r]) => `${extractSourceDomain(u) || u}: ${r.status}`)
        .join(' | ')
    );

    // 2. Gemini structured classification with transient-only backoff retry
    await deps.repo.recordSystemLog(
      'info',
      'SourceDiscovery',
      `Classification started for ${hitsToEvaluate.length} hits (batch ${batch.id.slice(0, 8)}).`,
      `WIB Reference: ${wibCtx.dateStr}`
    );

    let classifiedOutput: Awaited<ReturnType<typeof classifySearchResultsWithGemini>>;
    try {
      classifiedOutput = await deps.classifyFn(
        hitsToEvaluate.map((entry) => {
          const probe = crawlMap.get(entry.hit.url);
          return {
            index: entry.index,
            keywordPhrase: entry.keywordPhrase,
            targetCategory: entry.targetCategory,
            hit: entry.hit,
            pageTitle: probe?.pageTitle ?? null,
            pageSnippet: probe?.extractedText ?? null,
          };
        }),
        {
          jakartaNow: deps.jakartaNow,
          verifyModelFn: deps.verifyGeminiModelFn,
          onRetry: async (info) => {
            retryCount += 1;
            await deps.repo.updateRawDiscoveryBatch(batch.id, {
              retryCount,
              lastError: info.errorMessage,
            });
            await deps.repo.recordSystemLog(
              'warn',
              'SourceDiscovery',
              `Classification retry ${info.attempt}/${info.maxAttempts - 1} scheduled in ${info.delayMs}ms.`,
              info.errorMessage
            );
          },
        }
      );
      modelUsed = classifiedOutput.modelUsed;
      retryCount = Math.max(retryCount, classifiedOutput.retryCount);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Gemini classification failed.';
      await deps.repo.updateRawDiscoveryBatch(batch.id, {
        status: 'classification_failed',
        retryCount,
        lastError: errMsg,
      });
      await deps.repo.recordSystemLog(
        'error',
        'SourceDiscovery',
        `Classification failed for raw batch ${batch.id.slice(0, 8)} (raw hits preserved for retry).`,
        errMsg
      );
      throw err;
    }

    // 3. Deterministic enrichment: classification overrides, temporal validation, audience, eligibility, 3-level dedup
    const [existingSources, existingCandidatesRaw] = await Promise.all([
      deps.repo.listSources(),
      deps.repo.listCandidatesForDedup(),
    ]);
    const existingCandidates: DeduplicationCandidateRecord[] = [...existingCandidatesRaw];

    let closedOrCompletedCount = 0;
    let monitorableSourcesCount = 0;
    let semanticDupCount = 0;

    for (const cls of classifiedOutput.results) {
      const hitEntry = hitsToEvaluate.find((h) => h.index === cls.index);
      if (!hitEntry) continue;

      const kwSum = keywordSummaries.find((s) => s.keywordId === hitEntry.keywordId);
      const probe = crawlMap.get(hitEntry.hit.url);
      const domain = extractSourceDomain(hitEntry.hit.url);
      const combinedCorpus = [
        hitEntry.hit.title,
        hitEntry.hit.content,
        probe?.pageTitle ?? '',
        probe?.extractedText ?? '',
      ]
        .filter(Boolean)
        .join(' ');

      const classification = resolveClassificationDeterministic({
        url: hitEntry.hit.url,
        title: hitEntry.hit.title,
        snippet: combinedCorpus,
        modelClassification: cls.classification,
      });

      const detectedType = resolveDetectedTypeDeterministic({
        url: hitEntry.hit.url,
        modelDetectedType: cls.detectedType,
        classification,
        contentTypeHeader: probe?.contentType,
      });

      if (classification === 'Irrelevant') {
        rejectedIrrelevantCount += 1;
        if (kwSum) kwSum.rejectedCount += 1;
        previewItems.push({
          title: hitEntry.hit.title,
          url: hitEntry.hit.url,
          normalizedUrl: hitEntry.normalizedUrl,
          matchedKeyword: hitEntry.keywordPhrase,
          classification,
          confidenceScore: cls.confidenceScore,
          reason: cls.reason,
          outcome: 'rejected',
          suggestedName: cls.suggestedName,
          organizer: cls.organizer,
          detectedType,
          crawlabilityStatus: probe?.status ?? 'unknown',
          sourceDomain: domain,
        });
        continue;
      }

      relevantCount += 1;
      if (kwSum) kwSum.relevantCount += 1;

      const combinedTitle = [hitEntry.hit.title, probe?.pageTitle].filter(Boolean).join(' ');
      const articleCheck = detectIndividualNewsOrResultArticle({
        url: hitEntry.hit.url,
        title: combinedTitle,
        textCorpus: combinedCorpus,
        classification,
      });

      const isRecurringHub =
        (classification === 'Organizer' ||
          classification === 'University' ||
          classification === 'Aggregator' ||
          classification === 'Community') &&
        !articleCheck.isIndividualArticle;

      const temporal = evaluateTemporalStatus({
        modelStatus: cls.temporalStatus,
        registrationOpenDate: cls.registrationOpenDate,
        registrationDeadline: cls.registrationDeadline,
        competitionStartDate: cls.competitionStartDate,
        competitionEndDate: cls.competitionEndDate,
        eventYear: cls.eventYear,
        temporalEvidence: cls.temporalEvidence,
        temporalConfidence: cls.temporalConfidence,
        textCorpus: combinedCorpus,
        url: hitEntry.hit.url,
        isRecurringSourceHub: isRecurringHub,
        jakartaNow: wibCtx,
      });

      if (
        temporal.temporalStatus === 'closed' ||
        temporal.temporalStatus === 'completed' ||
        temporal.temporalStatus === 'archived'
      ) {
        closedOrCompletedCount += 1;
      }

      const audience = evaluateTargetAudienceCompatibility({
        keywordPhrase: hitEntry.keywordPhrase,
        modelAudience: cls.targetAudience,
        textCorpus: combinedCorpus,
      });

      const eligibility = evaluateCandidateKindAndEligibility({
        url: hitEntry.hit.url,
        classification,
        detectedType,
        temporalStatus: temporal.temporalStatus,
        crawlabilityStatus: probe?.status ?? 'unknown',
        title: combinedTitle,
        textCorpus: combinedCorpus,
      });

      if (eligibility.isMonitorable) {
        monitorableSourcesCount += 1;
      }

      const dedup = detectThreeLevelDuplicate({
        url: hitEntry.hit.url,
        suggestedName: cls.suggestedName,
        organizer: cls.organizer,
        candidateKind: eligibility.candidateKind,
        classification,
        eventYear: temporal.eventYear,
        registrationDeadline: temporal.registrationDeadline,
        knownExactUrls: new Set(), // Exact URL already filtered before classification
        existingSources: existingSources.map((s) => ({ id: s.id, url: s.url, name: s.name })),
        existingCandidates,
      });

      if (dedup.duplicateStatus !== 'unique') {
        semanticDupCount += 1;
      }

      const confidenceNote = `[${classification} · ${cls.confidenceScore}%] ${cls.reason}`;

      const saveRes = await deps.repo.saveDiscoveredCandidate({
        suggestedName: cls.suggestedName,
        normalizedUrl: hitEntry.normalizedUrl,
        organizer: cls.organizer,
        detectedType,
        matchedKeyword: hitEntry.keywordPhrase,
        category: hitEntry.targetCategory,
        confidenceNote,
        classification,
        confidenceScore: cls.confidenceScore,
        candidateKind: eligibility.candidateKind,
        temporalStatus: temporal.temporalStatus,
        registrationOpenDate: temporal.registrationOpenDate,
        registrationDeadline: temporal.registrationDeadline,
        competitionStartDate: temporal.competitionStartDate,
        competitionEndDate: temporal.competitionEndDate,
        eventYear: temporal.eventYear,
        temporalEvidence: temporal.temporalEvidence,
        temporalConfidence: temporal.temporalConfidence,
        targetAudience: audience.targetAudience,
        audienceCompatible: audience.audienceCompatible,
        audienceNote: audience.audienceNote,
        isMonitorable: eligibility.isMonitorable,
        isRecurringSource: eligibility.isRecurringSource,
        monitoringEligibility: eligibility.monitoringEligibility,
        monitoringBlockReason: eligibility.monitoringBlockReason,
        crawlabilityStatus: probe?.status ?? 'unknown',
        crawlabilityHttpStatus: probe?.httpStatus ?? null,
        crawlabilityDetails: probe?.details ?? null,
        sourceDomain: domain,
        recommendedMonitoringUrl: eligibility.recommendedMonitoringUrl,
        duplicateStatus: dedup.duplicateStatus,
        duplicateOfCandidateId:
          dedup.level === 'semantic_event' || dedup.level === 'source_domain'
            ? dedup.matchedRecordId
            : null,
        duplicateReason: dedup.reason,
        rawBatchId: batch.id,
      });

      if (saveRes.duplicate) {
        duplicatesSkipped += 1;
        if (kwSum) kwSum.duplicateCount += 1;
        previewItems.push({
          title: hitEntry.hit.title,
          url: hitEntry.hit.url,
          normalizedUrl: hitEntry.normalizedUrl,
          matchedKeyword: hitEntry.keywordPhrase,
          classification,
          confidenceScore: cls.confidenceScore,
          reason: `${cls.reason} (Duplicate skipped on insert)`,
          outcome: 'duplicate',
          suggestedName: cls.suggestedName,
          organizer: cls.organizer,
          detectedType,
          candidateKind: eligibility.candidateKind,
          temporalStatus: temporal.temporalStatus,
          registrationDeadline: temporal.registrationDeadline,
          temporalEvidence: temporal.temporalEvidence,
          targetAudience: audience.targetAudience,
          audienceCompatible: audience.audienceCompatible,
          crawlabilityStatus: probe?.status ?? 'unknown',
          monitoringEligibility: eligibility.monitoringEligibility,
          monitoringBlockReason: eligibility.monitoringBlockReason,
          duplicateStatus: 'confirmed_duplicate',
          duplicateReason: dedup.reason,
          sourceDomain: domain,
        });
      } else if (saveRes.saved && saveRes.candidate) {
        savedCandidatesCount += 1;
        if (kwSum) kwSum.savedCount += 1;

        existingCandidates.unshift({
          id: saveRes.candidate.id,
          url: saveRes.candidate.url,
          suggestedName: saveRes.candidate.suggestedName,
          organizer: saveRes.candidate.organizer,
          candidateKind: saveRes.candidate.candidateKind,
          classification: saveRes.candidate.classification,
          sourceDomain: saveRes.candidate.sourceDomain,
          eventYear: saveRes.candidate.eventYear,
          registrationDeadline: saveRes.candidate.registrationDeadline,
        });

        previewItems.push({
          title: hitEntry.hit.title,
          url: hitEntry.hit.url,
          normalizedUrl: hitEntry.normalizedUrl,
          matchedKeyword: hitEntry.keywordPhrase,
          classification,
          confidenceScore: cls.confidenceScore,
          reason: cls.reason,
          outcome: 'saved',
          suggestedName: cls.suggestedName,
          organizer: cls.organizer,
          detectedType,
          candidateKind: eligibility.candidateKind,
          temporalStatus: temporal.temporalStatus,
          registrationDeadline: temporal.registrationDeadline,
          temporalEvidence: temporal.temporalEvidence,
          targetAudience: audience.targetAudience,
          audienceCompatible: audience.audienceCompatible,
          crawlabilityStatus: probe?.status ?? 'unknown',
          monitoringEligibility: eligibility.monitoringEligibility,
          monitoringBlockReason: eligibility.monitoringBlockReason,
          duplicateStatus: dedup.duplicateStatus,
          duplicateReason: dedup.reason,
          sourceDomain: domain,
        });
      }
    }

    await Promise.all([
      deps.repo.recordSystemLog(
        'info',
        'SourceDiscovery',
        `Temporal validation result: ${closedOrCompletedCount} expired/archived out of ${relevantCount} relevant hits (WIB ${wibCtx.dateStr}).`
      ),
      deps.repo.recordSystemLog(
        'info',
        'SourceDiscovery',
        `Source eligibility result: ${monitorableSourcesCount} monitorable source candidates identified.`,
        `Non-monitorable/single-event candidates: ${Math.max(0, relevantCount - monitorableSourcesCount)}`
      ),
      semanticDupCount > 0
        ? deps.repo.recordSystemLog(
            'warn',
            'SourceDiscovery',
            `Duplicate detected: ${semanticDupCount} candidate(s) flagged via semantic/domain matching for review.`
          )
        : Promise.resolve(),
      savedCandidatesCount > 0
        ? deps.repo.recordSystemLog(
            'info',
            'SourceDiscovery',
            `Candidate saved: ${savedCandidatesCount} staged candidate(s) persisted to Supabase.`
          )
        : Promise.resolve(),
      rejectedIrrelevantCount > 0
        ? deps.repo.recordSystemLog(
            'info',
            'SourceDiscovery',
            `Candidate rejected: ${rejectedIrrelevantCount} Irrelevant URL(s) excluded.`
          )
        : Promise.resolve(),
    ]);
  }

  await deps.repo.updateRawDiscoveryBatch(batch.id, {
    status: 'completed',
    modelUsed,
    keywords: updatedBatchKeywords,
    retryCount,
    lastError: null,
  });

  await Promise.all(
    keywordSummaries.map((s) =>
      s.error ? Promise.resolve() : deps.repo.markKeywordRun(s.keywordId, s.savedCount, executedAt)
    )
  );

  return {
    rawBatchId: batch.id,
    batchStatus: 'completed',
    provider: 'tavily',
    modelUsed,
    executedAt,
    wibDate: wibCtx.dateStr,
    keywordsProcessed: keywordSummaries.length,
    totalResultsFound: totalRawHits,
    totalRawHits,
    duplicateHits: levelADuplicateHits,
    queuedNewHits,
    rawBatchMetrics: {
      total_raw_hits: totalRawHits,
      duplicate_hits: levelADuplicateHits,
      queued_new_hits: queuedNewHits,
    },
    relevantCount,
    savedCandidatesCount,
    duplicatesSkipped,
    rejectedIrrelevantCount,
    retryCount,
    lastError: firstSearchError,
    keywordSummaries,
    items: previewItems,
  };
}

export async function runLiveSearchDiscovery(
  request: DiscoveryRunRequest = {},
  customDeps?: DiscoveryPipelineDependencies
): Promise<DiscoveryRunResult> {
  const deps = getDefaultDeps(customDeps);

  if (!deps.bypassCooldown) {
    if (isRunInFlight) {
      throw new DiscoveryOrchestrationError(
        'A live Search Discovery run is already in progress. Please wait for it to complete.',
        429
      );
    }

    const now = Date.now();
    if (lastCompletedRunAtMs > 0 && now - lastCompletedRunAtMs < MIN_COOLDOWN_MS) {
      const waitSec = Math.ceil((MIN_COOLDOWN_MS - (now - lastCompletedRunAtMs)) / 1000);
      throw new DiscoveryOrchestrationError(
        `Discovery cooldown active to protect search quota. Retry in ${waitSec}s.`,
        429
      );
    }

    while (recentRunTimestamps.length > 0 && now - recentRunTimestamps[0] > RATE_WINDOW_MS) {
      recentRunTimestamps.shift();
    }
    if (recentRunTimestamps.length >= MAX_RUNS_PER_WINDOW) {
      throw new DiscoveryOrchestrationError(
        'Discovery rate limit reached (max 12 runs per 5 minutes). Please wait before running again.',
        429
      );
    }
    recentRunTimestamps.push(now);
  }

  if (request.keywordIds !== undefined) {
    if (
      !Array.isArray(request.keywordIds) ||
      request.keywordIds.length > 3 ||
      request.keywordIds.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      throw new DiscoveryOrchestrationError(
        'keywordIds must be an array of up to 3 valid keyword IDs.',
        400
      );
    }
  }

  if (!deps.isTavilyConfiguredFn()) {
    throw new DiscoveryOrchestrationError(
      'SEARCH_ENGINE_API_KEY is not configured in server secrets.',
      503
    );
  }

  if (!deps.bypassCooldown) {
    isRunInFlight = true;
  }

  const executedAt = new Date().toISOString();

  try {
    const modelUsed = await deps.verifyGeminiModelFn();
    const { maxKeywords, maxResultsPerKeyword } = clampDiscoveryRunLimits(request);

    const keywords = await deps.repo.listEnabledKeywords(request.keywordIds, maxKeywords);
    if (keywords.length === 0) {
      throw new DiscoveryOrchestrationError(
        'No enabled discovery keywords found. Add or enable at least one keyword before running discovery.',
        400
      );
    }

    await deps.repo.recordSystemLog(
      'info',
      'SourceDiscovery',
      `Search started for ${keywords.length} enabled keyword(s).`,
      `Keywords: ${keywords.map((k) => k.phrase).join(' | ')} | TimeRange: ${request.timeRange ?? 'all'}`
    );

    const knownNormalizedUrls = await deps.repo.getKnownNormalizedUrls();

    const keywordSummaries: DiscoveryRunKeywordSummary[] = [];
    const rawHitsToPersist: RawBatchSearchHit[] = [];

    let globalIdx = 0;
    let totalResultsFound = 0;
    let firstFatalOrUpstreamError: string | null = null;

    for (const kw of keywords) {
      const querySent = buildDiscoveryQuery(kw.phrase, kw.category, kw.region);

      const summary: DiscoveryRunKeywordSummary = {
        keywordId: kw.id,
        phrase: kw.phrase,
        category: kw.category,
        region: kw.region,
        querySent,
        rawResultsCount: 0,
        relevantCount: 0,
        savedCount: 0,
        duplicateCount: 0,
        rejectedCount: 0,
        error: null,
      };
      keywordSummaries.push(summary);

      try {
        const tavilyRes = await deps.searchTavilyFn({
          query: querySent,
          maxResults: maxResultsPerKeyword,
          timeRange: request.timeRange,
          excludeDomains: request.excludeDomains,
        });

        summary.rawResultsCount = tavilyRes.results.length;
        totalResultsFound += tavilyRes.results.length;

        // Capture ALL raw Tavily hits BEFORE Level A deduplication for 1:1 auditability and safe replay
        for (const hit of tavilyRes.results) {
          const normalizedUrl = normalizeDiscoveryUrl(hit.url) ?? '';
          rawHitsToPersist.push({
            index: globalIdx,
            keywordId: kw.id,
            keywordPhrase: kw.phrase,
            targetCategory: kw.category,
            targetRegion: kw.region,
            querySent,
            normalizedUrl,
            hit,
          });
          globalIdx += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Tavily query failed.';
        summary.error = message;
        if (!firstFatalOrUpstreamError) {
          firstFatalOrUpstreamError = message;
        }
        if (err instanceof TavilyApiError && (err.statusCode === 429 || err.statusCode === 503)) {
          await deps.repo.recordSystemLog(
            'error',
            'SourceDiscovery',
            `Tavily Search aborted (${err.code}).`,
            message
          );
          throw err;
        }
      }
    }

    if (totalResultsFound === 0 && firstFatalOrUpstreamError && rawHitsToPersist.length === 0) {
      throw new DiscoveryOrchestrationError(firstFatalOrUpstreamError, 502);
    }

    await deps.repo.recordSystemLog(
      'info',
      'SourceDiscovery',
      `Search completed (${totalResultsFound} total Tavily hits received across ${keywords.length} keyword(s)).`
    );

    // CRITICAL: Persist ALL raw Tavily search hits BEFORE Level A deduplication and BEFORE Gemini classification
    const batch = await deps.repo.createRawDiscoveryBatch({
      provider: 'tavily',
      modelUsed,
      status: 'search_completed',
      keywords: keywordSummaries.map((s) => ({
        keywordId: s.keywordId,
        phrase: s.phrase,
        category: s.category,
        region: s.region,
        querySent: s.querySent,
        rawResultsCount: s.rawResultsCount,
        error: s.error,
      })),
      rawResults: rawHitsToPersist,
    });

    await deps.repo.recordSystemLog(
      'info',
      'SourceDiscovery',
      `Raw results persisted (batch ${batch.id.slice(0, 8)} · total_raw_hits=${batch.totalRawHits}).`
    );

    const result = await processRawHitsPipeline({
      batch,
      keywordSummaries,
      knownNormalizedUrls,
      executedAt,
      firstSearchError: firstFatalOrUpstreamError,
      deps,
    });

    result.totalResultsFound = totalResultsFound;

    if (!deps.bypassCooldown) {
      lastDiscoveryRun = result;
      lastCompletedRunAtMs = Date.now();
    }
    return result;
  } catch (err) {
    if (!deps.bypassCooldown) {
      lastCompletedRunAtMs = Date.now();
    }
    const message = err instanceof Error ? err.message : 'Live discovery run failed.';
    if (
      !(err instanceof DiscoveryOrchestrationError && err.statusCode === 400) &&
      !(err instanceof TavilyApiError && (err.statusCode === 429 || err.statusCode === 503))
    ) {
      await deps.repo.recordSystemLog(
        'error',
        'SourceDiscovery',
        'Live Search Discovery run failed.',
        message
      );
    }

    if (!deps.bypassCooldown) {
      lastDiscoveryRun = {
        provider: 'tavily',
        modelUsed: 'gemini-4-hydrogen',
        executedAt,
        keywordsProcessed: 0,
        totalResultsFound: 0,
        totalRawHits: 0,
        duplicateHits: 0,
        queuedNewHits: 0,
        rawBatchMetrics: {
          total_raw_hits: 0,
          duplicate_hits: 0,
          queued_new_hits: 0,
        },
        relevantCount: 0,
        savedCandidatesCount: 0,
        duplicatesSkipped: 0,
        rejectedIrrelevantCount: 0,
        lastError: message,
        keywordSummaries: [],
        items: [],
      };
    }

    if (
      err instanceof DiscoveryOrchestrationError ||
      err instanceof TavilyApiError ||
      err instanceof GeminiClassifierError ||
      err instanceof SupabaseRepositoryError
    ) {
      throw err;
    }
    throw new DiscoveryOrchestrationError(message, 500);
  } finally {
    if (!deps.bypassCooldown) {
      isRunInFlight = false;
    }
  }
}

export async function retryRawBatchClassification(
  batchId: string,
  customDeps?: DiscoveryPipelineDependencies
): Promise<DiscoveryRunResult> {
  const deps = getDefaultDeps(customDeps);
  const batch = await deps.repo.getRawDiscoveryBatch(batchId);
  if (!batch) {
    throw new DiscoveryOrchestrationError('Saved raw discovery batch not found.', 404);
  }

  const executedAt = new Date().toISOString();
  const knownNormalizedUrls = await deps.repo.getKnownNormalizedUrls();

  const keywordSummaries: DiscoveryRunKeywordSummary[] = batch.keywords.map((k) => ({
    keywordId: k.keywordId,
    phrase: k.phrase,
    category: k.category,
    region: k.region,
    querySent: k.querySent,
    rawResultsCount: k.rawResultsCount,
    relevantCount: 0,
    savedCount: 0,
    duplicateCount: 0,
    rejectedCount: 0,
    error: k.error,
  }));

  await deps.repo.recordSystemLog(
    'info',
    'SourceDiscovery',
    `Replaying saved raw batch ${batch.id.slice(0, 8)} without calling Tavily Search API.`,
    `Stored raw hits: ${batch.rawResults.length}`
  );

  const result = await processRawHitsPipeline({
    batch,
    keywordSummaries,
    knownNormalizedUrls,
    executedAt,
    firstSearchError: null,
    deps,
  });

  if (!deps.bypassCooldown) {
    lastDiscoveryRun = result;
  }
  return result;
}
