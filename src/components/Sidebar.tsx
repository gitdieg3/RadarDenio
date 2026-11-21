import {
  Activity,
  Compass,
  Database,
  FileText,
  LayoutDashboard,
  Radar,
  Search,
  Settings,
  X,
} from 'lucide-react';
import type { DashboardModule, RadarSystemHealth } from '../types/radar';

interface SidebarProps {
  activeModule: DashboardModule;
  onSelectModule: (mod: DashboardModule) => void;
  health: RadarSystemHealth | null;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  counts: {
    sources: number;
    jobs: number;
    content: number;
    logs: number;
  };
}

const NAV_ITEMS: {
  id: DashboardModule;
  label: string;
  icon: typeof LayoutDashboard;
}[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'discovery', label: 'Source Discovery', icon: Search },
  { id: 'registry', label: 'Source Registry', icon: Database },
  { id: 'jobs', label: 'Monitoring Jobs', icon: Activity },
  { id: 'content', label: 'Discovered Content', icon: Compass },
  { id: 'logs', label: 'System Logs', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  activeModule,
  onSelectModule,
  health,
  mobileOpen,
  onCloseMobile,
  counts,
}: SidebarProps) {
  const getCountForModule = (id: DashboardModule): number | null => {
    if (id === 'registry') return counts.sources;
    if (id === 'jobs') return counts.jobs;
    if (id === 'content') return counts.content;
    if (id === 'logs') return counts.logs;
    return null;
  };

  const navContent = (
    <div className="flex flex-col h-full bg-[#080D1A] border-r border-slate-800/80">
      <div className="h-14 px-5 flex items-center justify-between border-b border-slate-800/80 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-orange-500 flex items-center justify-center shrink-0">
            <Radar className="w-4 h-4 text-slate-950" aria-hidden="true" />
          </div>
          <span className="font-display font-bold text-sm tracking-wide text-slate-100 whitespace-nowrap">
            DENIO RADAR
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav aria-label="Primary modules" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeModule === item.id;
          const badgeCount = getCountForModule(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectModule(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                isActive
                  ? 'bg-orange-500/12 text-orange-400'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-orange-400' : 'text-slate-500'
                  }`}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </span>
              {badgeCount !== null && (
                <span
                  className={`text-xs font-mono tabular-nums ${
                    isActive ? 'text-orange-300' : 'text-slate-500'
                  }`}
                >
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800/80 space-y-2 text-xs">
        <div className="flex items-center justify-between text-slate-400">
          <span>Environment</span>
          <span
            className={`font-mono uppercase ${
              health?.activeEnvironment === 'production'
                ? 'text-rose-400'
                : health?.activeEnvironment === 'staging'
                ? 'text-amber-400'
                : 'text-slate-400'
            }`}
          >
            {health?.activeEnvironment ?? 'checking'}
          </span>
        </div>
        <div className="flex items-center justify-between text-slate-400">
          <span>Storage</span>
          <span
            className={`font-mono ${
              health?.supabaseConnected ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {health?.supabaseConnected ? 'Supabase PG' : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-center justify-between text-slate-400">
          <span>Discovery Engine</span>
          <span className="font-mono text-emerald-400">Phase 2B Live</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500 pt-1">
          Supabase + Tavily Search + Gemini active. Polling &amp; RSS crawlers remain staged.
        </p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">
        {navContent}
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70"
            aria-hidden="true"
            onClick={onCloseMobile}
          />
          <div className="relative w-64 max-w-[80vw] h-full z-10">{navContent}</div>
        </div>
      )}
    </>
  );
}
