import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  CandidateKind,
  CompetitionSource,
  CrawlabilityStatus,
  CreateJobInput,
  CreateSourceInput,
  DataOrigin,
  DiscoveredContentItem,
  DiscoveryCandidate,
  DiscoveryClassificationCategory,
  DiscoveryKeyword,
  DiscoveryRawBatch,
  DuplicateStatus,
  EngineSettings,
  LogLevel,
  MonitoringEligibility,
  MonitoringJob,
  RadarSnapshot,
  RawBatchSearchHit,
  RawBatchStatus,
  SourceStatus,
  SourceType,
  SystemLogEntry,
  TargetAudience,
  TemporalStatus,
} from '../../src/types/radar.ts';
import {
  extractSourceDomain,
  isPdfUrl,
  isSocialDomain,
  isSocialSinglePostUrl,
  type DeduplicationCandidateRecord,
} from '../../src/utils/discoveryQuality.ts';
import {
  generateDeterministicFingerprint,
  normalizeDiscoveryUrl,
  validateCreateSourceForm,
  validateSourceUrl,
} from '../../src/utils/radarLogic.ts';
import { getConnectorHealth } from '../services/connectorStatus.ts';
import { isGeminiConfigured } from '../services/geminiClient.ts';
import { getSupabaseAdminClient } from '../services/supabaseClient.ts';
import { isTavilyConfigured } from '../services/tavilyClient.ts';

export class SupabaseRepositoryError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'SupabaseRepositoryError';
    this.statusCode = statusCode;
  }
}

export interface SaveDiscoveredCandidateInput {
  suggestedName: string;
  normalizedUrl: string;
  organizer: string;
  detectedType: SourceType;
  matchedKeyword: string;
  category: string;
  confidenceNote: string;
  classification: DiscoveryClassificationCategory;
  confidenceScore: number;
  candidateKind: CandidateKind;
  temporalStatus: TemporalStatus;
  registrationOpenDate: string | null;
  registrationDeadline: string | null;
  competitionStartDate: string | null;
  competitionEndDate: string | null;
  eventYear: number | null;
  temporalEvidence: string | null;
  temporalConfidence: number;
  targetAudience: TargetAudience;
  audienceCompatible: boolean;
  audienceNote: string | null;
  isMonitorable: boolean;
  isRecurringSource: boolean;
  monitoringEligibility: MonitoringEligibility;
  monitoringBlockReason: string | null;
  crawlabilityStatus: CrawlabilityStatus;
  crawlabilityHttpStatus: number | null;
  crawlabilityDetails: string | null;
  sourceDomain: string;
  recommendedMonitoringUrl: string | null;
  duplicateStatus: DuplicateStatus;
  duplicateOfCandidateId: string | null;
  duplicateReason: string | null;
  rawBatchId: string | null;
}

interface SourceRow {
  id: string;
  name: string;
  url: string;
  source_type: CompetitionSource['sourceType'];
  discovery_method: CompetitionSource['discoveryMethod'];
  monitoring_method: CompetitionSource['monitoringMethod'];
  category: string;
  priority: CompetitionSource['priority'];
  status: CompetitionSource['status'];
  polling_interval_minutes: number;
  last_checked_at: string | null;
  last_successful_check_at: string | null;
  last_error: string | null;
  content_fingerprint: string | null;
  data_origin: string;
  created_at: string;
}

interface KeywordRow {
  id: string;
  phrase: string;
  category: string;
  region: string;
  enabled: boolean;
  matches_found: number;
  last_run_at: string | null;
  data_origin: string | null;
}

interface CandidateRow {
  id: string;
  suggested_name: string;
  url: string;
  organizer: string;
  detected_type: DiscoveryCandidate['detectedType'];
  discovery_method: DiscoveryCandidate['discoveryMethod'];
  matched_keyword: string;
  category: string;
  confidence_note: string;
  status: DiscoveryCandidate['status'];
  data_origin: string;
  discovered_at: string;
  // Optional Phase 2B.1 native columns
  classification?: DiscoveryClassificationCategory | null;
  confidence_score?: number | null;
  candidate_kind?: CandidateKind | null;
  temporal_status?: TemporalStatus | null;
  registration_open_date?: string | null;
  registration_deadline?: string | null;
  competition_start_date?: string | null;
  competition_end_date?: string | null;
  event_year?: number | null;
  temporal_evidence?: string | null;
  temporal_confidence?: number | null;
  target_audience?: TargetAudience | null;
  audience_compatible?: boolean | null;
  audience_note?: string | null;
  is_monitorable?: boolean | null;
  is_recurring_source?: boolean | null;
  monitoring_eligibility?: MonitoringEligibility | null;
  monitoring_block_reason?: string | null;
  crawlability_status?: CrawlabilityStatus | null;
  crawlability_http_status?: number | null;
  crawlability_details?: string | null;
  source_domain?: string | null;
  recommended_monitoring_url?: string | null;
  duplicate_status?: DuplicateStatus | null;
  duplicate_of_candidate_id?: string | null;
  duplicate_reason?: string | null;
  raw_batch_id?: string | null;
  rss_feed_id?: string | null;
}

interface JobRow {
  id: string;
  name: string;
  source_id: string | null;
  source_name: string | null;
  monitoring_method: MonitoringJob['monitoringMethod'];
  interval_minutes: number;
  dedup_strategy: MonitoringJob['dedupStrategy'];
  status: MonitoringJob['status'];
  last_run_at: string | null;
  next_run_at: string | null;
  items_detected: number;
  duplicates_skipped: number;
  last_error: string | null;
  data_origin: string;
}

interface ContentRow {
  id: string;
  source_id: string | null;
  source_name: string;
  title: string;
  organizer: string;
  competition_url: string;
  category: string;
  discovery_method: DiscoveredContentItem['discoveryMethod'];
  fingerprint_hash: string;
  deadline_date: string | null;
  prize_pool: string | null;
  review_status: DiscoveredContentItem['reviewStatus'];
  data_origin: string;
  discovered_at: string;
}

interface LogRow {
  id: string;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  details: string | null;
}

interface SettingsRow {
  id: number;
  default_polling_interval_minutes: number;
  default_dedup_strategy: EngineSettings['defaultDedupStrategy'];
  max_concurrent_jobs: number;
  auto_promote_verified_rss: boolean;
}

