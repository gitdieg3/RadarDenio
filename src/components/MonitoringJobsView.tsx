import { Pause, Play, RefreshCw, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type {
  CompetitionSource,
  CreateJobInput,
  DedupStrategy,
  MonitoringJob,
  MonitoringMethod,
} from '../types/radar';
import {
  formatIntervalLabel,
  formatMonitoringMethodLabel,
  formatTimestampCompact,
} from '../utils/radarLogic';
import { DataOriginText, JobStatusIndicator } from './StatusText';

interface MonitoringJobsViewProps {
  jobs: MonitoringJob[];
  sources: CompetitionSource[];
  defaultIntervalMinutes: number;
  defaultDedupStrategy: DedupStrategy;
  createModalOpen: boolean;
  onCloseCreateModal: () => void;
  onCreateJob: (input: CreateJobInput) => Promise<void>;
  onToggleJob: (id: string) => Promise<void>;
  onTriggerDryRun: (id: string) => Promise<string>;
}

export function MonitoringJobsView({
  jobs,
  sources,
  defaultIntervalMinutes,
  defaultDedupStrategy,
  createModalOpen,
  onCloseCreateModal,
  onCreateJob,
  onToggleJob,
  onTriggerDryRun,
}: MonitoringJobsViewProps) {
  const [jobName, setJobName] = useState('');
  const [sourceId, setSourceId] = useState<string>(sources[0]?.id ?? '');
  const [monitoringMethod, setMonitoringMethod] = useState<MonitoringMethod>('rss_feed');
  const [intervalMinutes, setIntervalMinutes] = useState(defaultIntervalMinutes);
  const [dedupStrategy, setDedupStrategy] = useState<DedupStrategy>(defaultDedupStrategy);
  const [formError, setFormError] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!jobName.trim()) {
      setFormError('Job name is required.');
      return;
    }
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) {
      setFormError('Polling interval must be at least 5 minutes.');
      return;
    }
    setSubmitting(true);
    try {
      await onCreateJob({
        name: jobName.trim(),
        sourceId: sourceId || null,
        monitoringMethod,
        intervalMinutes: Number(intervalMinutes),
        dedupStrategy,
      });
      setJobName('');
      onCloseCreateModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create job.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDryRun = async (job: MonitoringJob) => {
    setFeedbackBanner(null);
    try {
      const note = await onTriggerDryRun(job.id);
      setFeedbackBanner(`${job.name}: ${note}`);
    } catch (err) {
      setFeedbackBanner(err instanceof Error ? err.message : 'Dry-run failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-lg bg-[#0B1120] border border-slate-800/90 space-y-1">
        <h2 className="font-display font-semibold text-sm text-slate-100">
          Monitoring Scheduler &amp; Deduplication Queue
        </h2>
        <p className="text-xs text-slate-400">
          Configure periodic Polling, RSS/Feed, and Search Discovery jobs. Dry-run checks validate
          schedule timing and write audit entries to System Logs without faking external crawls.
        </p>
      </div>

      {feedbackBanner && (
        <div
          role="status"
          className="p-3.5 rounded-md bg-[#0B1120] border border-orange-500/40 text-xs text-slate-200 flex items-center justify-between gap-3"
        >
          <span>{feedbackBanner}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-slate-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
        {jobs.length === 0 ? (
          <div className="p-10 text-center space-y-1.5">
            <p className="text-sm font-medium text-slate-200">No monitoring jobs scheduled</p>
            <p className="text-xs text-slate-400">
              Use the Create Job button in the top bar to persist a new schedule in Supabase.
            </p>
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#080D1A]">
                <th className="py-3 px-3">Job &amp; Linked Source</th>
                <th className="py-3 px-3">Method &amp; Interval</th>
                <th className="py-3 px-3">Dedup</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Schedule Window</th>
                <th className="py-3 px-3 text-right">Hits / Skip</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-3 max-w-[205px]">
                    <p className="font-semibold text-slate-100 truncate">{job.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {job.sourceName} · <DataOriginText origin={job.dataOrigin} />
                    </p>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <p className="text-slate-200">
                      {formatMonitoringMethodLabel(job.monitoringMethod)}
                    </p>
                    <p className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {formatIntervalLabel(job.intervalMinutes)}
                    </p>
                  </td>
                  <td className="py-3 px-3 max-w-[140px] truncate font-mono text-[11px] text-slate-300">
                    {job.dedupStrategy}
                  </td>
                  <td className="py-3 px-3 max-w-[155px]">
                    <JobStatusIndicator status={job.status} />
                    {job.lastError && (
                      <p className="text-[11px] text-rose-400/90 truncate mt-0.5">
                        {job.lastError}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-slate-400 tabular-nums">
                    <div>Last: {formatTimestampCompact(job.lastRunAt)}</div>
                    <div className="text-slate-500">
                      Next: {formatTimestampCompact(job.nextRunAt)}
                    </div>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-200">
                    {job.itemsDetected} / <span className="text-slate-500">{job.duplicatesSkipped}</span>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDryRun(job)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-700 hover:border-slate-600 text-[11px] font-medium text-slate-200 hover:bg-slate-800"
                      >
                        <RefreshCw className="w-3 h-3" aria-hidden="true" />
                        <span>Dry Run</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleJob(job.id)}
                        aria-label={
                          job.status === 'paused' ? `Resume job ${job.name}` : `Pause job ${job.name}`
                        }
                        className="p-1.5 rounded border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-orange-400 hover:bg-slate-800"
                      >
                        {job.status === 'paused' ? (
                          <Play className="w-3.5 h-3.5" />
                        ) : (
                          <Pause className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {createModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
          role="dialog"
          aria-modal="true"
          aria-labelledby="job-modal-title"
        >
          <div className="w-full max-w-lg bg-[#0B1120] border border-slate-800 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h2 id="job-modal-title" className="font-display font-semibold text-base text-slate-100">
                Create Monitoring Job
              </h2>
              <button
                type="button"
                onClick={onCloseCreateModal}
                aria-label="Close job modal"
                className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4" noValidate>
              {formError && (
                <div className="p-3 rounded bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                  {formError}
                </div>
              )}

              <div>
                <label htmlFor="job-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Job Name
                </label>
                <input
                  id="job-name"
                  type="text"
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  placeholder="e.g., Hourly AI Challenges RSS Poll"
                  className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label htmlFor="job-source" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Linked Registry Source
                </label>
                <select
                  id="job-source"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
                >
                  <option value="">Global Discovery Pool (No single source)</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="job-method"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Monitoring Method
                  </label>
                  <select
                    id="job-method"
                    value={monitoringMethod}
                    onChange={(e) => setMonitoringMethod(e.target.value as MonitoringMethod)}
                    className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
                  >
                    <option value="rss_feed">RSS / Feed Monitor</option>
                    <option value="polling">Polling Monitor</option>
                    <option value="search_discovery">Search Engine Discovery</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="job-interval"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Interval (minutes)
                  </label>
                  <input
                    id="job-interval"
                    type="number"
                    min={5}
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="job-dedup" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Deduplication Strategy
                </label>
                <select
                  id="job-dedup"
                  value={dedupStrategy}
                  onChange={(e) => setDedupStrategy(e.target.value as DedupStrategy)}
                  className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-orange-500"
                >
                  <option value="url_and_fingerprint">url_and_fingerprint</option>
                  <option value="feed_guid">feed_guid</option>
                  <option value="timestamp_delta">timestamp_delta</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onCloseCreateModal}
                  className="px-4 py-2 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-slate-950 text-xs font-semibold"
                >
                  {submitting ? 'Scheduling...' : 'Create Job'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
