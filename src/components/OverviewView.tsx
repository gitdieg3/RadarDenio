import {
  Activity,
  ArrowRight,
  Database,
  Globe,
  RefreshCw,
  Rss,
  Search,
} from 'lucide-react';
import type {
  DashboardModule,
  DiscoveredContentItem,
  MonitoringJob,
  RadarSnapshot,
} from '../types/radar';
import {
  computeOverviewMetrics,
  formatIntervalLabel,
  formatMonitoringMethodLabel,
  formatTimestampCompact,
} from '../utils/radarLogic';
import {
  DataOriginText,
  JobStatusIndicator,
  LogLevelLabel,
} from './StatusText';

interface OverviewViewProps {
  snapshot: RadarSnapshot;
  onNavigate: (module: DashboardModule) => void;
  onOpenNewSource: () => void;
}

export function OverviewView({
  snapshot,
  onNavigate,
  onOpenNewSource,
}: OverviewViewProps) {
  const { health, sources, jobs, content, logs } = snapshot;
  const metrics = computeOverviewMetrics(sources, jobs, content, logs);

  const recentJobs: MonitoringJob[] = jobs.slice(0, 4);
  const recentContent: DiscoveredContentItem[] = content.slice(0, 4);
  const recentLogs = logs.slice(0, 5);
  const readyConnectors = health.connectors.filter((c) => c.configured).length;

  return (
    <div className="space-y-8">
      {/* Honest Database & Phase 2A Architecture Summary */}
      <section
        aria-label="System mode summary"
        className="p-4 sm:p-5 rounded-lg bg-[#0B1120] border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <div
            className={`flex items-center gap-2 text-xs font-medium ${
              health.supabaseConnected ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            <span>
              {health.supabaseConnected
                ? `Supabase PostgreSQL Connected · ${health.tableStatuses.length} Tables Verified`
                : `Supabase Connection Error · ${health.supabaseError ?? 'Unavailable'}`}
            </span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            DENIO RADAR persists operational data in Supabase PostgreSQL and runs live Tavily
            Search Engine Discovery with Gemini AI classification. Automated HTTP polling and RSS
            crawlers remain staged for the next phase.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-700 hover:border-slate-600 text-xs font-medium text-slate-200 hover:bg-slate-800/60 transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
        >
          <span>Inspect Connectors</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </section>

      {/* 4-Column KPI Strip */}
      <section aria-label="Key platform metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-5 rounded-lg bg-[#0B1120] border border-slate-800/90 space-y-2">
          <p className="text-xs font-medium text-slate-400">Registered Sources</p>
          <p className="text-3xl font-display font-bold text-slate-100 tabular-nums">
            {metrics.totalSources}
          </p>
          <p className="text-xs text-slate-400 tabular-nums">
            {metrics.activeSources} active · {metrics.errorSources} error
          </p>
        </div>

        <div className="p-5 rounded-lg bg-[#0B1120] border border-slate-800/90 space-y-2">
          <p className="text-xs font-medium text-slate-400">Monitoring Jobs</p>
          <p className="text-3xl font-display font-bold text-slate-100 tabular-nums">
            {jobs.length}
          </p>
          <p className="text-xs text-slate-400 tabular-nums">
            {metrics.scheduledJobs} scheduled · {metrics.blockedJobs} blocked/failed
          </p>
        </div>

        <div className="p-5 rounded-lg bg-[#0B1120] border border-slate-800/90 space-y-2">
          <p className="text-xs font-medium text-slate-400">Discovered Signals</p>
          <p className="text-3xl font-display font-bold text-slate-100 tabular-nums">
            {metrics.discoveredItems}
          </p>
          <p className="text-xs text-slate-400 tabular-nums">
            {metrics.newItemsCount} awaiting review
          </p>
        </div>

        <div className="p-5 rounded-lg bg-[#0B1120] border border-slate-800/90 space-y-2">
          <p className="text-xs font-medium text-slate-400">Connector Readiness</p>
          <p className="text-3xl font-display font-bold text-slate-100 tabular-nums">
            {readyConnectors}/{health.connectors.length}
          </p>
          <p className="text-xs text-slate-400">
            {health.supabaseConnected ? 'DB live' : 'DB disconnected'} ·{' '}
            {health.searchConnectorConfigured && health.geminiConfigured
              ? 'Tavily + Gemini live'
              : 'Search/AI unconfigured'}
          </p>
        </div>
      </section>

      {/* Core Monitoring Methods Architecture */}
      <section aria-label="Core monitoring methods" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display font-semibold text-base text-slate-100">
            Core Monitoring Pipelines
          </h2>
          <button
            type="button"
            onClick={onOpenNewSource}
            className="text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors whitespace-nowrap"
          >
            Register new source
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="p-5 rounded-lg bg-[#0B1120] border border-slate-800/90 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <Search className="w-4 h-4 text-orange-400" aria-hidden="true" />
                  <span>Search Engine Discovery</span>
                </span>
                <span
                  className={`text-xs font-mono ${
                    health.searchConnectorConfigured && health.geminiConfigured
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {health.searchConnectorConfigured && health.geminiConfigured
                    ? 'Tavily + Gemini Live'
                    : 'Key Missing'}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Discovers public competition pages, organizers, and announcement references from
                configurable keyword profiles stored in Supabase.
              </p>
            </div>
            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono tabular-nums">
                {snapshot.keywords.length} keywords ·{' '}
                {snapshot.candidates.filter((c) => c.status === 'candidate').length} queued
              </span>
              <button
                type="button"
                onClick={() => onNavigate('discovery')}
                className="text-slate-200 hover:text-orange-400 font-medium transition-colors"
              >
                Open Discovery
              </button>
            </div>
          </div>

          <div className="p-5 rounded-lg bg-[#0B1120] border border-slate-800/90 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <RefreshCw className="w-4 h-4 text-orange-400" aria-hidden="true" />
                  <span>Polling Monitoring</span>
                </span>
                <span className="text-xs font-mono text-slate-300">Scheduler Ready</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Periodically checks registered portals using URLs, timestamps, and deterministic
                content fingerprints to prevent duplicates.
              </p>
            </div>
            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono tabular-nums">
                {metrics.methodCounts.polling} sources tracked
              </span>
              <button
                type="button"
                onClick={() => onNavigate('jobs')}
                className="text-slate-200 hover:text-orange-400 font-medium transition-colors"
              >
                View Jobs
              </button>
            </div>
          </div>

          <div className="p-5 rounded-lg bg-[#0B1120] border border-slate-800/90 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <Rss className="w-4 h-4 text-orange-400" aria-hidden="true" />
                  <span>RSS / Feed Monitoring</span>
                </span>
                <span className="text-xs font-mono text-slate-300">Scheduler Ready</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Tracks registered RSS and Atom feeds, recording last-checked timestamps and GUID
                fingerprints for newly published competitions.
              </p>
            </div>
            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono tabular-nums">
                {metrics.methodCounts.rss_feed} feeds registered
              </span>
              <button
                type="button"
                onClick={() => onNavigate('registry')}
                className="text-slate-200 hover:text-orange-400 font-medium transition-colors"
              >
                Open Registry
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Recent Jobs & Recent Discovered Signals */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
            <h2 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-400" aria-hidden="true" />
              <span>Monitoring Schedule Snapshot</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('jobs')}
              className="text-xs text-slate-400 hover:text-orange-400 transition-colors"
            >
              Manage all
            </button>
          </div>
          {recentJobs.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              No monitoring jobs scheduled yet. Create a job from the Monitoring Jobs module.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {recentJobs.map((job) => (
                <div key={job.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-slate-100 truncate">{job.name}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {formatMonitoringMethodLabel(job.monitoringMethod)} ·{' '}
                      <span className="font-mono tabular-nums">
                        {formatIntervalLabel(job.intervalMinutes)}
                      </span>{' '}
                      · <DataOriginText origin={job.dataOrigin} />
                    </p>
                  </div>
                  <JobStatusIndicator status={job.status} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
            <h2 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
              <Globe className="w-4 h-4 text-slate-400" aria-hidden="true" />
              <span>Recent Discovered Content</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('content')}
              className="text-xs text-slate-400 hover:text-orange-400 transition-colors"
            >
              View feed
            </button>
          </div>
          {recentContent.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              No competition items stored in <code className="font-mono">discovered_items</code> yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {recentContent.map((item) => (
                <div key={item.id} className="px-5 py-3.5 space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">{item.title}</p>
                    <DataOriginText origin={item.dataOrigin} />
                  </div>
                  <p className="text-xs text-slate-400">
                    {item.organizer} · {item.category} ·{' '}
                    <span className="font-mono tabular-nums">{item.fingerprintHash}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent System Logs */}
      <section className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
          <h2 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <span>Recent Engine Audit Events</span>
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('logs')}
            className="text-xs text-slate-400 hover:text-orange-400 transition-colors"
          >
            Open System Logs
          </button>
        </div>
        {recentLogs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            No audit events recorded in <code className="font-mono">system_logs</code> yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {recentLogs.map((log) => (
              <div
                key={log.id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <LogLevelLabel level={log.level} />
                  <span className="font-mono text-slate-500 shrink-0">{log.module}</span>
                  <span className="text-slate-200 truncate">{log.message}</span>
                </div>
                <span className="font-mono text-slate-500 tabular-nums shrink-0">
                  {formatTimestampCompact(log.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
