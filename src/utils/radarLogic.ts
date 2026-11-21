import type {
  CompetitionSource,
  DiscoveredContentItem,
  DiscoveryMethod,
  MonitoringJob,
  MonitoringMethod,
  PriorityLevel,
  SourceStatus,
  SourceType,
  SystemLogEntry,
} from '../types/radar';

export interface SourceFilterCriteria {
  query: string;
  status: SourceStatus | 'all';
  monitoringMethod: MonitoringMethod | 'all';
  priority: PriorityLevel | 'all';
}

export interface OverviewMetrics {
  totalSources: number;
  activeSources: number;
  errorSources: number;
  pendingConnectorSources: number;
  scheduledJobs: number;
  blockedJobs: number;
  discoveredItems: number;
  newItemsCount: number;
  errorLogsCount: number;
  methodCounts: {
    search_discovery: number;
    polling: number;
    rss_feed: number;
  };
}

export function validateSourceUrl(rawUrl: string): { valid: boolean; normalized: string; error?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, normalized: '', error: 'Source URL is required.' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, normalized: '', error: 'Source URL must use http:// or https://.' };
    }
    return { valid: true, normalized: parsed.toString() };
  } catch {
    return { valid: false, normalized: '', error: 'Enter a valid absolute URL (e.g., https://example.org/feed.xml).' };
  }
}

export function validateCreateSourceForm(input: {
  name: string;
  url: string;
  category: string;
  pollingIntervalMinutes: number;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.name.trim() || input.name.trim().length < 2) {
    errors.name = 'Source name must be at least 2 characters.';
  }
  const urlCheck = validateSourceUrl(input.url);
  if (!urlCheck.valid && urlCheck.error) {
    errors.url = urlCheck.error;
  }
  if (!input.category.trim()) {
    errors.category = 'Category is required.';
  }
  if (!Number.isFinite(input.pollingIntervalMinutes) || input.pollingIntervalMinutes < 5) {
    errors.pollingIntervalMinutes = 'Polling interval must be at least 5 minutes.';
  }
  return errors;
}

export function filterSources(
  sources: CompetitionSource[],
  criteria: SourceFilterCriteria
): CompetitionSource[] {
  const q = criteria.query.trim().toLowerCase();
  return sources.filter((src) => {
    if (criteria.status !== 'all' && src.status !== criteria.status) {
      return false;
    }
    if (
      criteria.monitoringMethod !== 'all' &&
      src.monitoringMethod !== criteria.monitoringMethod
    ) {
      return false;
    }
    if (criteria.priority !== 'all' && src.priority !== criteria.priority) {
      return false;
    }
    if (!q) {
      return true;
    }
    return (
      src.name.toLowerCase().includes(q) ||
      src.url.toLowerCase().includes(q) ||
      src.category.toLowerCase().includes(q) ||
      (src.errorInfo ? src.errorInfo.toLowerCase().includes(q) : false)
    );
  });
}

export function computeOverviewMetrics(
  sources: CompetitionSource[],
  jobs: MonitoringJob[],
  content: DiscoveredContentItem[],
  logs: SystemLogEntry[]
): OverviewMetrics {
  return {
    totalSources: sources.length,
    activeSources: sources.filter((s) => s.status === 'active').length,
    errorSources: sources.filter((s) => s.status === 'error').length,
    pendingConnectorSources: sources.filter((s) => s.status === 'pending_connector').length,
    scheduledJobs: jobs.filter((j) => j.status === 'scheduled' || j.status === 'running').length,
    blockedJobs: jobs.filter((j) => j.status === 'blocked_no_connector' || j.status === 'failed').length,
    discoveredItems: content.length,
    newItemsCount: content.filter((c) => c.reviewStatus === 'new').length,
    errorLogsCount: logs.filter((l) => l.level === 'error').length,
    methodCounts: {
      search_discovery: sources.filter((s) => s.monitoringMethod === 'search_discovery').length,
      polling: sources.filter((s) => s.monitoringMethod === 'polling').length,
      rss_feed: sources.filter((s) => s.monitoringMethod === 'rss_feed').length,
    },
  };
}

export function formatIntervalLabel(minutes: number): string {
  if (minutes < 60) {
    return `Every ${minutes}m`;
  }
  const hours = minutes / 60;
  if (Number.isInteger(hours)) {
    return hours === 1 ? 'Every 1h' : `Every ${hours}h`;
  }
  return `Every ${minutes}m`;
}