interface RawBatchRow {
  id: string;
  provider: 'tavily' | 'rss_atom';
  model_used: string | null;
  status: RawBatchStatus;
  keywords_json: DiscoveryRawBatch['keywords'];
  raw_results_json: RawBatchSearchHit[];
  total_raw_hits: number;
  retry_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const META_MARKER = '\n[p2b1:';
const RAW_BATCH_FALLBACK_FILE = path.join(os.tmpdir(), 'denio-radar-raw-batches.json');

interface Embedded2b1Meta {
  dt?: SourceType;
  cl?: DiscoveryClassificationCategory;
  cs?: number;
  ck?: CandidateKind;
  ts?: TemporalStatus;
  ro?: string | null;
  rd?: string | null;
  sd?: string | null;
  ed?: string | null;
  ey?: number | null;
  te?: string | null;
  tc?: number | null;
  ta?: TargetAudience;
  ac?: boolean;
  an?: string | null;
  im?: boolean;
  ir?: boolean;
  me?: MonitoringEligibility;
  mbr?: string | null;
  cr?: CrawlabilityStatus;
  chs?: number | null;
  cd?: string | null;
  dom?: string | null;
  rmu?: string | null;
  ds?: DuplicateStatus;
  did?: string | null;
  dr?: string | null;
  rb?: string | null;
}

function encodeConfidenceWithMeta(note: string, meta: Embedded2b1Meta): string {
  return `${note}${META_MARKER}${JSON.stringify(meta)}]`;
}

function decodeConfidenceMeta(rawNote: string): { cleanNote: string; meta: Embedded2b1Meta | null } {
  const idx = rawNote.indexOf(META_MARKER);
  if (idx === -1) {
    return { cleanNote: rawNote, meta: null };
  }
  const cleanNote = rawNote.slice(0, idx).trim();
  const rest = rawNote.slice(idx + META_MARKER.length);
  const endIdx = rest.lastIndexOf(']');
  if (endIdx === -1) {
    return { cleanNote, meta: null };
  }
  try {
    const parsed = JSON.parse(rest.slice(0, endIdx)) as Embedded2b1Meta;
    return { cleanNote, meta: parsed };
  } catch {
    return { cleanNote, meta: null };
  }
}

function isMissingPhase2b1ColumnOrEnumError(err: { code?: string; message?: string }): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return (
    err.code === 'PGRST204' ||
    err.code === '42703' ||
    err.code === '22P02' ||
    msg.includes('schema cache') ||
    msg.includes('column') ||
    msg.includes('static_document')
  );
}

function isMissingTableError(err: { code?: string; message?: string }): boolean {
  return err.code === '42P01' || err.code === 'PGRST205';
}

function normalizeOrigin(origin: string | null | undefined): DataOrigin {
  if (
    origin === 'seeded_demo' ||
    origin === 'user_created' ||
    origin === 'dry_run_simulation' ||
    origin === 'supabase_db' ||
    origin === 'tavily_discovery'
  ) {
    return origin;
  }
  return 'supabase_db';
}

function mapSourceRow(row: SourceRow): CompetitionSource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    sourceType: row.source_type,
    discoveryMethod: row.discovery_method,
    monitoringMethod: row.monitoring_method,
    category: row.category,
    priority: row.priority,
    status: row.status,
    pollingIntervalMinutes: row.polling_interval_minutes,
    lastCheckedAt: row.last_checked_at,
    lastSuccessfulCheckAt: row.last_successful_check_at,
    errorInfo: row.last_error,
    contentFingerprint: row.content_fingerprint,
    dataOrigin: normalizeOrigin(row.data_origin),
    createdAt: row.created_at,
  };
}

function mapKeywordRow(row: KeywordRow): DiscoveryKeyword {
  return {
    id: row.id,
    phrase: row.phrase,
    category: row.category,
    region: row.region,
    enabled: row.enabled,
    matchesFound: row.matches_found,
    lastRunAt: row.last_run_at,
    dataOrigin: normalizeOrigin(row.data_origin ?? 'user_created'),
  };
}

function pickLegacyEnumFallback<T extends string>(
  nativeVal: T | null | undefined,
  metaVal: T | undefined,
  migrationDefault: T
): T | undefined {
  if (nativeVal === null || nativeVal === undefined) {
    return metaVal;
  }
  if (metaVal !== undefined && nativeVal === migrationDefault) {
    return metaVal;
  }
  return nativeVal;
}

export function mapCandidateRow(row: CandidateRow): DiscoveryCandidate {
  const { cleanNote, meta } = decodeConfidenceMeta(row.confidence_note ?? '');
  const detectedType = (meta?.dt ?? row.detected_type) as SourceType;
  const sourceDomain = row.source_domain ?? meta?.dom ?? extractSourceDomain(row.url);

  // Only treat boolean defaults (false) as unmigrated when the row still carries [p2b1:...] metadata
  // AND its native monitoring_eligibility / candidate_kind hold the migration 002 default ('unknown').
  const hasUnmigratedBoolDefaults =
    meta !== null &&
    (row.monitoring_eligibility === null ||
      row.monitoring_eligibility === undefined ||
      row.monitoring_eligibility === 'unknown') &&
    (row.candidate_kind === null ||
      row.candidate_kind === undefined ||
      row.candidate_kind === 'unknown');

  return {
    id: row.id,
    suggestedName: row.suggested_name,
    url: row.url,
    organizer: row.organizer,
    detectedType,
    discoveryMethod: row.discovery_method,
    matchedKeyword: row.matched_keyword,
    category: row.category,
    confidenceNote: cleanNote,
    status: row.status,
    dataOrigin: normalizeOrigin(row.data_origin),
    discoveredAt: row.discovered_at,
    classification: row.classification ?? meta?.cl,
    confidenceScore: row.confidence_score ?? meta?.cs,
    candidateKind: pickLegacyEnumFallback(row.candidate_kind, meta?.ck, 'unknown'),
    temporalStatus: pickLegacyEnumFallback(row.temporal_status, meta?.ts, 'unknown'),
    registrationOpenDate: row.registration_open_date ?? meta?.ro ?? null,
    registrationDeadline: row.registration_deadline ?? meta?.rd ?? null,
    competitionStartDate: row.competition_start_date ?? meta?.sd ?? null,
    competitionEndDate: row.competition_end_date ?? meta?.ed ?? null,
    eventYear: row.event_year ?? meta?.ey ?? null,
    temporalEvidence: row.temporal_evidence ?? meta?.te ?? null,
    temporalConfidence: row.temporal_confidence ?? meta?.tc ?? null,
    targetAudience: pickLegacyEnumFallback(row.target_audience, meta?.ta, 'unknown'),
    audienceCompatible: row.audience_compatible ?? meta?.ac,
    audienceNote: row.audience_note ?? meta?.an ?? null,
    isMonitorable: hasUnmigratedBoolDefaults
      ? (meta?.im ?? row.is_monitorable ?? undefined)
      : (row.is_monitorable ?? meta?.im),
    isRecurringSource: hasUnmigratedBoolDefaults
      ? (meta?.ir ?? row.is_recurring_source ?? undefined)
      : (row.is_recurring_source ?? meta?.ir),
    monitoringEligibility: pickLegacyEnumFallback(row.monitoring_eligibility, meta?.me, 'unknown'),
    monitoringBlockReason: row.monitoring_block_reason ?? meta?.mbr ?? null,
    crawlabilityStatus: pickLegacyEnumFallback(row.crawlability_status, meta?.cr, 'unknown'),
    crawlabilityHttpStatus: row.crawlability_http_status ?? meta?.chs ?? null,
    crawlabilityDetails: row.crawlability_details ?? meta?.cd ?? null,
    sourceDomain: sourceDomain || null,
    recommendedMonitoringUrl: row.recommended_monitoring_url ?? meta?.rmu ?? null,
    duplicateStatus: pickLegacyEnumFallback(row.duplicate_status, meta?.ds, 'unknown'),
    duplicateOfCandidateId: row.duplicate_of_candidate_id ?? meta?.did ?? null,
    duplicateReason: row.duplicate_reason ?? meta?.dr ?? null,
    rawBatchId: row.raw_batch_id ?? meta?.rb ?? null,
    rssFeedId: row.rss_feed_id ?? null,
  };
}

