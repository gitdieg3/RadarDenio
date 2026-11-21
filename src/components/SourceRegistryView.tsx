import {
  Edit2,
  ExternalLink,
  Eye,
  Pause,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  CompetitionSource,
  MonitoringMethod,
  PriorityLevel,
  SourceStatus,
} from '../types/radar';
import {
  filterSources,
  formatDiscoveryMethodLabel,
  formatIntervalLabel,
  formatMonitoringMethodLabel,
  formatSourceTypeLabel,
  formatTimestampCompact,
} from '../utils/radarLogic';
import { DataOriginText, PriorityLabel, SourceStatusIndicator } from './StatusText';

interface SourceRegistryViewProps {
  sources: CompetitionSource[];
  onAddSource: () => void;
  onEditSource: (source: CompetitionSource) => void;
  onToggleSourceStatus: (source: CompetitionSource) => Promise<void>;
  onDeleteSource: (id: string) => Promise<void>;
}

export function SourceRegistryView({
  sources,
  onAddSource,
  onEditSource,
  onToggleSourceStatus,
  onDeleteSource,
}: SourceRegistryViewProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SourceStatus | 'all'>('all');
  const [methodFilter, setMethodFilter] = useState<MonitoringMethod | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityLevel | 'all'>('all');
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      filterSources(sources, {
        query,
        status: statusFilter,
        monitoringMethod: methodFilter,
        priority: priorityFilter,
      }),
    [sources, query, statusFilter, methodFilter, priorityFilter]
  );

  const inspectedSource = useMemo(
    () => sources.find((s) => s.id === inspectedId) ?? null,
    [sources, inspectedId]
  );

  return (
    <div className="space-y-6">
      {/* Toolbar & Filters */}
      <div className="p-4 rounded-lg bg-[#0B1120] border border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search
              className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search registered sources"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, URL, category, or error..."
              className="w-full pl-9 pr-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
            />
          </div>

          <select
            aria-label="Filter by source status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SourceStatus | 'all')}
            className="px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="pending_connector">Connector Required</option>
            <option value="error">Error</option>
          </select>

          <select
            aria-label="Filter by monitoring method"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value as MonitoringMethod | 'all')}
            className="px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Methods</option>
            <option value="rss_feed">RSS / Feed</option>
            <option value="polling">Polling</option>
            <option value="search_discovery">Search Discovery</option>
          </select>

          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as PriorityLevel | 'all')}
            className="px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Registry Table */}
      <div className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
        {sources.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-medium text-slate-200">No competition sources registered</p>
            <p className="text-xs text-slate-400">
              Your Supabase <code className="font-mono">sources</code> table is empty. Register your
              first source to persist it to PostgreSQL.
            </p>
            <button
              type="button"
              onClick={onAddSource}
              className="px-3.5 py-2 rounded-md bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-semibold"
            >
              Register First Source
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-medium text-slate-200">No sources match your filters</p>
            <p className="text-xs text-slate-400">
              Clear active filters or register a new competition source to begin tracking.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setStatusFilter('all');
                setMethodFilter('all');
                setPriorityFilter('all');
              }}
              className="px-3.5 py-2 rounded-md border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800/60"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#080D1A]">
                  <th className="py-3 px-3">Source &amp; URL</th>
                  <th className="py-3 px-3">Type &amp; Discovery</th>
                  <th className="py-3 px-3">Monitoring</th>
                  <th className="py-3 px-3">Category &amp; Priority</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Last Checked</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {filtered.map((source) => (
                  <tr key={source.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-3 max-w-[210px]">
                      <div className="space-y-0.5">
                        <button
                          type="button"
                          onClick={() => setInspectedId(source.id)}
                          className="font-semibold text-slate-100 hover:text-orange-400 text-left block w-full truncate transition-colors"
                        >
                          {source.name}
                        </button>
                        <p className="font-mono text-[11px] text-slate-400 truncate">
                          {source.url}
                        </p>
                      </div>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="space-y-0.5">
                        <p className="text-slate-200">{formatSourceTypeLabel(source.sourceType)}</p>
                        <p className="text-[11px] text-slate-400">
                          {formatDiscoveryMethodLabel(source.discoveryMethod)}
                        </p>
                      </div>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="space-y-0.5">
                        <p className="text-slate-200">
                          {formatMonitoringMethodLabel(source.monitoringMethod)}
                        </p>
                        <p className="font-mono text-[11px] text-slate-400 tabular-nums">
                          {formatIntervalLabel(source.pollingIntervalMinutes)}
                        </p>
                      </div>
                    </td>

                    <td className="py-3 px-3 max-w-[165px]">
                      <div className="space-y-0.5">
                        <p className="text-slate-200 truncate">{source.category}</p>
                        <div className="flex items-center gap-1.5">
                          <PriorityLabel priority={source.priority} />
                          <span className="text-slate-700" aria-hidden="true">
                            ·
                          </span>
                          <DataOriginText origin={source.dataOrigin} />
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3 max-w-[160px]">
                      <div className="space-y-0.5">
                        <SourceStatusIndicator status={source.status} />
                        {source.errorInfo && (
                          <p className="text-[11px] text-rose-400/90 truncate">
                            {source.errorInfo}
                          </p>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-slate-400 tabular-nums">
                      <div>{formatTimestampCompact(source.lastCheckedAt)}</div>
                      <div className="text-slate-500">
                        OK: {formatTimestampCompact(source.lastSuccessfulCheckAt)}
                      </div>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setInspectedId(source.id)}
                          aria-label={`Inspect source ${source.name}`}
                          className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditSource(source)}
                          aria-label={`Edit source ${source.name}`}
                          className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleSourceStatus(source)}
                          aria-label={
                            source.status === 'paused'
                              ? `Resume source ${source.name}`
                              : `Pause source ${source.name}`
                          }
                          className="p-1.5 rounded text-slate-400 hover:text-orange-400 hover:bg-slate-800"
                        >
                          {source.status === 'paused' ? (
                            <Play className="w-3.5 h-3.5" />
                          ) : (
                            <Pause className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {confirmDeleteId === source.id ? (
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteSource(source.id);
                              setConfirmDeleteId(null);
                              if (inspectedId === source.id) setInspectedId(null);
                            }}
                            className="px-2 py-1 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 font-medium"
                          >
                            Confirm
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(source.id)}
                            aria-label={`Delete source ${source.name}`}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detailed Source Inspector Drawer/Modal */}
      {inspectedSource && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspector-title"
        >
          <div className="w-full max-w-lg h-full bg-[#0B1120] border-l border-slate-800 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2
                  id="inspector-title"
                  className="font-display font-semibold text-base text-slate-100 truncate"
                >
                  {inspectedSource.name}
                </h2>
                <p className="text-xs text-slate-400">Source Registry Record</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedId(null)}
                aria-label="Close source inspector"
                className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              <dl className="divide-y divide-slate-800/70">
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Source Name</dt>
                  <dd className="text-slate-100 font-medium text-right">{inspectedSource.name}</dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400 shrink-0">Source URL</dt>
                  <dd className="text-orange-400 font-mono text-right break-all">
                    <a
                      href={inspectedSource.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <span>{inspectedSource.url}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                    </a>
                  </dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Source Type</dt>
                  <dd className="text-slate-100">
                    {formatSourceTypeLabel(inspectedSource.sourceType)}
                  </dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Discovery Method</dt>
                  <dd className="text-slate-100">
                    {formatDiscoveryMethodLabel(inspectedSource.discoveryMethod)}
                  </dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Monitoring Method</dt>
                  <dd className="text-slate-100">
                    {formatMonitoringMethodLabel(inspectedSource.monitoringMethod)} (
                    {formatIntervalLabel(inspectedSource.pollingIntervalMinutes)})
                  </dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Category</dt>
                  <dd className="text-slate-100">{inspectedSource.category}</dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Priority</dt>
                  <dd>
                    <PriorityLabel priority={inspectedSource.priority} />
                  </dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Status</dt>
                  <dd>
                    <SourceStatusIndicator status={inspectedSource.status} />
                  </dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Last Checked Timestamp</dt>
                  <dd className="font-mono text-slate-200 tabular-nums">
                    {formatTimestampCompact(inspectedSource.lastCheckedAt)}
                  </dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Last Successful Check</dt>
                  <dd className="font-mono text-slate-200 tabular-nums">
                    {formatTimestampCompact(inspectedSource.lastSuccessfulCheckAt)}
                  </dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Content Fingerprint</dt>
                  <dd className="font-mono text-slate-300">
                    {inspectedSource.contentFingerprint ?? 'Pending first fetch'}
                  </dd>
                </div>
                <div className="py-3 flex justify-between gap-4">
                  <dt className="text-slate-400">Data Origin</dt>
                  <dd>
                    <DataOriginText origin={inspectedSource.dataOrigin} />
                  </dd>
                </div>
              </dl>

              <div className="p-4 rounded-md bg-[#060A14] border border-slate-800 space-y-1">
                <p className="font-medium text-slate-300">Error Information</p>
                <p className={inspectedSource.errorInfo ? 'text-rose-300' : 'text-slate-500'}>
                  {inspectedSource.errorInfo ?? 'No active errors recorded on this source.'}
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  onEditSource(inspectedSource);
                  setInspectedId(null);
                }}
                className="px-4 py-2 rounded-md border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Edit Source
              </button>
              <button
                type="button"
                onClick={() => setInspectedId(null)}
                className="px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
