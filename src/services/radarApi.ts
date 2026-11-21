import type {
  CompetitionSource,
  CreateJobInput,
  CreateSourceInput,
  DiscoveredContentItem,
  DiscoveryCandidate,
  DiscoveryKeyword,
  DiscoveryRunRequest,
  DiscoveryRunResult,
  EngineSettings,
  MonitoringJob,
  RadarSnapshot,
  SystemLogEntry,
} from '../types/radar';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const rawText = await res.text();
  let data: Record<string, unknown> | null = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      if (res.ok) {
        throw new Error(`Unexpected non-JSON response from ${url} (HTTP ${res.status}).`);
      }
      throw new Error(`Request failed with status ${res.status}.`);
    }
  }

  if (!res.ok) {
    const errMsg =
      data && typeof data.error === 'string' && data.error
        ? data.error
        : `Request failed with status ${res.status}`;
    throw new Error(errMsg);
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`Unexpected empty response from ${url}.`);
  }

  return data as unknown as T;
}

export const radarApi = {
  getHealth: async () => {
    const data = await requestJson<import('../types/radar').RadarSystemHealth>('/api/health');
    if (!Array.isArray(data.connectors) || !Array.isArray(data.tableStatuses)) {
      throw new Error('Invalid health payload received from server.');
    }
    return data;
  },

  getSnapshot: async () => {
    const data = await requestJson<RadarSnapshot>('/api/snapshot');
    if (
      !Array.isArray(data.sources) ||
      !Array.isArray(data.jobs) ||
      !Array.isArray(data.keywords) ||
      !Array.isArray(data.candidates) ||
      !Array.isArray(data.content) ||
      !Array.isArray(data.logs) ||
      !data.health ||
      !data.settings
    ) {
      throw new Error('Invalid snapshot payload received from server.');
    }
    return data;
  },

  createSource: (input: CreateSourceInput) =>
    requestJson<CompetitionSource>('/api/sources', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateSource: (id: string, patch: Partial<CompetitionSource>) =>
    requestJson<CompetitionSource>(`/api/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteSource: (id: string) =>
    requestJson<void>(`/api/sources/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  createJob: (input: CreateJobInput) =>
    requestJson<MonitoringJob>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  toggleJob: (id: string) =>
    requestJson<MonitoringJob>(`/api/jobs/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
    }),

  triggerJobDryRun: (id: string) =>
    requestJson<{ job: MonitoringJob; note: string }>(
      `/api/jobs/${encodeURIComponent(id)}/trigger`,
      { method: 'POST' }
    ),

  createKeyword: (phrase: string, category: string, region: string) =>
    requestJson<DiscoveryKeyword>('/api/discovery/keywords', {
      method: 'POST',
      body: JSON.stringify({ phrase, category, region }),
    }),

  toggleKeyword: (id: string) =>
    requestJson<DiscoveryKeyword>(`/api/discovery/keywords/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
    }),

  getLastDiscoveryRun: () =>
    requestJson<{ lastRun: DiscoveryRunResult | null }>('/api/discovery/last-run'),

  getRawDiscoveryBatches: () =>
    requestJson<{ batches: import('../types/radar').DiscoveryRawBatch[] }>(
      '/api/discovery/batches'
    ),

  retryRawBatchClassification: (batchId: string) =>
    requestJson<DiscoveryRunResult>(
      `/api/discovery/batches/${encodeURIComponent(batchId)}/retry-classification`,
      { method: 'POST' }
    ),

  runLiveDiscovery: (req?: DiscoveryRunRequest) =>
    requestJson<DiscoveryRunResult>('/api/discovery/run', {
      method: 'POST',
      body: JSON.stringify(req ?? {}),
    }),

  promoteCandidate: (id: string) =>
    requestJson<{ candidate: DiscoveryCandidate; source: CompetitionSource }>(
      `/api/discovery/candidates/${encodeURIComponent(id)}/promote`,
      { method: 'POST' }
    ),

  dismissCandidate: (id: string) =>
    requestJson<DiscoveryCandidate>(
      `/api/discovery/candidates/${encodeURIComponent(id)}/dismiss`,
      { method: 'POST' }
    ),

  updateContentStatus: (id: string, reviewStatus: DiscoveredContentItem['reviewStatus']) =>
    requestJson<DiscoveredContentItem>(`/api/content/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewStatus }),
    }),

  updateSettings: (patch: Partial<EngineSettings>) =>
    requestJson<EngineSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  getSchema: () => requestJson<{ sql: string; phase2b1Sql?: string }>('/api/schema'),

  clearLogs: () =>
    requestJson<SystemLogEntry[]>('/api/logs', {
      method: 'DELETE',
    }),

  resetDemoState: () =>
    requestJson<RadarSnapshot>('/api/reset', {
      method: 'POST',
    }),
};