function mapJobRow(row: JobRow): MonitoringJob {
  return {
    id: row.id,
    name: row.name,
    sourceId: row.source_id,
    sourceName: row.source_name || 'Global Discovery Pool',
    monitoringMethod: row.monitoring_method,
    intervalMinutes: row.interval_minutes,
    dedupStrategy: row.dedup_strategy,
    status: row.status,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    itemsDetected: row.items_detected,
    duplicatesSkipped: row.duplicates_skipped,
    lastError: row.last_error,
    dataOrigin: normalizeOrigin(row.data_origin),
  };
}

function mapContentRow(row: ContentRow): DiscoveredContentItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    title: row.title,
    organizer: row.organizer,
    competitionUrl: row.competition_url,
    category: row.category,
    discoveryMethod: row.discovery_method,
    fingerprintHash: row.fingerprint_hash,
    deadlineDate: row.deadline_date,
    prizePool: row.prize_pool,
    reviewStatus: row.review_status,
    dataOrigin: normalizeOrigin(row.data_origin),
    discoveredAt: row.discovered_at,
    sourceDomain: extractSourceDomain(row.competition_url) || null,
  };
}

function mapLogRow(row: LogRow): SystemLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    level: row.level,
    module: row.module,
    message: row.message,
    details: row.details,
  };
}

function mapSettingsRow(row: SettingsRow): EngineSettings {
  return {
    defaultPollingIntervalMinutes: row.default_polling_interval_minutes,
    defaultDedupStrategy: row.default_dedup_strategy,
    maxConcurrentJobs: row.max_concurrent_jobs,
    autoPromoteVerifiedRss: row.auto_promote_verified_rss,
  };
}

