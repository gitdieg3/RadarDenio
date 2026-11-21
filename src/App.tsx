import { useCallback, useEffect, useState } from 'react';
import { DiscoveredContentView } from './components/DiscoveredContentView';
import { MonitoringJobsView } from './components/MonitoringJobsView';
import { OverviewView } from './components/OverviewView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { SourceDiscoveryView } from './components/SourceDiscoveryView';
import { SourceFormModal } from './components/SourceFormModal';
import { SourceRegistryView } from './components/SourceRegistryView';
import { SystemLogsView } from './components/SystemLogsView';
import { TopBar } from './components/TopBar';
import { radarApi } from './services/radarApi';
import type {
  CompetitionSource,
  CreateJobInput,
  CreateSourceInput,
  DashboardModule,
  DiscoveredContentItem,
  DiscoveryRunRequest,
  DiscoveryRunResult,
  EngineSettings,
  RadarSnapshot,
  RadarSystemHealth,
} from './types/radar';

export default function App() {
  const [activeModule, setActiveModule] = useState<DashboardModule>('overview');
  const [snapshot, setSnapshot] = useState<RadarSnapshot | null>(null);
  const [fallbackHealth, setFallbackHealth] = useState<RadarSystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<CompetitionSource | null>(null);
  const [lastDiscoveryRun, setLastDiscoveryRun] = useState<DiscoveryRunResult | null>(null);

  const refreshSnapshot = useCallback(async () => {
    try {
      setLoadError(null);
      const data = await radarApi.getSnapshot();
      setSnapshot(data);
      setFallbackHealth(data.health);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to Supabase backend.';
      setLoadError(msg);
      setSnapshot(null);
      try {
        const health = await radarApi.getHealth();
        setFallbackHealth(health);
      } catch {
        // Ignore secondary health check failure
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSnapshot();
    radarApi
      .getLastDiscoveryRun()
      .then((res) => {
        if (res.lastRun) {
          setLastDiscoveryRun(res.lastRun);
        }
      })
      .catch(() => {
        // Ignore optional initial last-run fetch failure
      });
  }, [refreshSnapshot]);

  const handleSaveSource = async (payload: CreateSourceInput, existingId?: string) => {
    if (existingId) {
      await radarApi.updateSource(existingId, payload);
    } else {
      await radarApi.createSource(payload);
    }
    await refreshSnapshot();
  };

  const handleToggleSourceStatus = async (source: CompetitionSource) => {
    const nextStatus = source.status === 'paused' ? 'active' : 'paused';
    await radarApi.updateSource(source.id, { status: nextStatus });
    await refreshSnapshot();
  };

  const handleDeleteSource = async (id: string) => {
    await radarApi.deleteSource(id);
    await refreshSnapshot();
  };

  const handleCreateJob = async (input: CreateJobInput) => {
    await radarApi.createJob(input);
    await refreshSnapshot();
  };

  const handleToggleJob = async (id: string) => {
    try {
      await radarApi.toggleJob(id);
      await refreshSnapshot();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to toggle job.');
    }
  };

  const handleTriggerDryRun = async (id: string) => {
    const res = await radarApi.triggerJobDryRun(id);
    await refreshSnapshot();
    return res.note;
  };

  const handleCreateKeyword = async (phrase: string, category: string, region: string) => {
    await radarApi.createKeyword(phrase, category, region);
    await refreshSnapshot();
  };

  const handleToggleKeyword = async (id: string) => {
    await radarApi.toggleKeyword(id);
    await refreshSnapshot();
  };

  const handlePromoteCandidate = async (id: string) => {
    await radarApi.promoteCandidate(id);
    await refreshSnapshot();
  };

  const handleDismissCandidate = async (id: string) => {
    await radarApi.dismissCandidate(id);
    await refreshSnapshot();
  };

  const handleRunLiveDiscovery = async (req?: DiscoveryRunRequest): Promise<DiscoveryRunResult> => {
    try {
      const result = await radarApi.runLiveDiscovery(req);
      setLastDiscoveryRun(result);
      await refreshSnapshot();
      return result;
    } catch (err) {
      await radarApi
        .getLastDiscoveryRun()
        .then((res) => {
          if (res.lastRun) setLastDiscoveryRun(res.lastRun);
        })
        .catch(() => {});
      await refreshSnapshot().catch(() => {});
      throw err;
    }
  };

  const handleRetryBatchClassification = async (
    batchId: string
  ): Promise<DiscoveryRunResult> => {
    const result = await radarApi.retryRawBatchClassification(batchId);
    setLastDiscoveryRun(result);
    await refreshSnapshot();
    return result;
  };

  const handleUpdateContentStatus = async (
    id: string,
    reviewStatus: DiscoveredContentItem['reviewStatus']
  ) => {
    await radarApi.updateContentStatus(id, reviewStatus);
    await refreshSnapshot();
  };

  const handleSaveSettings = async (patch: Partial<EngineSettings>) => {
    await radarApi.updateSettings(patch);
    await refreshSnapshot();
  };

  const handleClearLogs = async () => {
    await radarApi.clearLogs();
    await refreshSnapshot();
  };

  const openAddSourceModal = () => {
    setEditingSource(null);
    setSourceModalOpen(true);
  };

  const openEditSourceModal = (source: CompetitionSource) => {
    setEditingSource(source);
    setSourceModalOpen(true);
  };

  const activeHealth = snapshot?.health ?? fallbackHealth;

  return (
    <div className="min-h-screen bg-[#060A14] text-slate-100 flex">
      <Sidebar
        activeModule={activeModule}
        onSelectModule={setActiveModule}
        health={activeHealth}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        counts={{
          sources: snapshot?.sources?.length ?? 0,
          jobs: snapshot?.jobs?.length ?? 0,
          content: snapshot?.content?.length ?? 0,
          logs: snapshot?.logs?.length ?? 0,
        }}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeModule={activeModule}
          health={activeHealth}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onPrimaryAction={
            activeModule === 'jobs' ? () => setJobModalOpen(true) : openAddSourceModal
          }
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {loadError && (
            <div className="mb-6 p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-rose-300">
              <div className="space-y-1">
                <p className="font-semibold text-rose-200">
                  Supabase Database Unavailable (No Silent Fallback)
                </p>
                <p>{loadError}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activeModule !== 'settings' && (
                  <button
                    type="button"
                    onClick={() => setActiveModule('settings')}
                    className="px-3 py-1.5 rounded border border-rose-500/40 hover:bg-rose-500/20 text-rose-200 font-medium"
                  >
                    Open Diagnostics
                  </button>
                )}
                <button
                  type="button"
                  onClick={refreshSnapshot}
                  className="px-3 py-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {loading && !snapshot && !loadError ? (
            <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
              <div className="h-20 rounded-lg bg-[#0B1120] border border-slate-800/80 animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-28 rounded-lg bg-[#0B1120] border border-slate-800/80 animate-pulse"
                  />
                ))}
              </div>
              <div className="h-64 rounded-lg bg-[#0B1120] border border-slate-800/80 animate-pulse" />
            </div>
          ) : snapshot ? (
            <>
              {activeModule === 'overview' && (
                <OverviewView
                  snapshot={snapshot}
                  onNavigate={setActiveModule}
                  onOpenNewSource={openAddSourceModal}
                />
              )}
              {activeModule === 'discovery' && (
                <SourceDiscoveryView
                  health={snapshot.health}
                  keywords={snapshot.keywords}
                  candidates={snapshot.candidates}
                  rawBatches={snapshot.rawBatches ?? []}
                  lastDiscoveryRun={lastDiscoveryRun}
                  onRunLiveDiscovery={handleRunLiveDiscovery}
                  onRetryBatchClassification={handleRetryBatchClassification}
                  onCreateKeyword={handleCreateKeyword}
                  onToggleKeyword={handleToggleKeyword}
                  onPromoteCandidate={handlePromoteCandidate}
                  onDismissCandidate={handleDismissCandidate}
                />
              )}
              {activeModule === 'registry' && (
                <SourceRegistryView
                  sources={snapshot.sources}
                  onAddSource={openAddSourceModal}
                  onEditSource={openEditSourceModal}
                  onToggleSourceStatus={handleToggleSourceStatus}
                  onDeleteSource={handleDeleteSource}
                />
              )}
              {activeModule === 'jobs' && (
                <MonitoringJobsView
                  jobs={snapshot.jobs}
                  sources={snapshot.sources}
                  defaultIntervalMinutes={snapshot.settings.defaultPollingIntervalMinutes}
                  defaultDedupStrategy={snapshot.settings.defaultDedupStrategy}
                  createModalOpen={jobModalOpen}
                  onCloseCreateModal={() => setJobModalOpen(false)}
                  onCreateJob={handleCreateJob}
                  onToggleJob={handleToggleJob}
                  onTriggerDryRun={handleTriggerDryRun}
                />
              )}
              {activeModule === 'content' && (
                <DiscoveredContentView
                  items={snapshot.content}
                  onUpdateStatus={handleUpdateContentStatus}
                />
              )}
              {activeModule === 'logs' && (
                <SystemLogsView
                  logs={snapshot.logs}
                  onRefresh={refreshSnapshot}
                  onClear={handleClearLogs}
                />
              )}
              {activeModule === 'settings' && (
                <SettingsView
                  health={snapshot.health}
                  settings={snapshot.settings}
                  onSaveSettings={handleSaveSettings}
                />
              )}
            </>
          ) : activeHealth ? (
            <SettingsView
              health={activeHealth}
              settings={null}
              onSaveSettings={handleSaveSettings}
            />
          ) : null}
        </main>
      </div>

      {sourceModalOpen && (
        <SourceFormModal
          initialSource={editingSource}
          defaultIntervalMinutes={snapshot?.settings?.defaultPollingIntervalMinutes ?? 60}
          onClose={() => {
            setSourceModalOpen(false);
            setEditingSource(null);
          }}
          onSubmit={handleSaveSource}
        />
      )}
    </div>
  );
}
