import { X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type {
  CompetitionSource,
  CreateSourceInput,
  DiscoveryMethod,
  MonitoringMethod,
  PriorityLevel,
  SourceStatus,
  SourceType,
} from '../types/radar';
import { validateCreateSourceForm } from '../utils/radarLogic';

interface SourceFormModalProps {
  initialSource?: CompetitionSource | null;
  defaultIntervalMinutes: number;
  onClose: () => void;
  onSubmit: (payload: CreateSourceInput, existingId?: string) => Promise<void>;
}

export function SourceFormModal({
  initialSource,
  defaultIntervalMinutes,
  onClose,
  onSubmit,
}: SourceFormModalProps) {
  const [name, setName] = useState(initialSource?.name ?? '');
  const [url, setUrl] = useState(initialSource?.url ?? '');
  const [sourceType, setSourceType] = useState<SourceType>(initialSource?.sourceType ?? 'rss_feed');
  const [discoveryMethod, setDiscoveryMethod] = useState<DiscoveryMethod>(
    initialSource?.discoveryMethod ?? 'manual_registration'
  );
  const [monitoringMethod, setMonitoringMethod] = useState<MonitoringMethod>(
    initialSource?.monitoringMethod ?? 'rss_feed'
  );
  const [category, setCategory] = useState(initialSource?.category ?? 'AI & Data Science');
  const [priority, setPriority] = useState<PriorityLevel>(initialSource?.priority ?? 'medium');
  const [status, setStatus] = useState<SourceStatus>(initialSource?.status ?? 'active');
  const [pollingIntervalMinutes, setPollingIntervalMinutes] = useState<number>(
    initialSource?.pollingIntervalMinutes ?? defaultIntervalMinutes
  );

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const errors = validateCreateSourceForm({
      name,
      url,
      category,
      pollingIntervalMinutes: Number(pollingIntervalMinutes),
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await onSubmit(
        {
          name: name.trim(),
          url: url.trim(),
          sourceType,
          discoveryMethod,
          monitoringMethod,
          category: category.trim(),
          priority,
          status: initialSource ? status : undefined,
          pollingIntervalMinutes: Number(pollingIntervalMinutes),
        },
        initialSource?.id
      );
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to save source.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-modal-title"
    >
      <div className="w-full max-w-xl bg-[#0B1120] border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 id="source-modal-title" className="font-display font-semibold text-base text-slate-100">
            {initialSource ? 'Edit Competition Source' : 'Register Competition Source'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source form"
            className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
          {serverError && (
            <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {serverError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="source-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                Source Name
              </label>
              <input
                id="source-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Global Robotics Challenge Feed"
                className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
              />
              {fieldErrors.name && (
                <p className="mt-1 text-xs text-rose-400">{fieldErrors.name}</p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="source-url" className="block text-xs font-medium text-slate-300 mb-1.5">
                Source URL
              </label>
              <input
                id="source-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.org/competitions/feed.xml"
                className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
              />
              {fieldErrors.url && <p className="mt-1 text-xs text-rose-400">{fieldErrors.url}</p>}
            </div>

            <div>
              <label htmlFor="source-type" className="block text-xs font-medium text-slate-300 mb-1.5">
                Source Type
              </label>
              <select
                id="source-type"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as SourceType)}
                className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
              >
                <option value="rss_feed">RSS Feed</option>
                <option value="website">Website</option>
                <option value="public_portal">Public Portal</option>
                <option value="social_reference">Social Reference</option>
                <option value="newsletter_archive">Newsletter Archive</option>
                <option value="static_document">Static Document (PDF)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="source-monitoring"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Monitoring Method
              </label>
              <select
                id="source-monitoring"
                value={monitoringMethod}
                onChange={(e) => setMonitoringMethod(e.target.value as MonitoringMethod)}
                className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
              >
                <option value="rss_feed">RSS / Feed Monitoring</option>
                <option value="polling">Polling Monitoring</option>
                <option value="search_discovery">Search Engine Discovery</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="source-discovery"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Discovery Method
              </label>
              <select
                id="source-discovery"
                value={discoveryMethod}
                onChange={(e) => setDiscoveryMethod(e.target.value as DiscoveryMethod)}
                className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
              >
                <option value="manual_registration">Manual Registration</option>
                <option value="rss_autodiscovery">RSS Auto-Discovery</option>
                <option value="search_engine">Search Engine</option>
              </select>
            </div>

            <div>
              <label htmlFor="source-category" className="block text-xs font-medium text-slate-300 mb-1.5">
                Category
              </label>
              <input
                id="source-category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., AI & Data Science"
                className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
              />
              {fieldErrors.category && (
                <p className="mt-1 text-xs text-rose-400">{fieldErrors.category}</p>
              )}
            </div>

            <div>
              <label htmlFor="source-priority" className="block text-xs font-medium text-slate-300 mb-1.5">
                Priority
              </label>
              <select
                id="source-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="source-interval"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Polling Interval (minutes)
              </label>
              <input
                id="source-interval"
                type="number"
                min={5}
                value={pollingIntervalMinutes}
                onChange={(e) => setPollingIntervalMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-orange-500"
              />
              {fieldErrors.pollingIntervalMinutes && (
                <p className="mt-1 text-xs text-rose-400">{fieldErrors.pollingIntervalMinutes}</p>
              )}
            </div>

            {initialSource && (
              <div className="sm:col-span-2">
                <label htmlFor="source-status" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Status
                </label>
                <select
                  id="source-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as SourceStatus)}
                  className="w-full px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="error">Error</option>
                  <option value="pending_connector">Connector Required</option>
                </select>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800/70 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-slate-950 text-xs font-semibold transition-colors"
            >
              {submitting ? 'Saving...' : initialSource ? 'Save Changes' : 'Register Source'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
