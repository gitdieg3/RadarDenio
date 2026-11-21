import { CheckCircle2, Copy, Database, Server, XCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { radarApi } from '../services/radarApi';
import type { DedupStrategy, EngineSettings, RadarSystemHealth } from '../types/radar';

interface SettingsViewProps {
  health: RadarSystemHealth;
  settings: EngineSettings | null;
  onSaveSettings: (patch: Partial<EngineSettings>) => Promise<void>;
}

export function SettingsView({ health, settings, onSaveSettings }: SettingsViewProps) {
  const [defaultInterval, setDefaultInterval] = useState(
    settings?.defaultPollingIntervalMinutes ?? 60
  );
  const [defaultDedup, setDefaultDedup] = useState<DedupStrategy>(
    settings?.defaultDedupStrategy ?? 'url_and_fingerprint'
  );
  const [maxJobs, setMaxJobs] = useState(settings?.maxConcurrentJobs ?? 4);
  const [autoPromote, setAutoPromote] = useState(settings?.autoPromoteVerifiedRss ?? false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [schemaSql, setSchemaSql] = useState<string>('');
  const [phase2b1Sql, setPhase2b1Sql] = useState<string>('');
  const [copiedSchema, setCopiedSchema] = useState(false);
  const [copied2b1Schema, setCopied2b1Schema] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setDefaultInterval(settings.defaultPollingIntervalMinutes);
    setDefaultDedup(settings.defaultDedupStrategy);
    setMaxJobs(settings.maxConcurrentJobs);
    setAutoPromote(settings.autoPromoteVerifiedRss);
  }, [settings]);

  useEffect(() => {
    radarApi
      .getSchema()
      .then((res) => {
        setSchemaSql(res.sql);
        setPhase2b1Sql(res.phase2b1Sql ?? '');
      })
      .catch(() => {
        setSchemaSql('-- Schema preview unavailable.');
        setPhase2b1Sql('-- Phase 2B.1 migration preview unavailable.');
      });
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaveFeedback(null);
    setSaveError(null);
    setSaving(true);
    try {
      await onSaveSettings({
        defaultPollingIntervalMinutes: Number(defaultInterval),
        defaultDedupStrategy: defaultDedup,
        maxConcurrentJobs: Number(maxJobs),
        autoPromoteVerifiedRss: autoPromote,
      });
      setSaveFeedback('Engine preferences saved to Supabase PostgreSQL.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopySql = async () => {
    if (!schemaSql) return;
    await navigator.clipboard.writeText(schemaSql);
    setCopiedSchema(true);
    setTimeout(() => setCopiedSchema(false), 2000);
  };

  const handleCopy2b1Sql = async () => {
    if (!phase2b1Sql) return;
    await navigator.clipboard.writeText(phase2b1Sql);
    setCopied2b1Schema(true);
    setTimeout(() => setCopied2b1Schema(false), 2000);
  };

  return (
    <div className="space-y-8">
      {/* Server Integration Readiness Matrix (Real DB Probe + Read-Only Env Status) */}
      <section className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-orange-400" aria-hidden="true" />
              <span>Server-Side Integration Readiness</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Live database probe and read-only connector status reported by the Node.js runtime.
              Secrets are never exposed to the browser.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono shrink-0">
            <span
              className={`px-2 py-0.5 rounded border uppercase ${
                health.activeEnvironment === 'production'
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                  : health.activeEnvironment === 'staging'
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-slate-700 bg-slate-800/70 text-slate-300'
              }`}
            >
              ENV: {health.activeEnvironment}
            </span>
            {health.supabaseTargetHost && (
              <span className="text-slate-400">{health.supabaseTargetHost}</span>
            )}
          </div>
        </div>

        <div className="divide-y divide-slate-800/70">
          {(health.connectors ?? []).map((connector) => {
            const isDb = connector.id === 'supabase_postgres';
            const badgeText = isDb
              ? connector.configured
                ? 'Connected'
                : 'Disconnected'
              : connector.mode === 'ready'
              ? 'Key Ready (Phase 2B.1)'
              : 'Phase 2C Pending';

            const badgeColor = isDb
              ? connector.configured
                ? 'text-emerald-400'
                : 'text-rose-400'
              : connector.configured
              ? 'text-amber-400'
              : 'text-slate-400';

            return (
              <div
                key={connector.id}
                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-sm font-semibold text-slate-100">{connector.name}</p>
                    <span className={`text-xs font-mono ${badgeColor}`}>{badgeText}</span>
                  </div>
                  <p className="text-xs text-slate-400">{connector.summary}</p>
                </div>
                {connector.requiredEnvVars.length > 0 && (
                  <div className="text-xs font-mono text-slate-400 md:max-w-[48%] md:text-right leading-relaxed break-words">
                    Env: {connector.requiredEnvVars.join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Live Supabase Table Verification Matrix */}
      <section className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display font-semibold text-sm text-slate-100">
              Supabase PostgreSQL Table Diagnostics
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Read-only <code className="font-mono">SELECT</code> verification across core
              application tables.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <span
              className={
                health.phase2b1MigrationReady ? 'text-emerald-400' : 'text-amber-400'
              }
            >
              {health.phase2b1MigrationReady
                ? 'Phase 2B.1 Migration Active'
                : 'Phase 2B.1 SQL Pending'}
            </span>
            <span
              className={health.supabaseConnected ? 'text-emerald-400' : 'text-rose-400'}
            >
              {health.supabaseConnected ? 'All Core Tables Readable' : 'Verification Failed'}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#080D1A]">
                <th className="py-2.5 px-4">Table</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Row Count</th>
                <th className="py-2.5 px-4">Diagnostic</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {(health.tableStatuses ?? []).map((tbl) => (
                <tr key={tbl.table}>
                  <td className="py-2.5 px-4 font-mono text-slate-200">{tbl.table}</td>
                  <td className="py-2.5 px-4">
                    {tbl.readable ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Readable</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-rose-400">
                        <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Error</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-300">
                    {tbl.rowCount !== null ? tbl.rowCount : '—'}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-[11px] text-slate-400">
                    {tbl.error ?? 'OK'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Engine Preferences */}
        <section className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/80">
            <h2 className="font-display font-semibold text-sm text-slate-100">
              Monitoring Engine Preferences
            </h2>
          </div>
          {!health.supabaseConnected || !settings ? (
            <div className="p-6 text-xs text-slate-400">
              Engine preferences are unavailable until Supabase PostgreSQL is connected and migrated.
            </div>
          ) : (
            <form onSubmit={handleSave} className="p-5 space-y-4">
              {saveError && (
                <div className="p-3 rounded bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                  {saveError}
                </div>
              )}
              {saveFeedback && (
                <div className="p-3 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{saveFeedback}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="setting-interval"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Default Polling Interval (minutes)
                </label>
                <input
                  id="setting-interval"
                  type="number"
                  min={5}
                  value={defaultInterval}
                  onChange={(e) => setDefaultInterval(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label
                  htmlFor="setting-dedup"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Default Deduplication Strategy
                </label>
                <select
                  id="setting-dedup"
                  value={defaultDedup}
                  onChange={(e) => setDefaultDedup(e.target.value as DedupStrategy)}
                  className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-orange-500"
                >
                  <option value="url_and_fingerprint">url_and_fingerprint</option>
                  <option value="feed_guid">feed_guid</option>
                  <option value="timestamp_delta">timestamp_delta</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="setting-concurrency"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Max Concurrent Monitoring Jobs
                </label>
                <input
                  id="setting-concurrency"
                  type="number"
                  min={1}
                  max={32}
                  value={maxJobs}
                  onChange={(e) => setMaxJobs(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <input
                  id="setting-autopromote"
                  type="checkbox"
                  checked={autoPromote}
                  onChange={(e) => setAutoPromote(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-[#060A14] text-orange-500 focus:ring-orange-500"
                />
                <label htmlFor="setting-autopromote" className="text-xs text-slate-300">
                  Auto-promote verified RSS feeds discovered during sweeps
                </label>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-end gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-slate-950 text-xs font-semibold transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Phase 2B.1 Migration SQL */}
        <section className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
                <Database className="w-4 h-4 text-orange-400" aria-hidden="true" />
                <span>Phase 2B.1 Migration SQL (Additive & Idempotent)</span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Run in Supabase SQL Editor to add native temporal, audience, crawlability, and raw
                batch columns.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopy2b1Sql}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-700 hover:border-slate-600 text-xs text-slate-200 hover:bg-slate-800 shrink-0"
            >
              <Copy className="w-3 h-3" aria-hidden="true" />
              <span>{copied2b1Schema ? 'Copied' : 'Copy 2B.1 SQL'}</span>
            </button>
          </div>
          <div className="p-4 flex-1 bg-[#060A14]">
            <pre className="text-[11px] font-mono text-slate-300 leading-relaxed max-h-80 overflow-auto whitespace-pre">
              {phase2b1Sql || 'Loading supabase/migrations/002_phase2b1_discovery_quality.sql...'}
            </pre>
          </div>
        </section>
      </div>

      {/* Phase 2A Base Schema Reference */}
      <section className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-3">
          <h2 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <span>Phase 2A Base Migration SQL (Idempotent)</span>
          </h2>
          <button
            type="button"
            onClick={handleCopySql}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-700 hover:border-slate-600 text-xs text-slate-200 hover:bg-slate-800"
          >
            <Copy className="w-3 h-3" aria-hidden="true" />
            <span>{copiedSchema ? 'Copied' : 'Copy SQL'}</span>
          </button>
        </div>
        <div className="p-4 flex-1 bg-[#060A14]">
          <pre className="text-[11px] font-mono text-slate-300 leading-relaxed max-h-72 overflow-auto whitespace-pre">
            {schemaSql || 'Loading supabase/migrations/001_phase2a_init.sql...'}
          </pre>
        </div>
      </section>
    </div>
  );
}
