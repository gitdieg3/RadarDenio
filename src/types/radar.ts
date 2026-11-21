export type DashboardModule =
  | 'overview'
  | 'discovery'
  | 'registry'
  | 'jobs'
  | 'content'
  | 'logs'
  | 'settings';

export type SourceType =
  | 'website'
  | 'rss_feed'
  | 'public_portal'
  | 'social_reference'
  | 'newsletter_archive'
  | 'static_document';

export type DiscoveryMethod =
  | 'search_engine'
  | 'rss_autodiscovery'
  | 'manual_registration';

export type MonitoringMethod =
  | 'polling'
  | 'rss_feed'
  | 'search_discovery';

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';

export type SourceStatus = 'active' | 'paused' | 'error' | 'pending_connector';

export type DataOrigin =
  | 'seeded_demo'
  | 'user_created'
  | 'dry_run_simulation'
  | 'supabase_db'
  | 'tavily_discovery';

export type TemporalStatus =
  | 'open'
  | 'upcoming'
  | 'closed'
  | 'completed'
  | 'archived'
  | 'unknown';

export type TargetAudience =
  | 'elementary_school'
  | 'junior_high_school'
  | 'senior_high_school'
  | 'university_student'
  | 'general_public'
  | 'professional'
  | 'mixed'
  | 'unknown';

export type DiscoveryClassificationCategory =
  | 'Competition'
  | 'Organizer'
  | 'University'
  | 'Aggregator'
  | 'Community'
  | 'Irrelevant';

export type CandidateKind = 'event' | 'source' | 'unknown';

export type MonitoringEligibility = 'eligible' | 'conditional' | 'ineligible' | 'unknown';

export type CrawlabilityStatus =
  | 'accessible'
  | 'redirect'
  | 'login_wall'
  | 'forbidden_403'
  | 'not_found_404'
  | 'rate_limited_429'
  | 'cloudflare_challenge'
  | 'captcha_blocked'
  | 'timeout'
  | 'empty_html_shell'
  | 'static_pdf'
  | 'social_single_post'
  | 'http_error'
  | 'unknown';

export type DuplicateStatus =
  | 'unique'
  | 'possible_duplicate'
  | 'confirmed_duplicate'
  | 'unknown';

export type TavilyTimeRange = 'day' | 'week' | 'month' | 'year';

export type RawBatchStatus =
  | 'search_completed'
  | 'classifying'
  | 'completed'
  | 'classification_failed';

export interface CompetitionSource {
  id: string;
  name: string;
  url: string;
  sourceType: SourceType;
  discoveryMethod: DiscoveryMethod;
  monitoringMethod: MonitoringMethod;
  category: string;
  priority: PriorityLevel;
  status: SourceStatus;
  pollingIntervalMinutes: number;
  lastCheckedAt: string | null;
  lastSuccessfulCheckAt: string | null;
  errorInfo: string | null;
  contentFingerprint: string | null;
  dataOrigin: DataOrigin;
  createdAt: string;
}

export interface CreateSourceInput {
  name: string;
  url: string;
  sourceType: SourceType;
  discoveryMethod: DiscoveryMethod;
  monitoringMethod: MonitoringMethod;
  category: string;
  priority: PriorityLevel;
  status?: SourceStatus;
  pollingIntervalMinutes?: number;
}

export type JobStatus =
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'blocked_no_connector'
  | 'failed';

export type DedupStrategy = 'url_and_fingerprint' | 'feed_guid' | 'timestamp_delta';

export interface MonitoringJob {
  id: string;
  name: string;
  sourceId: string | null;
  sourceName: string;
  monitoringMethod: MonitoringMethod;
  intervalMinutes: number;
  dedupStrategy: DedupStrategy;
  status: JobStatus;
  lastRunAt: string | null;
  nextRunAt: string | null;
  itemsDetected: number;
  duplicatesSkipped: number;
  lastError: string | null;
  dataOrigin: DataOrigin;
}

export interface CreateJobInput {
  name: string;
  sourceId: string | null;
  monitoringMethod: MonitoringMethod;
  intervalMinutes: number;
  dedupStrategy: DedupStrategy;
}

export interface DiscoveryKeyword {
  id: string;
  phrase: string;
  category: string;
  region: string;
  enabled: boolean;
  matchesFound: number;
  lastRunAt: string | null;
  dataOrigin: DataOrigin;
}