function mapRawBatchRow(row: RawBatchRow): DiscoveryRawBatch {
  const keywords = Array.isArray(row.keywords_json) ? row.keywords_json : [];
  const rawResults = Array.isArray(row.raw_results_json) ? row.raw_results_json : [];
  const hasDupMeta = keywords.some((k) => typeof k?.duplicateHits === 'number');
  const hasQueuedMeta = keywords.some((k) => typeof k?.queuedNewHits === 'number');

  return {
    id: row.id,
    provider: row.provider,
    modelUsed: row.model_used,
    status: row.status,
    keywords,
    rawResults,
    totalRawHits: row.total_raw_hits,
    duplicateHits: hasDupMeta
      ? keywords.reduce(
          (sum, k) => sum + (typeof k.duplicateHits === 'number' ? k.duplicateHits : 0),
          0
        )
      : undefined,
    queuedNewHits: hasQueuedMeta
      ? keywords.reduce(
          (sum, k) => sum + (typeof k.queuedNewHits === 'number' ? k.queuedNewHits : 0),
          0
        )
      : undefined,
    retryCount: row.retry_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readFallbackRawBatches(): DiscoveryRawBatch[] {
  try {
    if (!fs.existsSync(RAW_BATCH_FALLBACK_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(RAW_BATCH_FALLBACK_FILE, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as DiscoveryRawBatch[]) : [];
  } catch {
    return [];
  }
}

function writeFallbackRawBatches(batches: DiscoveryRawBatch[]): void {
  try {
    fs.writeFileSync(RAW_BATCH_FALLBACK_FILE, JSON.stringify(batches.slice(0, 30), null, 2));
  } catch (err) {
    console.error('Unable to write fallback raw batches file:', err);
  }
}

function unwrapSupabaseError(error: { code?: string; message: string }, context: string): never {
  if (error.code === '23505') {
    throw new SupabaseRepositoryError(`${context}: duplicate record already exists.`, 400);
  }
  if (error.code === 'PGRST116') {
    throw new SupabaseRepositoryError(`${context}: record not found.`, 404);
  }
  if (error.code === '42P01' || error.code === 'PGRST205') {
    throw new SupabaseRepositoryError(
      `Supabase schema table missing (${error.message}). Run supabase/migrations/001_phase2a_init.sql in Supabase SQL Editor.`,
      503
    );
  }
  throw new SupabaseRepositoryError(`${context}: ${error.message}`, 503);
}

export class SupabaseRadarRepository {
  private getClient() {
    try {
      return getSupabaseAdminClient();
    } catch (err) {
      throw new SupabaseRepositoryError(
        err instanceof Error ? err.message : 'Supabase client initialization failed.',
        503
      );
    }
  }

  private async appendLog(
    level: LogLevel,
    module: string,
    message: string,
    details: string | null = null
  ): Promise<void> {
    const supabase = this.getClient();
    const { error } = await supabase.from('system_logs').insert({
      level,
      module,
      message,
      details,
    });
    if (error) {
      console.error('Failed to append system_logs entry:', error.message);
    }
  }

  private async getSettingsInternal(): Promise<EngineSettings> {
    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('engine_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      unwrapSupabaseError(error, 'Failed to read engine_settings');
    }

    if (!data) {
      return {
        defaultPollingIntervalMinutes: 60,
        defaultDedupStrategy: 'url_and_fingerprint',
        maxConcurrentJobs: 4,
        autoPromoteVerifiedRss: false,
      };
    }

    return mapSettingsRow(data as SettingsRow);
  }

  public async getSnapshot(): Promise<RadarSnapshot> {
    const health = await getConnectorHealth();
    if (!health.supabaseConnected) {
      throw new SupabaseRepositoryError(
        health.supabaseError ?? 'Supabase database is disconnected.',
        503
      );
    }

    const supabase = this.getClient();
    const [
      sourcesRes,
      jobsRes,
      keywordsRes,
      candidatesRes,
      contentRes,
      logsRes,
      settingsRes,
      rawBatches,
    ] = await Promise.all([
      supabase.from('sources').select('*').order('created_at', { ascending: false }),
      supabase.from('monitoring_jobs').select('*').order('created_at', { ascending: false }),
      supabase.from('discovery_keywords').select('*').order('created_at', { ascending: false }),
      supabase
        .from('discovery_candidates')
        .select('*')
        .order('discovered_at', { ascending: false }),
      supabase.from('discovered_items').select('*').order('discovered_at', { ascending: false }),
      supabase.from('system_logs').select('*').order('timestamp', { ascending: false }).limit(200),
      supabase.from('engine_settings').select('*').eq('id', 1).maybeSingle(),
      this.listRawDiscoveryBatches(15),
    ]);

    if (sourcesRes.error) unwrapSupabaseError(sourcesRes.error, 'Failed to load sources');
    if (jobsRes.error) unwrapSupabaseError(jobsRes.error, 'Failed to load monitoring_jobs');
    if (keywordsRes.error) unwrapSupabaseError(keywordsRes.error, 'Failed to load discovery_keywords');
    if (candidatesRes.error)
      unwrapSupabaseError(candidatesRes.error, 'Failed to load discovery_candidates');
    if (contentRes.error) unwrapSupabaseError(contentRes.error, 'Failed to load discovered_items');
    if (logsRes.error) unwrapSupabaseError(logsRes.error, 'Failed to load system_logs');
    if (settingsRes.error) unwrapSupabaseError(settingsRes.error, 'Failed to load engine_settings');

    const settings = settingsRes.data
      ? mapSettingsRow(settingsRes.data as SettingsRow)
      : {
          defaultPollingIntervalMinutes: 60,
          defaultDedupStrategy: 'url_and_fingerprint' as const,
          maxConcurrentJobs: 4,
          autoPromoteVerifiedRss: false,
        };

    return {
      health,
      sources: ((sourcesRes.data ?? []) as SourceRow[]).map(mapSourceRow),
      jobs: ((jobsRes.data ?? []) as JobRow[]).map(mapJobRow),
      keywords: ((keywordsRes.data ?? []) as KeywordRow[]).map(mapKeywordRow),
      candidates: ((candidatesRes.data ?? []) as CandidateRow[]).map(mapCandidateRow),
      content: ((contentRes.data ?? []) as ContentRow[]).map(mapContentRow),
      logs: ((logsRes.data ?? []) as LogRow[]).map(mapLogRow),
      settings,
      rawBatches,
    };
  }

  public async listSources(): Promise<CompetitionSource[]> {
    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('sources')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) unwrapSupabaseError(error, 'Failed to list sources');
    return ((data ?? []) as SourceRow[]).map(mapSourceRow);
  }

  public async createSource(input: CreateSourceInput): Promise<CompetitionSource> {
    const supabase = this.getClient();
    const settings = await this.getSettingsInternal();
    const interval = input.pollingIntervalMinutes ?? settings.defaultPollingIntervalMinutes;

    const errors = validateCreateSourceForm({
      name: input.name,
      url: input.url,
      category: input.category,
      pollingIntervalMinutes: interval,
    });
    const firstError = Object.values(errors)[0];
    if (firstError) {
      throw new SupabaseRepositoryError(firstError, 400);
    }

    const urlCheck = validateSourceUrl(input.url);
    const { data: existing, error: dupErr } = await supabase
      .from('sources')
      .select('id, name')
      .ilike('url', urlCheck.normalized)
      .maybeSingle();

    if (dupErr) unwrapSupabaseError(dupErr, 'Failed checking duplicate URL');
    if (existing) {
      throw new SupabaseRepositoryError(
        `Source URL is already registered under "${existing.name}".`,
        400
      );
    }

    let status: SourceStatus = input.status ?? 'active';
    let lastError: string | null = null;
    if (input.monitoringMethod === 'search_discovery' && (!isTavilyConfigured() || !isGeminiConfigured())) {
      status = 'pending_connector';
      lastError = 'Requires SEARCH_ENGINE_API_KEY and GEMINI_API_KEY in server secrets.';
    }

    const { data, error } = await supabase
      .from('sources')
      .insert({
        name: input.name.trim(),
        url: urlCheck.normalized,
        source_type: input.sourceType,
        discovery_method: input.discoveryMethod,
        monitoring_method: input.monitoringMethod,
        category: input.category.trim(),
        priority: input.priority,
        status,
        polling_interval_minutes: interval,
        last_error: lastError,
        content_fingerprint: generateDeterministicFingerprint(urlCheck.normalized, input.name),
        data_origin: 'user_created',
      })
      .select('*')
      .single();

    if (error) unwrapSupabaseError(error, 'Failed to create source');
    const created = mapSourceRow(data as SourceRow);

    await this.appendLog(
      status === 'pending_connector' ? 'warn' : 'info',
      'SourceRegistry',
      `Registered source "${created.name}".`,
      `URL: ${created.url} | Method: ${created.monitoringMethod} | Status: ${created.status}`
    );

    return created;
  }

  public async updateSource(
    id: string,
    patch: Partial<
      Pick<
        CompetitionSource,
        | 'name'
        | 'url'
        | 'sourceType'
        | 'discoveryMethod'
        | 'monitoringMethod'
        | 'category'
        | 'priority'
        | 'status'
        | 'pollingIntervalMinutes'
        | 'errorInfo'
      >
    >
  ): Promise<CompetitionSource> {
    const supabase = this.getClient();
    const updatePayload: Record<string, unknown> = {};

    if (patch.name !== undefined) {
      if (patch.name.trim().length < 2) {
        throw new SupabaseRepositoryError('Source name must be at least 2 characters.', 400);
      }
      updatePayload.name = patch.name.trim();
    }
    if (patch.url !== undefined) {
      const check = validateSourceUrl(patch.url);
      if (!check.valid) {
        throw new SupabaseRepositoryError(check.error ?? 'Invalid source URL.', 400);
      }
      updatePayload.url = check.normalized;
    }
    if (patch.sourceType !== undefined) updatePayload.source_type = patch.sourceType;
    if (patch.discoveryMethod !== undefined) updatePayload.discovery_method = patch.discoveryMethod;
    if (patch.monitoringMethod !== undefined)
      updatePayload.monitoring_method = patch.monitoringMethod;
    if (patch.category !== undefined) {
      if (!patch.category.trim()) {
        throw new SupabaseRepositoryError('Category is required.', 400);
      }
      updatePayload.category = patch.category.trim();
    }
    if (patch.priority !== undefined) updatePayload.priority = patch.priority;
    if (patch.status !== undefined) updatePayload.status = patch.status;
    if (patch.pollingIntervalMinutes !== undefined) {
      if (!Number.isFinite(patch.pollingIntervalMinutes) || patch.pollingIntervalMinutes < 5) {
        throw new SupabaseRepositoryError('Polling interval must be at least 5 minutes.', 400);
      }
      updatePayload.polling_interval_minutes = patch.pollingIntervalMinutes;
    }
    if (patch.errorInfo !== undefined) updatePayload.last_error = patch.errorInfo;

    const { data, error } = await supabase
      .from('sources')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) unwrapSupabaseError(error, 'Failed to update source');
    if (!data) throw new SupabaseRepositoryError('Source not found.', 404);

    const updated = mapSourceRow(data as SourceRow);
    await this.appendLog(
      'info',
      'SourceRegistry',
      `Updated source "${updated.name}".`,
      `Status: ${updated.status} | Priority: ${updated.priority}`
    );

    return updated;
  }

  public async deleteSource(id: string): Promise<void> {
    const supabase = this.getClient();
    const { data: target, error: findErr } = await supabase
      .from('sources')
      .select('id, name, url')
      .eq('id', id)
      .maybeSingle();

    if (findErr) unwrapSupabaseError(findErr, 'Failed to locate source');
    if (!target) throw new SupabaseRepositoryError('Source not found.', 404);

    const { error: pauseJobsErr } = await supabase
      .from('monitoring_jobs')
      .update({
        source_id: null,
        status: 'paused',
        last_error: 'Linked source was removed.',
      })
      .eq('source_id', id);

    if (pauseJobsErr) unwrapSupabaseError(pauseJobsErr, 'Failed to detach linked monitoring jobs');

    const { error: delErr } = await supabase.from('sources').delete().eq('id', id);
    if (delErr) unwrapSupabaseError(delErr, 'Failed to delete source');

    await this.appendLog(
      'warn',
      'SourceRegistry',
      `Removed source "${target.name}".`,
      `URL: ${target.url}`
    );
  }

  public async createJob(input: CreateJobInput): Promise<MonitoringJob> {
    if (!input.name.trim()) {
      throw new SupabaseRepositoryError('Job name is required.', 400);
    }
    if (!Number.isFinite(input.intervalMinutes) || input.intervalMinutes < 5) {
      throw new SupabaseRepositoryError('Polling interval must be at least 5 minutes.', 400);
    }

    const supabase = this.getClient();
    let linkedSourceName = 'Global Discovery Pool';
    let validSourceId: string | null = null;

    if (input.sourceId) {
      const { data: src, error: srcErr } = await supabase
        .from('sources')
        .select('id, name')
        .eq('id', input.sourceId)
        .maybeSingle();
      if (srcErr) unwrapSupabaseError(srcErr, 'Failed to resolve linked source');
      if (!src) throw new SupabaseRepositoryError('Linked source not found.', 400);
      validSourceId = src.id;
      linkedSourceName = src.name;
    }

    const blockedByPhase2B = input.monitoringMethod === 'search_discovery';
    const nextRunAt = blockedByPhase2B
      ? null
      : new Date(Date.now() + input.intervalMinutes * 60_000).toISOString();

    const { data, error } = await supabase
      .from('monitoring_jobs')
      .insert({
        name: input.name.trim(),
        source_id: validSourceId,
        source_name: linkedSourceName,
        monitoring_method: input.monitoringMethod,
        interval_minutes: input.intervalMinutes,
        dedup_strategy: input.dedupStrategy,
        status: blockedByPhase2B ? 'blocked_no_connector' : 'scheduled',
        next_run_at: nextRunAt,
        last_error: blockedByPhase2B
          ? 'Search discovery execution connector activates in Phase 2B.'
          : null,
        data_origin: 'user_created',
      })
      .select('*')
      .single();

    if (error) unwrapSupabaseError(error, 'Failed to create monitoring job');
    const created = mapJobRow(data as JobRow);

    await this.appendLog(
      blockedByPhase2B ? 'warn' : 'info',
      'MonitoringJobs',
      `Created job "${created.name}".`,
      `Method: ${created.monitoringMethod} | Interval: ${created.intervalMinutes}m | Status: ${created.status}`
    );

    return created;
  }

  public async toggleJobStatus(id: string): Promise<MonitoringJob> {
    const supabase = this.getClient();
    const { data: existing, error: findErr } = await supabase
      .from('monitoring_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (findErr) unwrapSupabaseError(findErr, 'Failed to load monitoring job');
    if (!existing) throw new SupabaseRepositoryError('Monitoring job not found.', 404);

    const job = existing as JobRow;
    if (job.monitoring_method === 'search_discovery') {
      throw new SupabaseRepositoryError(
        'Cannot activate Search Discovery job until Phase 2B Tavily search pipeline is enabled.',
        400
      );
    }

    const nextStatus = job.status === 'paused' ? 'scheduled' : 'paused';
    const nextRunAt =
      nextStatus === 'scheduled'
        ? new Date(Date.now() + job.interval_minutes * 60_000).toISOString()
        : null;

    const { data, error } = await supabase
      .from('monitoring_jobs')
      .update({
        status: nextStatus,
        next_run_at: nextRunAt,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) unwrapSupabaseError(error, 'Failed to toggle job status');
    const updated = mapJobRow(data as JobRow);

    await this.appendLog(
      'info',
      'MonitoringJobs',
      `Job "${updated.name}" switched to ${updated.status}.`
    );
    return updated;
  }

  public async triggerJobDryRun(id: string): Promise<{ job: MonitoringJob; note: string }> {
    const supabase = this.getClient();
    const { data: existing, error: findErr } = await supabase
      .from('monitoring_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (findErr) unwrapSupabaseError(findErr, 'Failed to load monitoring job');
    if (!existing) throw new SupabaseRepositoryError('Monitoring job not found.', 404);

    const job = existing as JobRow;
    const nowIso = new Date().toISOString();

    if (job.monitoring_method === 'search_discovery') {
      const lastError =
        'Blocked: Search discovery execution connector activates in Phase 2B. No external query executed.';
      const { data, error } = await supabase
        .from('monitoring_jobs')
        .update({
          status: 'blocked_no_connector',
          last_run_at: nowIso,
          last_error: lastError,
        })
        .eq('id', id)
        .select('*')
        .single();

      if (error) unwrapSupabaseError(error, 'Failed to update job dry-run status');
      const updated = mapJobRow(data as JobRow);

      await this.appendLog(
        'warn',
        'MonitoringJobs',
        `Dry-run blocked for "${updated.name}" (Phase 2B search pipeline pending).`,
        lastError
      );
      return {
        job: updated,
        note: 'Blocked cleanly: Search discovery execution activates in Phase 2B.',
      };
    }

    const nextRunAt = new Date(Date.now() + job.interval_minutes * 60_000).toISOString();
    const { data, error } = await supabase
      .from('monitoring_jobs')
      .update({
        status: 'scheduled',
        last_run_at: nowIso,
        next_run_at: nextRunAt,
        last_error: null,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) unwrapSupabaseError(error, 'Failed to record job dry-run');
    const updated = mapJobRow(data as JobRow);

    if (updated.sourceId) {
      await supabase
        .from('sources')
        .update({
          last_checked_at: nowIso,
          last_successful_check_at: nowIso,
          last_error: null,
        })
        .eq('id', updated.sourceId);
    }

    const note =
      'Dry-run schedule check persisted to Supabase. Live outbound HTTP/RSS fetching activates in Phase 2C.';
    await this.appendLog('info', 'MonitoringJobs', `Executed dry-run for "${updated.name}".`, note);
    return { job: updated, note };
  }

  public async createKeyword(
    phrase: string,
    category: string,
    region: string
  ): Promise<DiscoveryKeyword> {
    if (!phrase.trim() || phrase.trim().length < 3) {
      throw new SupabaseRepositoryError('Keyword query must be at least 3 characters.', 400);
    }

    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('discovery_keywords')
      .insert({
        phrase: phrase.trim(),
        category: category.trim() || 'General Competitions',
        region: region.trim() || 'Global',
        enabled: true,
        matches_found: 0,
        data_origin: 'user_created',
      })
      .select('*')
      .single();

    if (error) unwrapSupabaseError(error, 'Failed to create discovery keyword');
    const created = mapKeywordRow(data as KeywordRow);

    await this.appendLog('info', 'SourceDiscovery', `Added discovery keyword "${created.phrase}".`);
    return created;
  }

  public async toggleKeyword(id: string): Promise<DiscoveryKeyword> {
    const supabase = this.getClient();
    const { data: existing, error: findErr } = await supabase
      .from('discovery_keywords')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (findErr) unwrapSupabaseError(findErr, 'Failed to load discovery keyword');
    if (!existing) throw new SupabaseRepositoryError('Keyword not found.', 404);

    const nextEnabled = !(existing as KeywordRow).enabled;
    const { data, error } = await supabase
      .from('discovery_keywords')
      .update({ enabled: nextEnabled })
      .eq('id', id)
      .select('*')
      .single();

    if (error) unwrapSupabaseError(error, 'Failed to update keyword');
    const updated = mapKeywordRow(data as KeywordRow);

    await this.appendLog(
      'info',
      'SourceDiscovery',
      `Discovery keyword "${updated.phrase}" ${updated.enabled ? 'enabled' : 'disabled'}.`
    );
    return updated;
  }

  public async promoteCandidate(
    id: string
  ): Promise<{ candidate: DiscoveryCandidate; source: CompetitionSource }> {
    const supabase = this.getClient();
    const { data: existing, error: findErr } = await supabase
      .from('discovery_candidates')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (findErr) unwrapSupabaseError(findErr, 'Failed to load candidate');
    if (!existing) throw new SupabaseRepositoryError('Candidate source not found.', 404);

    const cand = mapCandidateRow(existing as CandidateRow);
    if (cand.status === 'promoted') {
      throw new SupabaseRepositoryError('Candidate is already promoted.', 400);
    }

    // Phase 2B.1 Guard: Block ineligible/non-monitorable/expired/social/static PDF candidates
    const domain = cand.sourceDomain || extractSourceDomain(cand.url);
    if (
      cand.monitoringEligibility === 'ineligible' ||
      cand.isMonitorable === false ||
      cand.detectedType === 'social_reference' ||
      cand.detectedType === 'static_document' ||
      isSocialSinglePostUrl(cand.url) ||
      isSocialDomain(domain) ||
      isPdfUrl(cand.url) ||
      cand.temporalStatus === 'closed' ||
      cand.temporalStatus === 'completed' ||
      cand.temporalStatus === 'archived' ||
      cand.candidateKind === 'event'
    ) {
      const reason =
        cand.monitoringBlockReason ??
        (isSocialDomain(domain) || isSocialSinglePostUrl(cand.url)
          ? 'Social media references and single posts cannot be promoted to HTML/RSS polling.'
          : isPdfUrl(cand.url)
          ? 'Static PDF documents cannot be promoted as a recurring monitoring source.'
          : cand.candidateKind === 'event'
          ? 'Single-event page is not a recurring competition source and cannot be promoted to Source Registry.'
          : 'Candidate is ineligible for Source Registry monitoring.');
      throw new SupabaseRepositoryError(reason, 400);
    }

    // Phase 2B.1 Guard: Domain-level dedup against already registered Source Registry domains
    if (domain) {
      const existingSources = await this.listSources();
      const sameDomain = existingSources.find((s) => extractSourceDomain(s.url) === domain);
      if (sameDomain) {
        throw new SupabaseRepositoryError(
          `Domain "${domain}" is already registered in Source Registry under "${sameDomain.name}".`,
          400
        );
      }
    }

    const source = await this.createSource({
      name: cand.suggestedName,
      url: cand.url,
      sourceType: cand.detectedType,
      discoveryMethod: cand.discoveryMethod,
      monitoringMethod: cand.detectedType === 'rss_feed' ? 'rss_feed' : 'polling',
      category: cand.category,
      priority: 'medium',
    });

    const { data: updatedRow, error: updErr } = await supabase
      .from('discovery_candidates')
      .update({
        status: 'promoted',
        promoted_source_id: source.id,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updErr) unwrapSupabaseError(updErr, 'Failed to update candidate status');

    await this.appendLog(
      'info',
      'SourceDiscovery',
      `Promoted candidate "${cand.suggestedName}" to Source Registry.`
    );

    return {
      candidate: mapCandidateRow(updatedRow as CandidateRow),
      source,
    };
  }

  public async dismissCandidate(id: string): Promise<DiscoveryCandidate> {
    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('discovery_candidates')
      .update({ status: 'dismissed' })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) unwrapSupabaseError(error, 'Failed to dismiss candidate');
    if (!data) throw new SupabaseRepositoryError('Candidate source not found.', 404);

    const updated = mapCandidateRow(data as CandidateRow);
    await this.appendLog(
      'info',
      'SourceDiscovery',
      `Dismissed candidate "${updated.suggestedName}".`
    );
    return updated;
  }

  public async updateContentStatus(
    id: string,
    reviewStatus: DiscoveredContentItem['reviewStatus']
  ): Promise<DiscoveredContentItem> {
    if (!['new', 'verified', 'archived'].includes(reviewStatus)) {
      throw new SupabaseRepositoryError('Invalid review status.', 400);
    }

    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('discovered_items')
      .update({ review_status: reviewStatus })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) unwrapSupabaseError(error, 'Failed to update discovered item');
    if (!data) throw new SupabaseRepositoryError('Content item not found.', 404);

    const updated = mapContentRow(data as ContentRow);
    await this.appendLog(
      'info',
      'DiscoveredContent',
      `Marked "${updated.title}" as ${reviewStatus}.`
    );
    return updated;
  }

  public async updateSettings(patch: Partial<EngineSettings>): Promise<EngineSettings> {
    const current = await this.getSettingsInternal();
    const next: EngineSettings = {
      defaultPollingIntervalMinutes:
        patch.defaultPollingIntervalMinutes ?? current.defaultPollingIntervalMinutes,
      defaultDedupStrategy: patch.defaultDedupStrategy ?? current.defaultDedupStrategy,
      maxConcurrentJobs: patch.maxConcurrentJobs ?? current.maxConcurrentJobs,
      autoPromoteVerifiedRss: patch.autoPromoteVerifiedRss ?? current.autoPromoteVerifiedRss,
    };

    if (next.defaultPollingIntervalMinutes < 5) {
      throw new SupabaseRepositoryError('Default polling interval must be at least 5 minutes.', 400);
    }
    if (next.maxConcurrentJobs < 1 || next.maxConcurrentJobs > 32) {
      throw new SupabaseRepositoryError('Max concurrent jobs must be between 1 and 32.', 400);
    }

    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('engine_settings')
      .upsert(
        {
          id: 1,
          default_polling_interval_minutes: next.defaultPollingIntervalMinutes,
          default_dedup_strategy: next.defaultDedupStrategy,
          max_concurrent_jobs: next.maxConcurrentJobs,
          auto_promote_verified_rss: next.autoPromoteVerifiedRss,
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single();

    if (error) unwrapSupabaseError(error, 'Failed to update engine_settings');
    const saved = mapSettingsRow(data as SettingsRow);

    await this.appendLog(
      'info',
      'Settings',
      'Updated monitoring engine preferences.',
      `Interval: ${saved.defaultPollingIntervalMinutes}m | Dedup: ${saved.defaultDedupStrategy}`
    );

    return saved;
  }

  public async clearLogs(): Promise<SystemLogEntry[]> {
    const supabase = this.getClient();
    const { error } = await supabase
      .from('system_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) unwrapSupabaseError(error, 'Failed to clear system_logs');
    await this.appendLog('info', 'SystemLogs', 'Cleared historical log buffer.');

    const { data, error: fetchErr } = await supabase
      .from('system_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(200);

    if (fetchErr) unwrapSupabaseError(fetchErr, 'Failed to reload system_logs');
    return ((data ?? []) as LogRow[]).map(mapLogRow);
  }

  public async recordSystemLog(
    level: LogLevel,
    module: string,
    message: string,
    details: string | null = null
  ): Promise<void> {
    await this.appendLog(level, module, message, details);
  }

  public async listEnabledKeywords(
    keywordIds?: string[],
    limit = 3
  ): Promise<DiscoveryKeyword[]> {
    const supabase = this.getClient();
    let query = supabase
      .from('discovery_keywords')
      .select('*')
      .eq('enabled', true)
      .order('last_run_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (keywordIds && keywordIds.length > 0) {
      query = query.in('id', keywordIds);
    }

    const { data, error } = await query;
    if (error) unwrapSupabaseError(error, 'Failed to load active discovery keywords');
    return ((data ?? []) as KeywordRow[]).map(mapKeywordRow);
  }

  public async getKnownNormalizedUrls(): Promise<Set<string>> {
    const supabase = this.getClient();
    const [candRes, srcRes] = await Promise.all([
      supabase.from('discovery_candidates').select('url'),
      supabase.from('sources').select('url'),
    ]);

    if (candRes.error) unwrapSupabaseError(candRes.error, 'Failed to read discovery_candidates URLs');
    if (srcRes.error) unwrapSupabaseError(srcRes.error, 'Failed to read sources URLs');

    const known = new Set<string>();
    for (const row of candRes.data ?? []) {
      const normalized = normalizeDiscoveryUrl((row as { url: string }).url);
      if (normalized) known.add(normalized);
    }
    for (const row of srcRes.data ?? []) {
      const normalized = normalizeDiscoveryUrl((row as { url: string }).url);
      if (normalized) known.add(normalized);
    }
    return known;
  }

  public async listCandidatesForDedup(): Promise<DeduplicationCandidateRecord[]> {
    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('discovery_candidates')
      .select('*')
      .order('discovered_at', { ascending: false })
      .limit(300);

    if (error) unwrapSupabaseError(error, 'Failed to list candidates for deduplication');

    return ((data ?? []) as CandidateRow[]).map((row) => {
      const mapped = mapCandidateRow(row);
      return {
        id: mapped.id,
        url: mapped.url,
        suggestedName: mapped.suggestedName,
        organizer: mapped.organizer,
        candidateKind: mapped.candidateKind,
        classification: mapped.classification,
        sourceDomain: mapped.sourceDomain,
        eventYear: mapped.eventYear,
        registrationDeadline: mapped.registrationDeadline,
      };
    });
  }

  public async saveDiscoveredCandidate(
    input: SaveDiscoveredCandidateInput
  ): Promise<{ saved: boolean; duplicate: boolean; candidate?: DiscoveryCandidate }> {
    const supabase = this.getClient();

    const fullPayload = {
      suggested_name: input.suggestedName.trim(),
      url: input.normalizedUrl,
      organizer: input.organizer.trim(),
      detected_type: input.detectedType,
      discovery_method: 'search_engine',
      matched_keyword: input.matchedKeyword,
      category: input.category,
      confidence_note: input.confidenceNote,
      status: 'candidate',
      data_origin: 'tavily_discovery',
      classification: input.classification,
      confidence_score: input.confidenceScore,
      candidate_kind: input.candidateKind,
      temporal_status: input.temporalStatus,
      registration_open_date: input.registrationOpenDate,
      registration_deadline: input.registrationDeadline,
      competition_start_date: input.competitionStartDate,
      competition_end_date: input.competitionEndDate,
      event_year: input.eventYear,
      temporal_evidence: input.temporalEvidence,
      temporal_confidence: input.temporalConfidence,
      target_audience: input.targetAudience,
      audience_compatible: input.audienceCompatible,
      audience_note: input.audienceNote,
      is_monitorable: input.isMonitorable,
      is_recurring_source: input.isRecurringSource,
      monitoring_eligibility: input.monitoringEligibility,
      monitoring_block_reason: input.monitoringBlockReason,
      crawlability_status: input.crawlabilityStatus,
      crawlability_http_status: input.crawlabilityHttpStatus,
      crawlability_details: input.crawlabilityDetails,
      source_domain: input.sourceDomain,
      recommended_monitoring_url: input.recommendedMonitoringUrl,
      duplicate_status: input.duplicateStatus,
      duplicate_of_candidate_id: input.duplicateOfCandidateId,
      duplicate_reason: input.duplicateReason,
      raw_batch_id: input.rawBatchId,
    };

    const { data, error } = await supabase
      .from('discovery_candidates')
      .insert(fullPayload)
      .select('*')
      .single();

    if (!error) {
      return {
        saved: true,
        duplicate: false,
        candidate: mapCandidateRow(data as CandidateRow),
      };
    }

    if (error.code === '23505') {
      return { saved: false, duplicate: true };
    }

    // Graceful backward compatibility if user hasn't run 002_phase2b1_discovery_quality.sql yet:
    // keep Phase 2A schema columns + encode Phase 2B.1 structured metadata safely in confidence_note.
    if (isMissingPhase2b1ColumnOrEnumError(error)) {
      const legacyDetectedType: SourceType =
        input.detectedType === 'static_document' ? 'website' : input.detectedType;

      const metaNote = encodeConfidenceWithMeta(input.confidenceNote, {
        dt: input.detectedType,
        cl: input.classification,
        cs: input.confidenceScore,
        ck: input.candidateKind,
        ts: input.temporalStatus,
        ro: input.registrationOpenDate,
        rd: input.registrationDeadline,
        sd: input.competitionStartDate,
        ed: input.competitionEndDate,
        ey: input.eventYear,
        te: input.temporalEvidence,
        tc: input.temporalConfidence,
        ta: input.targetAudience,
        ac: input.audienceCompatible,
        an: input.audienceNote,
        im: input.isMonitorable,
        ir: input.isRecurringSource,
        me: input.monitoringEligibility,
        mbr: input.monitoringBlockReason,
        cr: input.crawlabilityStatus,
        chs: input.crawlabilityHttpStatus,
        cd: input.crawlabilityDetails,
        dom: input.sourceDomain,
        rmu: input.recommendedMonitoringUrl,
        ds: input.duplicateStatus,
        did: input.duplicateOfCandidateId,
        dr: input.duplicateReason,
        rb: input.rawBatchId,
      });

      const { data: legacyData, error: legacyErr } = await supabase
        .from('discovery_candidates')
        .insert({
          suggested_name: input.suggestedName.trim(),
          url: input.normalizedUrl,
          organizer: input.organizer.trim(),
          detected_type: legacyDetectedType,
          discovery_method: 'search_engine',
          matched_keyword: input.matchedKeyword,
          category: input.category,
          confidence_note: metaNote,
          status: 'candidate',
          data_origin: 'tavily_discovery',
        })
        .select('*')
        .single();

      if (legacyErr) {
        if (legacyErr.code === '23505') {
          return { saved: false, duplicate: true };
        }
        unwrapSupabaseError(legacyErr, 'Failed to save discovery candidate');
      }

      return {
        saved: true,
        duplicate: false,
        candidate: mapCandidateRow(legacyData as CandidateRow),
      };
    }

    unwrapSupabaseError(error, 'Failed to save discovery candidate');
  }

  public async createRawDiscoveryBatch(input: {
    provider?: 'tavily' | 'rss_atom';
    modelUsed: string | null;
    status: RawBatchStatus;
    keywords: DiscoveryRawBatch['keywords'];
    rawResults: RawBatchSearchHit[];
  }): Promise<DiscoveryRawBatch> {
    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('discovery_raw_batches')
      .insert({
        provider: input.provider ?? 'tavily',
        model_used: input.modelUsed,
        status: input.status,
        keywords_json: input.keywords,
        raw_results_json: input.rawResults,
        total_raw_hits: input.rawResults.length,
        retry_count: 0,
        last_error: null,
      })
      .select('*')
      .single();

    if (!error) {
      return mapRawBatchRow(data as RawBatchRow);
    }

    if (isMissingTableError(error)) {
      const now = new Date().toISOString();
      const batch: DiscoveryRawBatch = {
        id: crypto.randomUUID(),
        provider: input.provider ?? 'tavily',
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
      const existing = readFallbackRawBatches();
      writeFallbackRawBatches([batch, ...existing]);
      return batch;
    }

    unwrapSupabaseError(error, 'Failed to persist raw discovery batch');
  }

  public async updateRawDiscoveryBatch(
    id: string,
    patch: {
      status?: RawBatchStatus;
      modelUsed?: string | null;
      keywords?: DiscoveryRawBatch['keywords'];
      retryCount?: number;
      lastError?: string | null;
    }
  ): Promise<DiscoveryRawBatch | null> {
    const supabase = this.getClient();
    const payload: Record<string, unknown> = {};
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.modelUsed !== undefined) payload.model_used = patch.modelUsed;
    if (patch.keywords !== undefined) payload.keywords_json = patch.keywords;
    if (patch.retryCount !== undefined) payload.retry_count = patch.retryCount;
    if (patch.lastError !== undefined) payload.last_error = patch.lastError;

    const { data, error } = await supabase
      .from('discovery_raw_batches')
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (!error) {
      return data ? mapRawBatchRow(data as RawBatchRow) : null;
    }

    if (isMissingTableError(error)) {
      const all = readFallbackRawBatches();
      const idx = all.findIndex((b) => b.id === id);
      if (idx === -1) return null;
      const nextKeywords = patch.keywords ?? all[idx].keywords;
      const hasDupMeta = nextKeywords.some((k) => typeof k?.duplicateHits === 'number');
      const hasQueuedMeta = nextKeywords.some((k) => typeof k?.queuedNewHits === 'number');
      const updated: DiscoveryRawBatch = {
        ...all[idx],
        status: patch.status ?? all[idx].status,
        modelUsed: patch.modelUsed !== undefined ? patch.modelUsed : all[idx].modelUsed,
        keywords: nextKeywords,
        duplicateHits: hasDupMeta
          ? nextKeywords.reduce(
              (sum, k) => sum + (typeof k.duplicateHits === 'number' ? k.duplicateHits : 0),
              0
            )
          : all[idx].duplicateHits,
        queuedNewHits: hasQueuedMeta
          ? nextKeywords.reduce(
              (sum, k) => sum + (typeof k.queuedNewHits === 'number' ? k.queuedNewHits : 0),
              0
            )
          : all[idx].queuedNewHits,
        retryCount: patch.retryCount !== undefined ? patch.retryCount : all[idx].retryCount,
        lastError: patch.lastError !== undefined ? patch.lastError : all[idx].lastError,
        updatedAt: new Date().toISOString(),
      };
      all[idx] = updated;
      writeFallbackRawBatches(all);
      return updated;
    }

    unwrapSupabaseError(error, 'Failed to update raw discovery batch');
  }

  public async getRawDiscoveryBatch(id: string): Promise<DiscoveryRawBatch | null> {
    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('discovery_raw_batches')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!error) {
      return data ? mapRawBatchRow(data as RawBatchRow) : null;
    }

    if (isMissingTableError(error)) {
      return readFallbackRawBatches().find((b) => b.id === id) ?? null;
    }

    unwrapSupabaseError(error, 'Failed to load raw discovery batch');
  }

  public async listRawDiscoveryBatches(limit = 15): Promise<DiscoveryRawBatch[]> {
    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('discovery_raw_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!error) {
      return ((data ?? []) as RawBatchRow[]).map(mapRawBatchRow);
    }

    if (isMissingTableError(error)) {
      return readFallbackRawBatches().slice(0, limit);
    }

    unwrapSupabaseError(error, 'Failed to list raw discovery batches');
  }

  public async markKeywordRun(id: string, addedMatches: number, ranAtIso: string): Promise<void> {
    const supabase = this.getClient();
    const { data: current, error: fetchErr } = await supabase
      .from('discovery_keywords')
      .select('matches_found')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !current) return;
    const prevMatches = Number((current as { matches_found: number }).matches_found ?? 0);

    await supabase
      .from('discovery_keywords')
      .update({
        last_run_at: ranAtIso,
        matches_found: prevMatches + Math.max(0, addedMatches),
      })
      .eq('id', id);
  }
}

export const supabaseRadarRepository = new SupabaseRadarRepository();
