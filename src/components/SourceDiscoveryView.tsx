import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  CopyCheck,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type {
  CandidateKind,
  CrawlabilityStatus,
  DiscoveryCandidate,
  DiscoveryKeyword,
  DiscoveryRawBatch,
  DiscoveryRunRequest,
  DiscoveryRunResult,
  RadarSystemHealth,
  TargetAudience,
  TavilyTimeRange,
  TemporalStatus,
} from '../types/radar';
import { filterDiscoveryCandidates } from '../utils/discoveryQuality';
import {
  formatDiscoveryMethodLabel,
  formatSourceTypeLabel,
  formatTimestampCompact,
} from '../utils/radarLogic';
import { DataOriginText } from './StatusText';

interface SourceDiscoveryViewProps {
  health: RadarSystemHealth;
  keywords: DiscoveryKeyword[];
  candidates: DiscoveryCandidate[];
  rawBatches: DiscoveryRawBatch[];
  lastDiscoveryRun: DiscoveryRunResult | null;
  onRunLiveDiscovery: (req?: DiscoveryRunRequest) => Promise<DiscoveryRunResult>;
  onRetryBatchClassification: (batchId: string) => Promise<DiscoveryRunResult>;
  onCreateKeyword: (phrase: string, category: string, region: string) => Promise<void>;
  onToggleKeyword: (id: string) => Promise<void>;
  onPromoteCandidate: (id: string) => Promise<void>;
  onDismissCandidate: (id: string) => Promise<void>;
}

function formatTemporalLabel(status: TemporalStatus | undefined): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'upcoming':
      return 'Upcoming';
    case 'closed':
      return 'Closed';
    case 'completed':
      return 'Completed';
    case 'archived':
      return 'Archived';
    default:
      return 'Unknown';
  }
}

function temporalTextColor(status: TemporalStatus | undefined): string {
  switch (status) {
    case 'open':
      return 'text-emerald-400';
    case 'upcoming':
      return 'text-sky-400';
    case 'closed':
    case 'completed':
    case 'archived':
      return 'text-rose-400';
    default:
      return 'text-slate-400';
  }
}

function formatAudienceLabel(audience: TargetAudience | undefined): string {
  if (!audience || audience === 'unknown') return 'Audience unknown';
  return audience.replace(/_/g, ' ');
}

function formatCrawlabilityLabel(status: CrawlabilityStatus | undefined): string {
  if (!status || status === 'unknown') return 'Unchecked';
  return status.replace(/_/g, ' ');
}

function getMonitorabilityState(cand: DiscoveryCandidate): 'eligible' | 'blocked' | 'legacy_unverified' {
  if (cand.monitoringEligibility === 'ineligible' || cand.isMonitorable === false) {
    return 'blocked';
  }
  if (cand.detectedType === 'social_reference' || cand.detectedType === 'static_document') {
    return 'blocked';
  }
  if (
    /instagram\.com|linkedin\.com\/posts|youtube\.com\/watch|tiktok\.com|\.pdf($|\?)/i.test(
      cand.url
    )
  ) {
    return 'blocked';
  }
  if (
    cand.temporalStatus === 'closed' ||
    cand.temporalStatus === 'completed' ||
    cand.temporalStatus === 'archived'
  ) {
    return 'blocked';
  }
  if (cand.candidateKind === 'event') {
    return 'blocked';
  }
  if (cand.monitoringEligibility === 'eligible' || cand.isMonitorable === true) {
    return 'eligible';
  }
  return 'legacy_unverified';
}

