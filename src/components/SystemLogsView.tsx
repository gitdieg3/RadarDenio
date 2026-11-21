import { RefreshCw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { LogLevel, SystemLogEntry } from '../types/radar';
import { formatTimestampCompact } from '../utils/radarLogic';
import { LogLevelLabel } from './StatusText';

interface SystemLogsViewProps {
  logs: SystemLogEntry[];
  onRefresh: () => Promise<void>;
  onClear: () => Promise<void>;
}

export function SystemLogsView({ logs, onRefresh, onClear }: SystemLogsViewProps) {
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  const modules = useMemo(
    () => Array.from(new Set(logs.map((l) => l.module))).sort(),
    [logs]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
      if (moduleFilter !== 'all' && entry.module !== moduleFilter) return false;
      if (!q) return true;
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.module.toLowerCase().includes(q) ||
        (entry.details ? entry.details.toLowerCase().includes(q) : false)
      );
    });
  }, [logs, levelFilter, moduleFilter, query]);

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-lg bg-[#0B1120] border border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search system logs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search audit messages or details..."
              className="w-full pl-9 pr-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
            />
          </div>

          <select
            aria-label="Filter logs by severity level"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'all')}
            className="px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Levels</option>
            <option value="info">INFO</option>
            <option value="warn">WARN</option>
            <option value="error">ERROR</option>
          </select>

          <select
            aria-label="Filter logs by module"
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="px-3 py-2 rounded-md bg-[#060A14] border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Modules</option>
            {modules.map((mod) => (
              <option key={mod} value={mod}>
                {mod}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-700 hover:border-slate-600 text-xs font-medium text-slate-200 hover:bg-slate-800/60"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-700 hover:border-rose-500/50 text-xs font-medium text-slate-300 hover:text-rose-300 hover:bg-rose-500/10"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clear Buffer</span>
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-[#0B1120] border border-slate-800/90 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-1">
            <p className="text-sm font-medium text-slate-200">No log entries match filter</p>
            <p className="text-xs text-slate-400">
              Actions across Source Registry, Discovery, and Monitoring Jobs append operational logs
              here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {filtered.map((entry) => (
              <div key={entry.id} className="p-4 space-y-1 text-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <LogLevelLabel level={entry.level} />
                    <span className="font-mono text-slate-400">{entry.module}</span>
                    <span className="text-slate-100 font-medium">{entry.message}</span>
                  </div>
                  <span className="font-mono text-slate-500 tabular-nums shrink-0">
                    {formatTimestampCompact(entry.timestamp)}
                  </span>
                </div>
                {entry.details && (
                  <p className="font-mono text-[11px] text-slate-400 sm:pl-16">{entry.details}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
