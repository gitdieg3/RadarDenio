import { Archive, CheckCircle2, ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DiscoveredContentItem, TemporalStatus } from '../types/radar';
import { formatDiscoveryMethodLabel, formatTimestampCompact } from '../utils/radarLogic';
import { DataOriginText } from './StatusText';

interface DiscoveredContentViewProps {
  items: DiscoveredContentItem[];
  onUpdateStatus: (
    id: string,
    status: DiscoveredContentItem['reviewStatus']
  ) => Promise<void>;
}

const TEMPORAL_OPTIONS: { value: TemporalStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Timelines' },
  { value: 'open', label: 'Open' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'closed', label: 'Closed' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
  { value: 'unknown', label: 'Unknown' },
];

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

function getTemporalColor(status: TemporalStatus | undefined): string {
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

export function DiscoveredContentView({
  items,
  onUpdateStatus,
}: DiscoveredContentViewProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    DiscoveredContentItem['reviewStatus'] | 'all'
  >('all');
  const [temporalFilter, setTemporalFilter] = useState<TemporalStatus | 'all'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== 'all' && item.reviewStatus !== statusFilter) {
        return false;
      }
      const itemTemporal = item.temporalStatus ?? 'unknown';
      if (temporalFilter !== 'all' && itemTemporal !== temporalFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.organizer.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.fingerprintHash.toLowerCase().includes(q) ||
        (item.sourceDomain ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, query, statusFilter, temporalFilter]);

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-lg bg-[#0B1120] border border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search discovered competitions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, organizer, domain, or fingerprint..."
            className="w-full pl-9 pr-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <span>Temporal</span>
            <select
              aria-label="Filter by temporal status"
              value={temporalFilter}
              onChange={(e) => setTemporalFilter(e.target.value as TemporalStatus | 'all')}
              className="px-2.5 py-1.5 rounded bg-[#060A14] border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-orange-500"
            >
              {TEMPORAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1 p-1 rounded-md bg-[#060A14] border border-slate-800">
            {(['all', 'new', 'verified', 'archived'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors capitalize whitespace-nowrap ${
                  statusFilter === tab
                    ? 'bg-orange-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-1.5">
            <p className="text-sm font-medium text-slate-200">No discovered content matches filter</p>
            <p className="text-xs text-slate-400">
              Live competition items appear here once Phase 2C source polling & RSS connectors ingest
              verified entries.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {filtered.map((item) => (
              <article
                key={item.id}
                className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-800/20 transition-colors"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-display font-semibold text-sm text-slate-100">
                      {item.title}
                    </h3>
                    <DataOriginText origin={item.dataOrigin} />
                    <span
                      className={`text-xs font-mono ${
                        item.reviewStatus === 'verified'
                          ? 'text-emerald-400'
                          : item.reviewStatus === 'archived'
                          ? 'text-slate-500'
                          : 'text-orange-400'
                      }`}
                    >
                      {item.reviewStatus === 'verified'
                        ? 'Verified'
                        : item.reviewStatus === 'archived'
                        ? 'Archived'
                        : 'New Signal'}
                    </span>
                    {item.temporalStatus && (
                      <>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className={`text-xs font-mono ${getTemporalColor(item.temporalStatus)}`}>
                          {formatTemporalLabel(item.temporalStatus)}
                        </span>
                      </>
                    )}
                  </div>

                  <p className="text-xs text-slate-300">
                    {item.organizer} · {item.category} ·{' '}
                    {formatDiscoveryMethodLabel(item.discoveryMethod)}
                    {item.targetAudience ? ` · Audience: ${item.targetAudience.replace(/_/g, ' ')}` : ''}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span className="font-mono tabular-nums">
                      Hash: {item.fingerprintHash}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Deadline: {item.deadlineDate ?? 'Unspecified'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Prize: {item.prizePool ?? 'Unspecified'}
                    </span>
                    {item.crawlabilityStatus && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">
                          Crawl: {item.crawlabilityStatus.replace(/_/g, ' ')}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Detected: {formatTimestampCompact(item.discoveredAt)}
                    </span>
                  </div>

                  <p className="text-xs font-mono text-slate-500 truncate">
                    Source: {item.sourceName}
                    {item.sourceDomain ? ` · ${item.sourceDomain}` : ''} ({item.competitionUrl})
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={item.competitionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-700 hover:border-slate-600 text-xs text-slate-300 hover:text-white transition-colors"
                  >
                    <span>Source Link</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                  {item.reviewStatus !== 'verified' && (
                    <button
                      type="button"
                      onClick={() => onUpdateStatus(item.id, 'verified')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-semibold transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Verify</span>
                    </button>
                  )}
                  {item.reviewStatus !== 'archived' && (
                    <button
                      type="button"
                      onClick={() => onUpdateStatus(item.id, 'archived')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-700 hover:border-slate-600 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                    >
                      <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Archive</span>
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