export function SourceDiscoveryView({
  health,
  keywords,
  candidates,
  rawBatches,
  lastDiscoveryRun,
  onRunLiveDiscovery,
  onRetryBatchClassification,
  onCreateKeyword,
  onToggleKeyword,
  onPromoteCandidate,
  onDismissCandidate,
}: SourceDiscoveryViewProps) {
  const [phrase, setPhrase] = useState('');
  const [category, setCategory] = useState('AI & Data Science');
  const [region, setRegion] = useState('Indonesia');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [maxKeywords, setMaxKeywords] = useState<number>(3);
  const [maxResultsPerKeyword, setMaxResultsPerKeyword] = useState<number>(5);
  const [timeRange, setTimeRange] = useState<TavilyTimeRange | 'all'>('all');
  const [runningDiscovery, setRunningDiscovery] = useState(false);
  const [retryingBatchId, setRetryingBatchId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);

  // Phase 2B.1 Review Filters
  const [candQuery, setCandQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<CandidateKind | 'all'>('all');
  const [temporalFilter, setTemporalFilter] = useState<TemporalStatus | 'all'>('all');
  const [eligibilityFilter, setEligibilityFilter] = useState<
    'all' | 'monitorable' | 'not_monitorable'
  >('all');
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);

  const enabledKeywords = keywords.filter((kw) => kw.enabled);
  const activeCandidates = candidates.filter((c) => c.status === 'candidate');
  const failedBatches = rawBatches.filter((b) => b.status === 'classification_failed');
  const connectorsReady = health.searchConnectorConfigured && health.geminiConfigured;

  const filteredCandidates = useMemo(
    () =>
      filterDiscoveryCandidates(activeCandidates, {
        query: candQuery,
        kind: kindFilter,
        temporalStatus: temporalFilter,
        eligibility: eligibilityFilter,
        duplicatesOnly,
      }),
    [activeCandidates, candQuery, kindFilter, temporalFilter, eligibilityFilter, duplicatesOnly]
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (phrase.trim().length < 3) {
      setFormError('Enter a search query phrase of at least 3 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await onCreateKeyword(phrase.trim(), category.trim(), region.trim());
      setPhrase('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to add keyword.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunDiscovery = async () => {
    setRunError(null);
    setActionError(null);
    setRunningDiscovery(true);
    try {
      await onRunLiveDiscovery({
        maxKeywords,
        maxResultsPerKeyword,
        timeRange,
      });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Live discovery execution failed.');
    } finally {
      setRunningDiscovery(false);
    }
  };

  const handleRetryBatch = async (batchId: string) => {
    setRunError(null);
    setRetryingBatchId(batchId);
    try {
      await onRetryBatchClassification(batchId);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Batch classification retry failed.');
    } finally {
      setRetryingBatchId(null);
    }
  };

  const handleCandidateAction = async (id: string, action: 'promote' | 'dismiss') => {
    setActionError(null);
    setBusyCandidateId(id);
    try {
      if (action === 'promote') {
        await onPromoteCandidate(id);
      } else {
        await onDismissCandidate(id);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Candidate update failed.');
    } finally {
      setBusyCandidateId(null);
    }
  };

  const displayedError = runError || lastDiscoveryRun?.lastError || null;

  return (
    <div className="space-y-8">
      {/* Live Search Discovery Control Panel */}
      <section className="p-5 rounded-lg bg-[#0B1120] border border-slate-800/90 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
                <Search className="w-4 h-4 text-orange-400" aria-hidden="true" />
                <span>Live Search Engine Discovery (Phase 2B.1)</span>
              </h2>
              <span
                className={`text-xs font-mono ${
                  connectorsReady ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {connectorsReady
                  ? 'Tavily Search + Polite Probe + Gemini Classifier Live'
                  : 'Server Connector Unconfigured'}
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Executes live Tavily queries, persists raw results before classification, runs polite
              single-GET crawlability checks, and validates WIB temporal eligibility, audience fit,
              source monitorability, and 3-level deduplication with{' '}
              <code className="font-mono text-slate-300">gemini-4-hydrogen</code>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Time</span>
              <select
                aria-label="Tavily time range"
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as TavilyTimeRange | 'all')}
                disabled={runningDiscovery}
                className="px-2 py-1.5 rounded bg-[#060A14] border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-orange-500"
              >
                <option value="all">All Time</option>
                <option value="year">Past Year</option>
                <option value="month">Past Month</option>
                <option value="week">Past Week</option>
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Keywords</span>
              <select
                aria-label="Max keywords per run"
                value={maxKeywords}
                onChange={(e) => setMaxKeywords(Number(e.target.value))}
                disabled={runningDiscovery}
                className="px-2 py-1.5 rounded bg-[#060A14] border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-orange-500"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3 (max)</option>
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Results/kw</span>
              <select
                aria-label="Max results per keyword"
                value={maxResultsPerKeyword}
                onChange={(e) => setMaxResultsPerKeyword(Number(e.target.value))}
                disabled={runningDiscovery}
                className="px-2 py-1.5 rounded bg-[#060A14] border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-orange-500"
              >
                <option value={3}>3</option>
                <option value={5}>5</option>
                <option value={6}>6</option>
              </select>
            </label>

            <button
              type="button"
              onClick={handleRunDiscovery}
              disabled={runningDiscovery || !connectorsReady || enabledKeywords.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {runningDiscovery ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Discovering & Verifying...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Run Live Discovery</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Status & Telemetry Strip */}
        <div className="pt-4 border-t border-slate-800/80 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              {runningDiscovery ? (
                <span className="text-orange-400 font-medium flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>
                    Querying Tavily, probing crawlability, and classifying with WIB context...
                  </span>
                </span>
              ) : displayedError ? (
                <span className="text-rose-400 font-medium flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Last Run Encountered an Error</span>
                </span>
              ) : lastDiscoveryRun ? (
                <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    Live Run Completed ({lastDiscoveryRun.keywordsProcessed} keyword
                    {lastDiscoveryRun.keywordsProcessed === 1 ? '' : 's'} · Model{' '}
                    {lastDiscoveryRun.modelUsed}
                    {lastDiscoveryRun.wibDate ? ` · WIB ${lastDiscoveryRun.wibDate}` : ''})
                  </span>
                </span>
              ) : (
                <span className="text-slate-400">
                  Ready — {enabledKeywords.length} active keyword
                  {enabledKeywords.length === 1 ? '' : 's'} queued for live Tavily search.
                </span>
              )}
            </div>
            <span className="font-mono text-slate-400 tabular-nums">
              Last search:{' '}
              {lastDiscoveryRun ? formatTimestampCompact(lastDiscoveryRun.executedAt) : 'Not run yet'}
            </span>
          </div>

          {displayedError && (
            <div className="p-3 rounded bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {displayedError}
            </div>
          )}

          {/* Failed Raw Batches Replay Banner (Cost-Saving Recovery) */}
          {failedBatches.length > 0 && (
            <div className="p-4 rounded bg-amber-500/10 border border-amber-500/30 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {failedBatches.length} Saved Raw Tavily Batch(es) Pending Classification Replay
                </span>
              </div>
              <div className="divide-y divide-amber-500/20">
                {failedBatches.map((batch) => (
                  <div
                    key={batch.id}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <p className="font-mono text-amber-200">
                        Batch {batch.id.slice(0, 8)} · {batch.totalRawHits} raw Tavily hit(s) saved ·{' '}
                        {batch.retryCount} retries attempted
                      </p>
                      <p className="text-amber-300/80 truncate">
                        {batch.lastError ?? 'Gemini classification failed after retries.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={retryingBatchId === batch.id}
                      onClick={() => handleRetryBatch(batch.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      <RotateCcw
                        className={`w-3.5 h-3.5 ${
                          retryingBatchId === batch.id ? 'animate-spin' : ''
                        }`}
                        aria-hidden="true"
                      />
                      <span>
                        {retryingBatchId === batch.id
                          ? 'Replaying...'
                          : 'Retry Classification (No Tavily Cost)'}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {lastDiscoveryRun && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded bg-[#060A14] border border-slate-800/80">
                <p className="text-[11px] text-slate-400">Results Found (Tavily)</p>
                <p className="text-xl font-display font-bold text-slate-100 tabular-nums mt-0.5">
                  {lastDiscoveryRun.totalRawHits ?? lastDiscoveryRun.totalResultsFound}{' '}
                  <span className="text-xs font-mono font-normal text-slate-400">
                    ({lastDiscoveryRun.queuedNewHits ?? 0} queued ·{' '}
                    {lastDiscoveryRun.duplicateHits ?? lastDiscoveryRun.duplicatesSkipped} dup)
                  </span>
                </p>
              </div>
              <div className="p-3 rounded bg-[#060A14] border border-slate-800/80">
                <p className="text-[11px] text-slate-400">Relevant Candidates</p>
                <p className="text-xl font-display font-bold text-emerald-400 tabular-nums mt-0.5">
                  {lastDiscoveryRun.relevantCount}{' '}
                  <span className="text-xs font-mono font-normal text-slate-400">
                    ({lastDiscoveryRun.savedCandidatesCount} saved)
                  </span>
                </p>
              </div>
              <div className="p-3 rounded bg-[#060A14] border border-slate-800/80">
                <p className="text-[11px] text-slate-400">Duplicates Skipped</p>
                <p className="text-xl font-display font-bold text-amber-400 tabular-nums mt-0.5">
                  {lastDiscoveryRun.duplicatesSkipped}
                </p>
              </div>
              <div className="p-3 rounded bg-[#060A14] border border-slate-800/80">
                <p className="text-[11px] text-slate-400">Rejected (Irrelevant)</p>
                <p className="text-xl font-display font-bold text-slate-300 tabular-nums mt-0.5">
                  {lastDiscoveryRun.rejectedIrrelevantCount}
                </p>
              </div>
            </div>
          )}

          {lastDiscoveryRun && lastDiscoveryRun.items.length > 0 && (
            <div className="rounded border border-slate-800/80 bg-[#060A14] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-200">
                  Latest Discovery Run Output
                </span>
                <span className="font-mono text-slate-500 tabular-nums">
                  {lastDiscoveryRun.items.length} evaluated URLs
                </span>
              </div>
              <div className="divide-y divide-slate-800/70 max-h-72 overflow-y-auto">
                {lastDiscoveryRun.items.map((item, idx) => (
                  <div
                    key={`${item.normalizedUrl}-${idx}`}
                    className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium text-slate-100 truncate">{item.title}</p>
                      <p className="font-mono text-[11px] text-slate-400 truncate">
                        {item.normalizedUrl}
                      </p>
                      <p className="text-[11px] text-slate-400">{item.reason}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0 font-mono text-[11px]">
                      <span
                        className={
                          item.classification === 'Irrelevant'
                            ? 'text-slate-500'
                            : 'text-orange-400'
                        }
                      >
                        {item.classification} · {item.confidenceScore}%
                      </span>
                      {item.temporalStatus && (
                        <span className={temporalTextColor(item.temporalStatus)}>
                          · {formatTemporalLabel(item.temporalStatus)}
                        </span>
                      )}
                      {item.crawlabilityStatus && (
                        <span className="text-slate-400">
                          · {formatCrawlabilityLabel(item.crawlabilityStatus)}
                        </span>
                      )}
                      <span
                        className={
                          item.outcome === 'saved'
                            ? 'text-emerald-400'
                            : item.outcome === 'duplicate'
                            ? 'text-amber-400'
                            : 'text-slate-500'
                        }
                      >
                        ·{' '}
                        {item.outcome === 'saved'
                          ? 'Saved'
                          : item.outcome === 'duplicate'
                          ? 'Duplicate'
                          : 'Rejected'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Keyword Configuration */}
      <section className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80">
          <h3 className="font-display font-semibold text-sm text-slate-100">
            Discovery Keyword Profiles
          </h3>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-5 border-b border-slate-800/80 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
          noValidate
        >
          <div className="md:col-span-5">
            <label htmlFor="kw-phrase" className="block text-xs font-medium text-slate-300 mb-1.5">
              Keyword Query
            </label>
            <input
              id="kw-phrase"
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder='lomba programming mahasiswa 2026'
              className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
            />
          </div>
          <div className="md:col-span-3">
            <label htmlFor="kw-category" className="block text-xs font-medium text-slate-300 mb-1.5">
              Target Category
            </label>
            <input
              id="kw-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="kw-region" className="block text-xs font-medium text-slate-300 mb-1.5">
              Region
            </label>
            <input
              id="kw-region"
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-slate-950 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Keyword</span>
            </button>
          </div>
          {formError && <p className="md:col-span-12 text-xs text-rose-400">{formError}</p>}
        </form>

        {keywords.length === 0 ? (
          <div className="p-8 text-center space-y-1">
            <p className="text-sm font-medium text-slate-300">No discovery keywords saved yet</p>
            <p className="text-xs text-slate-500">
              Add a keyword query above to store discovery profiles in Supabase.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {keywords.map((kw) => (
              <div
                key={kw.id}
                className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-mono text-slate-100 break-all">{kw.phrase}</p>
                  <p className="text-xs text-slate-400">
                    {kw.category} · {kw.region} ·{' '}
                    <span className="font-mono tabular-nums">{kw.matchesFound} saved</span> ·{' '}
                    <span className="font-mono tabular-nums">
                      Last run: {formatTimestampCompact(kw.lastRunAt)}
                    </span>{' '}
                    · <DataOriginText origin={kw.dataOrigin} />
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-xs font-mono ${
                      kw.enabled ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {kw.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleKeyword(kw.id)}
                    className="px-3 py-1.5 rounded border border-slate-700 hover:border-slate-600 text-xs text-slate-200 hover:bg-slate-800/60 transition-colors"
                  >
                    {kw.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Candidate Sources & Events Review Queue */}
      <section className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Staged Discovery Review Queue
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Separates monitorable recurring sources from one-off competition events, expired
              timelines, and blocked URLs before promotion to Source Registry.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            {filteredCandidates.length} shown / {activeCandidates.length} pending
          </span>
        </div>

        {/* Phase 2B.1 Filter Toolbar */}
        <div className="px-5 py-3.5 border-b border-slate-800/80 bg-[#080D1A] space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search
                className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Filter staged candidates"
                value={candQuery}
                onChange={(e) => setCandQuery(e.target.value)}
                placeholder="Filter by title, domain, organizer, or keyword..."
                className="w-full pl-8 pr-3 py-1.5 rounded bg-[#060A14] border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-0.5 rounded bg-[#060A14] border border-slate-800">
                {(
                  [
                    ['all', 'All'],
                    ['event', 'Event Candidates'],
                    ['source', 'Source Candidates'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setKindFilter(value)}
                    className={`px-2.5 py-1 rounded text-xs transition-colors whitespace-nowrap ${
                      kindFilter === value
                        ? 'bg-orange-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-0.5 rounded bg-[#060A14] border border-slate-800">
                {(
                  [
                    ['all', 'All'],
                    ['monitorable', 'Monitorable'],
                    ['not_monitorable', 'Not Monitorable'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setEligibilityFilter(value)}
                    className={`px-2.5 py-1 rounded text-xs transition-colors whitespace-nowrap ${
                      eligibilityFilter === value
                        ? 'bg-orange-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <label className="flex items-center gap-2 text-slate-400">
              <span>Temporal Status</span>
              <select
                aria-label="Filter staged candidates by temporal status"
                value={temporalFilter}
                onChange={(e) => setTemporalFilter(e.target.value as TemporalStatus | 'all')}
                className="px-2.5 py-1 rounded bg-[#060A14] border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-orange-500"
              >
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="upcoming">Upcoming</option>
                <option value="closed">Closed</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>

            <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={duplicatesOnly}
                onChange={(e) => setDuplicatesOnly(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-600 bg-[#060A14] text-orange-500 focus:ring-orange-500"
              />
              <span>Possible / Confirmed Duplicates Only</span>
            </label>
          </div>
        </div>

        {actionError && (
          <div className="mx-5 mt-4 p-3 rounded bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
            {actionError}
          </div>
        )}

        {filteredCandidates.length === 0 ? (
          <div className="p-8 text-center space-y-1">
            <p className="text-sm font-medium text-slate-300">
              {activeCandidates.length === 0
                ? 'No pending candidates in queue'
                : 'No staged candidates match the active filters'}
            </p>
            <p className="text-xs text-slate-500">
              {activeCandidates.length === 0
                ? 'Click Run Live Discovery above to query Tavily and classify new competition sources.'
                : 'Reset one or more filters above to view all staged candidates.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {filteredCandidates.map((cand) => {
              const monState = getMonitorabilityState(cand);
              const blocked = monState === 'blocked';
              const kindLabel =
                cand.candidateKind === 'source'
                  ? 'Source Candidate'
                  : cand.candidateKind === 'event'
                  ? 'Event Candidate'
                  : 'Legacy Candidate';
              const hasDupWarning =
                cand.duplicateStatus === 'possible_duplicate' ||
                cand.duplicateStatus === 'confirmed_duplicate';

              return (
                <div
                  key={cand.id}
                  className="p-5 flex flex-col lg:flex-row lg:items-start justify-between gap-4"
                >
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap text-xs">
                      <p className="text-sm font-semibold text-slate-100">{cand.suggestedName}</p>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span
                        className={`font-mono ${
                          cand.candidateKind === 'source' ? 'text-sky-400' : 'text-slate-300'
                        }`}
                      >
                        {kindLabel}
                      </span>
                      {cand.classification && (
                        <>
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono text-orange-400">
                            {cand.classification}
                            {typeof cand.confidenceScore === 'number'
                              ? ` (${cand.confidenceScore}%)`
                              : ''}
                          </span>
                        </>
                      )}
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <DataOriginText origin={cand.dataOrigin} />
                    </div>

                    <p className="text-xs font-mono text-slate-400 truncate">
                      {cand.url}
                      {cand.sourceDomain ? ` · ${cand.sourceDomain}` : ''}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
                      <span>{cand.organizer}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatSourceTypeLabel(cand.detectedType)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDiscoveryMethodLabel(cand.discoveryMethod)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Keyword:{' '}
                        <span className="font-mono text-slate-300">{cand.matchedKeyword}</span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatTimestampCompact(cand.discoveredAt)}
                      </span>
                    </div>

                    {/* Phase 2B.1 Temporal, Audience, Crawlability & Monitorability Line */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono">
                      <span
                        className={`inline-flex items-center gap-1 ${temporalTextColor(
                          cand.temporalStatus
                        )}`}
                      >
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        <span>Timeline: {formatTemporalLabel(cand.temporalStatus)}</span>
                      </span>
                      {cand.registrationDeadline && (
                        <span className="text-slate-300 tabular-nums">
                          · Deadline {cand.registrationDeadline}
                        </span>
                      )}
                      <span
                        className={
                          cand.audienceCompatible === false ? 'text-amber-400' : 'text-slate-300'
                        }
                      >
                        · {formatAudienceLabel(cand.targetAudience)}
                        {cand.audienceCompatible === false ? ' (Mismatch)' : ''}
                      </span>
                      <span className="text-slate-400">
                        · Crawl: {formatCrawlabilityLabel(cand.crawlabilityStatus)}
                        {cand.crawlabilityHttpStatus ? ` (${cand.crawlabilityHttpStatus})` : ''}
                      </span>
                      <span
                        className={
                          monState === 'blocked'
                            ? 'text-rose-400'
                            : monState === 'eligible'
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }
                      >
                        ·{' '}
                        {monState === 'blocked'
                          ? 'Not Monitorable'
                          : monState === 'eligible'
                          ? 'Monitorable Source'
                          : 'Unverified (Pre-2B.1)'}
                      </span>
                    </div>

                    {cand.temporalEvidence && (
                      <p className="text-[11px] text-slate-400">
                        Temporal clue: {cand.temporalEvidence}
                      </p>
                    )}

                    {cand.audienceCompatible === false && cand.audienceNote && (
                      <p className="text-[11px] text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>{cand.audienceNote}</span>
                      </p>
                    )}

                    {hasDupWarning && (
                      <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
                        <CopyCheck className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>
                          {cand.duplicateStatus === 'confirmed_duplicate'
                            ? 'Confirmed duplicate: '
                            : 'Possible duplicate: '}
                          {cand.duplicateReason}
                        </span>
                      </p>
                    )}

                    {blocked && cand.monitoringBlockReason && (
                      <p className="text-[11px] text-rose-300 flex items-center gap-1.5">
                        <ShieldAlert className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>
                          {cand.monitoringBlockReason}
                          {cand.recommendedMonitoringUrl
                            ? ` Recommended root: ${cand.recommendedMonitoringUrl}`
                            : ''}
                        </span>
                      </p>
                    )}

                    <p className="text-xs text-slate-300">{cand.confidenceNote}</p>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      disabled={busyCandidateId === cand.id}
                      onClick={() => handleCandidateAction(cand.id, 'dismiss')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-700 hover:border-slate-600 disabled:opacity-50 text-xs font-medium text-slate-300 hover:bg-slate-800/60 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Dismiss</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyCandidateId === cand.id || blocked}
                      title={
                        blocked
                          ? cand.monitoringBlockReason ??
                            'Blocked: Not eligible for Source Registry monitoring.'
                          : 'Promote recurring source to Source Registry'
                      }
                      onClick={() => handleCandidateAction(cand.id, 'promote')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-xs font-semibold transition-colors whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Promote to Registry</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