export function formatTimestampCompact(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Invalid';
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function generateDeterministicFingerprint(url: string, title: string): string {
  const input = `${url.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function formatSourceTypeLabel(type: SourceType): string {
  const labels: Record<SourceType, string> = {
    website: 'Website',
    rss_feed: 'RSS Feed',
    public_portal: 'Public Portal',
    social_reference: 'Social Reference',
    newsletter_archive: 'Newsletter Archive',
    static_document: 'Static Document (PDF)',
  };
  return labels[type];
}

export function formatDiscoveryMethodLabel(method: DiscoveryMethod): string {
  const labels: Record<DiscoveryMethod, string> = {
    search_engine: 'Search Engine',
    rss_autodiscovery: 'RSS Auto-Discovery',
    manual_registration: 'Manual Registration',
  };
  return labels[method];
}

export function formatMonitoringMethodLabel(method: MonitoringMethod): string {
  const labels: Record<MonitoringMethod, string> = {
    polling: 'Polling Monitor',
    rss_feed: 'RSS / Feed Monitor',
    search_discovery: 'Search Discovery',
  };
  return labels[method];
}

export function formatSourceStatusLabel(status: SourceStatus): string {
  const labels: Record<SourceStatus, string> = {
    active: 'Active',
    paused: 'Paused',
    error: 'Error',
    pending_connector: 'Connector Required',
  };
  return labels[status];
}

const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'ref',
  'ref_src',
  'mc_cid',
  'mc_eid',
  'igshid',
]);

export function normalizeDiscoveryUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.hostname.startsWith('www.')) {
      parsed.hostname = parsed.hostname.slice(4);
    }
    parsed.hash = '';

    const keys = Array.from(parsed.searchParams.keys());
    for (const key of keys) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(lowerKey)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

const INDONESIAN_QUERY_HINTS =
  /\b(lomba|kompetisi|mahasiswa|pelajar|nasional|indonesia|inovasi|karya|desain|bisnis|beasiswa|olimpiade)\b/i;

export function buildDiscoveryQuery(phrase: string, category: string, region: string): string {
  const cleanPhrase = phrase.trim().replace(/\s+/g, ' ');
  const cleanCategory = category.trim().replace(/\s+/g, ' ');
  const cleanRegion = region.trim().replace(/\s+/g, ' ');

  if (!cleanPhrase) return '';

  const lowerPhrase = cleanPhrase.toLowerCase();
  const isIndonesian = INDONESIAN_QUERY_HINTS.test(cleanPhrase);
  const words = cleanPhrase.split(' ').filter(Boolean);

  // Only append category if the phrase is very short/generic, not Indonesian, and doesn't overlap category words
  let query = cleanPhrase;
  if (!isIndonesian && words.length <= 2 && cleanCategory) {
    const categoryTokens = cleanCategory
      .toLowerCase()
      .split(/[\s&/,-]+/)
      .filter((t) => t.length >= 3);
    const hasOverlap = categoryTokens.some((tok) => lowerPhrase.includes(tok));
    if (!hasOverlap && !lowerPhrase.includes(cleanCategory.toLowerCase())) {
      query = `${query} ${cleanCategory}`;
    }
  }

  // Insert region naturally (before trailing 4-digit year if present, e.g. "... mahasiswa Indonesia 2026")
  const hasSpecificRegion =
    cleanRegion &&
    cleanRegion.toLowerCase() !== 'global' &&
    cleanRegion.toLowerCase() !== 'worldwide' &&
    !lowerPhrase.includes(cleanRegion.toLowerCase());

  if (hasSpecificRegion) {
    const trailingYearMatch = query.match(/^(.*)\s+(20\d{2})$/);
    if (trailingYearMatch) {
      query = `${trailingYearMatch[1]} ${cleanRegion} ${trailingYearMatch[2]}`;
    } else {
      query = `${query} ${cleanRegion}`;
    }
  }

  return query.trim().slice(0, 320);
}

export function clampDiscoveryRunLimits(input?: {
  maxKeywords?: number;
  maxResultsPerKeyword?: number;
}): { maxKeywords: number; maxResultsPerKeyword: number } {
  const rawKeywords = Number(input?.maxKeywords ?? 3);
  const rawResults = Number(input?.maxResultsPerKeyword ?? 5);

  const maxKeywords = Number.isFinite(rawKeywords)
    ? Math.min(3, Math.max(1, Math.floor(rawKeywords)))
    : 3;
  const maxResultsPerKeyword = Number.isFinite(rawResults)
    ? Math.min(6, Math.max(1, Math.floor(rawResults)))
    : 5;

  return { maxKeywords, maxResultsPerKeyword };
}