export interface DiscoveryCandidate {
  id: string;
  suggestedName: string;
  url: string;
  organizer: string;
  detectedType: SourceType;
  discoveryMethod: DiscoveryMethod;
  matchedKeyword: string;
  category: string;
  confidenceNote: string;
  status: 'candidate' | 'promoted' | 'dismissed';
  dataOrigin: DataOrigin;
  discoveredAt: string;
  // Phase 2B.1 structured quality & monitoring readiness fields
  classification?: DiscoveryClassificationCategory;
  confidenceScore?: number;
  candidateKind?: CandidateKind;
  temporalStatus?: TemporalStatus;
  registrationOpenDate?: string | null;
  registrationDeadline?: string | null;
  competitionStartDate?: string | null;
  competitionEndDate?: string | null;
  eventYear?: number | null;
  temporalEvidence?: string | null;
  temporalConfidence?: number | null;
  targetAudience?: TargetAudience;
  audienceCompatible?: boolean;
  audienceNote?: string | null;
  isMonitorable?: boolean;
  isRecurringSource?: boolean;
  monitoringEligibility?: MonitoringEligibility;
  monitoringBlockReason?: string | null;
  crawlabilityStatus?: CrawlabilityStatus;
  crawlabilityHttpStatus?: number | null;
  crawlabilityDetails?: string | null;
  sourceDomain?: string | null;
  recommendedMonitoringUrl?: string | null;
  duplicateStatus?: DuplicateStatus;
  duplicateOfCandidateId?: string | null;
  duplicateReason?: string | null;
  rawBatchId?: string | null;
  rssFeedId?: string | null;
}

export interface DiscoveredContentItem {
  id: string;
  sourceId: string | null;
  sourceName: string;
  title: string;
  organizer: string;
  competitionUrl: string;
  category: string;
  discoveryMethod: DiscoveryMethod;
  fingerprintHash: string;
  deadlineDate: string | null;
  prizePool: string | null;
  reviewStatus: 'new' | 'verified' | 'archived';
  dataOrigin: DataOrigin;
  discoveredAt: string;
  temporalStatus?: TemporalStatus;
  targetAudience?: TargetAudience;
  sourceDomain?: string | null;
  crawlabilityStatus?: CrawlabilityStatus;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface SystemLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  details: string | null;
}

export interface EngineSettings {
  defaultPollingIntervalMinutes: number;
  defaultDedupStrategy: DedupStrategy;
  maxConcurrentJobs: number;
  autoPromoteVerifiedRss: boolean;
}

export interface ConnectorReadiness {
  id: string;
  name: string;
  configured: boolean;
  mode: 'ready' | 'disconnected' | 'phase_2_pending';
  summary: string;
  requiredEnvVars: string[];
}

export interface TableHealthStatus {
  table: string;
  readable: boolean;
  rowCount: number | null;
  error: string | null;
}

export type ActiveEnvironment = 'staging' | 'production' | 'unconfigured';

export interface RadarSystemHealth {
  activeEnvironment: ActiveEnvironment;
  supabaseTargetHost: string | null;
  storageMode: 'supabase_postgres' | 'supabase_disconnected';
  isDemoFallbackActive: boolean;
  geminiConfigured: boolean;
  supabaseConfigured: boolean;
  supabaseConnected: boolean;
  supabaseError: string | null;
  tableStatuses: TableHealthStatus[];
  searchConnectorConfigured: boolean;
  connectors: ConnectorReadiness[];
  serverTime: string;
  phase2b1MigrationReady?: boolean;
  phase2cMigrationReady?: boolean;
}

export interface RawBatchSearchHit {
  index: number;
  keywordId: string;
  keywordPhrase: string;
  targetCategory: string;
  targetRegion: string;
  querySent: string;
  normalizedUrl: string;
  hit: {
    title: string;
    url: string;
    content: string;
    score: number;
    publishedDate: string | null;
  };
}

