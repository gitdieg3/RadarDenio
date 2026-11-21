import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  PauseCircle,
  PlugZap,
  XCircle,
} from 'lucide-react';
import type {
  DataOrigin,
  JobStatus,
  LogLevel,
  PriorityLevel,
  SourceStatus,
} from '../types/radar';
import { formatSourceStatusLabel } from '../utils/radarLogic';

export function SourceStatusIndicator({ status }: { status: SourceStatus }) {
  const label = formatSourceStatusLabel(status);
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap">
        <PauseCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === 'pending_connector') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
        <PlugZap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 whitespace-nowrap">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function JobStatusIndicator({ status }: { status: JobStatus }) {
  if (status === 'scheduled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Scheduled</span>
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Running</span>
      </span>
    );
  }
  if (status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap">
        <PauseCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Paused</span>
      </span>
    );
  }
  if (status === 'blocked_no_connector') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
        <PlugZap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Connector Required</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 whitespace-nowrap">
      <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>Failed</span>
    </span>
  );
}

export function PriorityLabel({ priority }: { priority: PriorityLevel }) {
  const styles: Record<PriorityLevel, string> = {
    critical: 'text-orange-400 font-semibold',
    high: 'text-slate-100 font-medium',
    medium: 'text-slate-300 font-normal',
    low: 'text-slate-400 font-normal',
  };
  const names: Record<PriorityLevel, string> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  };
  return <span className={`text-xs ${styles[priority]} whitespace-nowrap`}>{names[priority]}</span>;
}

export function DataOriginText({ origin }: { origin: DataOrigin }) {
  if (origin === 'seeded_demo') {
    return <span className="text-xs text-amber-400/90 font-mono">Demo Seed</span>;
  }
  if (origin === 'dry_run_simulation') {
    return <span className="text-xs text-sky-400 font-mono">Dry Run</span>;
  }
  if (origin === 'supabase_db') {
    return <span className="text-xs text-emerald-400/90 font-mono">Database</span>;
  }
  if (origin === 'tavily_discovery') {
    return <span className="text-xs text-emerald-400 font-mono">Tavily Live</span>;
  }
  return <span className="text-xs text-slate-300 font-mono">Registered</span>;
}

export function LogLevelLabel({ level }: { level: LogLevel }) {
  if (level === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-rose-400 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>ERROR</span>
      </span>
    );
  }
  if (level === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-amber-400 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>WARN</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-slate-400 whitespace-nowrap">
      <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>INFO</span>
    </span>
  );
}
