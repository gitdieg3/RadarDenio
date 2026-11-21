import { Menu, Plus } from 'lucide-react';
import type { DashboardModule, RadarSystemHealth } from '../types/radar';

interface TopBarProps {
  activeModule: DashboardModule;
  health: RadarSystemHealth | null;
  onOpenMobileMenu: () => void;
  onPrimaryAction: () => void;
}

const MODULE_TITLES: Record<DashboardModule, string> = {
  overview: 'Overview',
  discovery: 'Source Discovery',
  registry: 'Source Registry',
  jobs: 'Monitoring Jobs',
  content: 'Discovered Content',
  logs: 'System Logs',
  settings: 'Settings',
};

export function TopBar({
  activeModule,
  health,
  onOpenMobileMenu,
  onPrimaryAction,
}: TopBarProps) {
  const activeEnv = health?.activeEnvironment ?? 'unconfigured';
  const envBadgeClass =
    activeEnv === 'production'
      ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
      : activeEnv === 'staging'
      ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
      : 'border-slate-700 bg-slate-800/70 text-slate-300';

  const modeSummary = health
    ? health.supabaseConnected
      ? 'Supabase PostgreSQL Connected'
      : 'Supabase Disconnected'
    : 'Checking Database...';

  return (
    <header className="h-14 px-4 sm:px-6 bg-[#080D1A]/95 border-b border-slate-800/80 flex items-center justify-between gap-4 sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 rounded text-slate-300 hover:text-white hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-500 hidden sm:inline whitespace-nowrap">DENIO</span>
          <span className="text-slate-700 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <h1 className="font-display font-semibold text-slate-100 truncate">
            {MODULE_TITLES[activeModule]}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        {health && (
          <span
            data-testid="active-environment-badge"
            className={`px-2 py-0.5 rounded border text-[11px] font-mono font-semibold uppercase tracking-wider whitespace-nowrap ${envBadgeClass}`}
          >
            {activeEnv}
          </span>
        )}
        <span className="hidden md:inline text-xs text-slate-400 whitespace-nowrap">
          {modeSummary}
        </span>
        <button
          type="button"
          onClick={onPrimaryAction}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{activeModule === 'jobs' ? 'Create Job' : 'Register Source'}</span>
        </button>
      </div>
    </header>
  );
}