export interface DiscoveryRawBatch {
  id: string;
  provider: 'tavily' | 'rss_atom';
  modelUsed: string | null;
  status: RawBatchStatus;
  keywords: {
    keywordId: string;
    phrase: string;
    category: string;
    region: string;
    querySent: string;
    rawResultsCount: number;
    duplicateHits?: number;
    queuedNewHits?: number;
    error: string | null;
  }[];
  rawResults: RawBatchSearchHit[];
  totalRawHits: number;
  duplicateHits?: number;
  queuedNewHits?: number;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RadarSnapshot {
  health: RadarSystemHealth;
  sources: CompetitionSource[];
  jobs: MonitoringJob[];
  keywords: DiscoveryKeyword[];
  candidates: DiscoveryCandidate[];
  content: DiscoveredContentItem[];
  logs: SystemLogEntry[];
  settings: EngineSettings;
  rawBatches?: DiscoveryRawBatch[];
}

export interface DiscoveryRunRequest {
  keywordIds?: string[];
  maxKeywords?: number;
  maxResultsPerKeyword?: number;
  timeRange?: TavilyTimeRange | 'all';
  excludeDomains?: string[];
}

export interface DiscoveryRunCandidatePreview {
  title: string;
  url: string;
  normalizedUrl: string;
  matchedKeyword: string;
  classification: DiscoveryClassificationCategory;
  confidenceScore: number;
  reason: string;
  outcome: 'saved' | 'duplicate' | 'rejected';
  suggestedName?: string;
  organizer?: string;
  detectedType?: SourceType;
  candidateKind?: CandidateKind;
  temporalStatus?: TemporalStatus;
  registrationDeadline?: string | null;
  temporalEvidence?: string | null;
  targetAudience?: TargetAudience;
  audienceCompatible?: boolean;
  crawlabilityStatus?: CrawlabilityStatus;
  monitoringEligibility?: MonitoringEligibility;
  monitoringBlockReason?: string | null;
  duplicateStatus?: DuplicateStatus;
  duplicateReason?: string | null;
  sourceDomain?: string;
}

export interface DiscoveryRunKeywordSummary {
  keywordId: string;
  phrase: string;
  category: string;
  region: string;
  querySent: string;
  rawResultsCount: number;
  relevantCount: number;
  savedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  error: string | null;
}

export interface DiscoveryRunResult {
  rawBatchId?: string;
  batchStatus?: RawBatchStatus;
  provider: 'tavily';
  modelUsed: string;
  executedAt: string;
  wibDate?: string;
  keywordsProcessed: number;
  totalResultsFound: number;
  totalRawHits: number;
  duplicateHits: number;
  queuedNewHits: number;
  rawBatchMetrics?: {
    total_raw_hits: number;
    duplicate_hits: number;
    queued_new_hits: number;
  };
  relevantCount: number;
  savedCandidatesCount: number;
  duplicatesSkipped: number;
  rejectedIrrelevantCount: number;
  retryCount?: number;
  lastError: string | null;
  keywordSummaries: DiscoveryRunKeywordSummary[];
  items: DiscoveryRunCandidatePreview[];
}

// --- Phase 2C: RSS/Atom Discovery Engine Types (Aligned 1:1 with 003_phase2c_rss_discovery.sql) ---

export type RssFeedFormat = 'rss2' | 'rss1_rdf' | 'atom' | 'unknown';

export type RssFeedDiscoveryOrigin = 'autodiscovered' | 'manual' | 'promoted_candidate';

export type RssFeedStatus = 'pending_verification' | 'active' | 'paused' | 'error';

export type RssFetchLogStatus =
  | 'fetched_new'
  | 'not_modified_304'
  | 'no_new_items'
  | 'fetch_failed'
  | 'parse_failed'
  | 'classification_failed';

export interface RssFeed {
  id: string;
  sourceId: string | null;
  feedName: string;
  feedUrl: string;
  parentSiteUrl: string | null;
  sourceDomain: string | null;
  feedFormat: RssFeedFormat;
  discoveryOrigin: RssFeedDiscoveryOrigin;
  category: string;
  status: RssFeedStatus;
  verified: boolean;
  fetchIntervalMinutes: number;
  etag: string | null;
  lastModified: string | null;
  lastContentHash: string | null;
  lastHttpStatus: number | null;
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  itemsDiscoveredTotal: number;
  lastBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RssFetchLog {
  id: string;
  feedId: string;
  rawBatchId: string | null;
  status: RssFetchLogStatus;
  httpStatus: number | null;
  durationMs: number | null;
  itemsFound: number;
  newItems: number;
  duplicateItems: number;
  changedItems: number;
  candidatesSaved: number;
  errorMessage: string | null;
  fetchedAt: string;
}

export type RssItemIdentityType = 'url' | 'guid' | 'fallback_hash';

export interface RssItemFingerprint {
  id: string;
  feedId: string;
  identityType: RssItemIdentityType;
  itemKey: string;
  normalizedUrl: string | null;
  itemGuid: string | null;
  fallbackFingerprint: string | null;
  contentHash: string;
  candidateId: string | null;
  itemPublishedAt: string | null;
  changeCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface CreateRssFeedInput {
  feedName: string;
  feedUrl: string;
  parentSiteUrl?: string | null;
  sourceId?: string | null;
  category?: string;
  discoveryOrigin?: RssFeedDiscoveryOrigin;
  fetchIntervalMinutes?: number;
}

export interface UpdateRssFeedInput {
  feedName?: string;
  parentSiteUrl?: string | null;
  sourceId?: string | null;
  category?: string;
  status?: RssFeedStatus;
  verified?: boolean;
  fetchIntervalMinutes?: number;
}

