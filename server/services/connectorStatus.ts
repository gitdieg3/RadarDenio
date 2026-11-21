import type {
  ActiveEnvironment,
  ConnectorReadiness,
  RadarSystemHealth,
  TableHealthStatus,
} from '../../src/types/radar.ts';
import { tryResolveSupabaseEnvironment } from '../config/supabaseEnv.ts';
import { getSupabaseAdminClient } from './supabaseClient.ts';

export const REQUIRED_RADAR_TABLES = [
  'sources',
  'discovery_keywords',
  'discovery_candidates',
  'monitoring_jobs',
  'discovered_items',
  'system_logs',
  'engine_settings',
] as const;

function hasRealEnvValue(val: string | undefined, placeholder: string): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  return trimmed.length > 0 && trimmed !== placeholder;
}

async function probeSupabaseTables(): Promise<{
  connected: boolean;
  error: string | null;
  tableStatuses: TableHealthStatus[];
}> {
  const envProbe = tryResolveSupabaseEnvironment();
  if (!envProbe.ok) {
    return {
      connected: false,
      error: envProbe.error,
      tableStatuses: REQUIRED_RADAR_TABLES.map((table) => ({
        table,
        readable: false,
        rowCount: null,
        error: 'Supabase environment invalid or incomplete',
      })),
    };
  }

  try {
    const supabase = getSupabaseAdminClient();
    const statuses = await Promise.all(
      REQUIRED_RADAR_TABLES.map(async (table): Promise<TableHealthStatus> => {
        try {
          const { count, error, status } = await supabase
            .from(table)
            .select('*', { count: 'exact' })
            .limit(1);

          if (error) {
            return {
              table,
              readable: false,
              rowCount: null,
              error: error.code ? `${error.code}: ${error.message}` : error.message,
            };
          }

          if (status >= 400) {
            return {
              table,
              readable: false,
              rowCount: null,
              error: `HTTP ${status} while querying ${table}`,
            };
          }

          return {
            table,
            readable: true,
            rowCount: count ?? 0,
            error: null,
          };
        } catch (err) {
          return {
            table,
            readable: false,
            rowCount: null,
            error: err instanceof Error ? err.message : 'Unexpected query error',
          };
        }
      })
    );

    const failed = statuses.filter((s) => !s.readable);
    if (failed.length > 0) {
      const firstErr = failed[0];
      return {
        connected: false,
        error: `Supabase table check failed (${failed.length}/${statuses.length} unreadable). First error on "${firstErr.table}": ${firstErr.error}`,
        tableStatuses: statuses,
      };
    }

    return {
      connected: true,
      error: null,
      tableStatuses: statuses,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to connect to Supabase.';
    return {
      connected: false,
      error: message,
      tableStatuses: REQUIRED_RADAR_TABLES.map((table) => ({
        table,
        readable: false,
        rowCount: null,
        error: message,
      })),
    };
  }
}

const PHASE2B1_CANDIDATE_COLUMNS = [
  'classification',
  'confidence_score',
  'candidate_kind',
  'temporal_status',
  'registration_open_date',
  'registration_deadline',
  'competition_start_date',
  'competition_end_date',
  'event_year',
  'temporal_evidence',
  'temporal_confidence',
  'target_audience',
  'audience_compatible',
  'audience_note',
  'is_monitorable',
  'is_recurring_source',
  'monitoring_eligibility',
  'monitoring_block_reason',
  'crawlability_status',
  'crawlability_http_status',
  'crawlability_details',
  'source_domain',
  'recommended_monitoring_url',
  'duplicate_status',
  'duplicate_of_candidate_id',
  'duplicate_reason',
  'raw_batch_id',
].join(', ');

const PHASE2B1_RAW_BATCH_COLUMNS = [
  'id',
  'provider',
  'model_used',
  'status',
  'keywords_json',
  'raw_results_json',
  'total_raw_hits',
  'retry_count',
  'last_error',
  'created_at',
  'updated_at',
].join(', ');

async function probePhase2b1Migration(): Promise<boolean> {
  if (!tryResolveSupabaseEnvironment().ok) return false;
  try {
    const supabase = getSupabaseAdminClient();
    const [candColsRes, batchTableRes, enumRes] = await Promise.all([
      supabase.from('discovery_candidates').select(PHASE2B1_CANDIDATE_COLUMNS).limit(1),
      supabase.from('discovery_raw_batches').select(PHASE2B1_RAW_BATCH_COLUMNS).limit(1),
      supabase
        .from('discovery_candidates')
        .select('id')
        .eq('detected_type', 'static_document')
        .limit(1),
    ]);
    return !candColsRes.error && !batchTableRes.error && !enumRes.error;
  } catch {
    return false;
  }
}

const PHASE2C_FEED_COLUMNS = [
  'id',
  'source_id',
  'feed_name',
  'feed_url',
  'feed_format',
  'status',
  'verified',
  'etag',
  'last_modified',
  'last_attempted_at',
  'last_successful_at',
].join(', ');

const PHASE2C_FETCH_LOG_COLUMNS = [
  'id',
  'feed_id',
  'raw_batch_id',
  'status',
  'http_status',
  'items_found',
  'new_items',
  'duplicate_items',
  'changed_items',
  'candidates_saved',
  'fetched_at',
].join(', ');

const PHASE2C_FINGERPRINT_COLUMNS = [
  'id',
  'feed_id',
  'identity_type',
  'item_key',
  'normalized_url',
  'item_guid',
  'fallback_fingerprint',
  'content_hash',
  'candidate_id',
  'first_seen_at',
  'last_seen_at',
].join(', ');

async function probePhase2cMigration(): Promise<boolean> {
  if (!tryResolveSupabaseEnvironment().ok) return false;
  try {
    const supabase = getSupabaseAdminClient();
    const [feedsRes, logsRes, fpRes, candColRes] = await Promise.all([
      supabase.from('rss_feeds').select(PHASE2C_FEED_COLUMNS).limit(1),
      supabase.from('rss_fetch_logs').select(PHASE2C_FETCH_LOG_COLUMNS).limit(1),
      supabase.from('rss_item_fingerprints').select(PHASE2C_FINGERPRINT_COLUMNS).limit(1),
      supabase.from('discovery_candidates').select('rss_feed_id').limit(1),
    ]);
    return !feedsRes.error && !logsRes.error && !fpRes.error && !candColRes.error;
  } catch {
    return false;
  }
}

export async function getConnectorHealth(): Promise<RadarSystemHealth> {
  const geminiConfigured = hasRealEnvValue(process.env.GEMINI_API_KEY, 'MY_GEMINI_API_KEY');
  const envProbe = tryResolveSupabaseEnvironment();
  const supabaseConfigured = envProbe.ok;
  const activeEnvironment: ActiveEnvironment = envProbe.ok
    ? envProbe.config.environment
    : envProbe.environment ?? 'unconfigured';
  const supabaseTargetHost = envProbe.ok ? envProbe.config.targetHost : null;
  const requiredSupabaseEnvVars = envProbe.ok
    ? [...envProbe.config.requiredEnvVars]
    : [...envProbe.requiredEnvVars];
  const searchConnectorConfigured = hasRealEnvValue(process.env.SEARCH_ENGINE_API_KEY, '');

  const dbProbe = await probeSupabaseTables();
  const supabaseConnected = dbProbe.connected;
  const [phase2b1MigrationReady, phase2cMigrationReady] = supabaseConnected
    ? await Promise.all([probePhase2b1Migration(), probePhase2cMigration()])
    : [false, false];

  const envLabel = activeEnvironment.toUpperCase();

  const connectors: ConnectorReadiness[] = [
    {
      id: 'supabase_postgres',
      name: 'Supabase PostgreSQL',
      configured: supabaseConnected,
      mode: supabaseConnected ? 'ready' : 'disconnected',
      summary: supabaseConnected
        ? `Connected to Supabase PostgreSQL [${envLabel}${
            supabaseTargetHost ? ` · ${supabaseTargetHost}` : ''
          }] (${dbProbe.tableStatuses.length} tables verified read-only${
            phase2b1MigrationReady ? '; Phase 2B.1 schema active' : '; Phase 2B.1 SQL migration pending'
          }${phase2cMigrationReady ? '; Phase 2C RSS schema active' : ''}).`
        : dbProbe.error ?? 'Supabase connection failed.',
      requiredEnvVars: requiredSupabaseEnvVars,
    },
    {
      id: 'gemini_ai',
      name: 'Gemini Discovery Classifier (Server)',
      configured: geminiConfigured,
      mode: geminiConfigured ? 'ready' : 'disconnected',
      summary: geminiConfigured
        ? 'Server-side GEMINI_API_KEY active with gemini-4-hydrogen for Search Discovery classification.'
        : 'Missing GEMINI_API_KEY in server secrets for Search Discovery classification.',
      requiredEnvVars: ['GEMINI_API_KEY'],
    },
    {
      id: 'search_engine',
      name: 'Tavily Search Discovery Connector',
      configured: searchConnectorConfigured,
      mode: searchConnectorConfigured ? 'ready' : 'disconnected',
      summary: searchConnectorConfigured
        ? 'Tavily Search API key active on server. Live Search Engine Discovery is enabled.'
        : 'Missing SEARCH_ENGINE_API_KEY in server secrets for Tavily Search Discovery.',
      requiredEnvVars: ['SEARCH_ENGINE_API_KEY'],
    },
    {
      id: 'rss_http_fetcher',
      name: 'RSS/Atom Discovery Connector',
      configured: false,
      mode: 'phase_2_pending',
      summary: phase2cMigrationReady
        ? 'Phase 2C RSS/Atom database schema verified; fetcher, XML parser, and pipeline services pending Phase 2C.2–2C.5.'
        : 'Phase 2C RSS/Atom SQL migration and fetcher pipeline pending implementation.',
      requiredEnvVars: [],
    },
  ];

  return {
    activeEnvironment,
    supabaseTargetHost,
    storageMode: supabaseConnected ? 'supabase_postgres' : 'supabase_disconnected',
    isDemoFallbackActive: false,
    geminiConfigured,
    supabaseConfigured,
    supabaseConnected,
    supabaseError: dbProbe.error,
    tableStatuses: dbProbe.tableStatuses,
    searchConnectorConfigured,
    connectors,
    serverTime: new Date().toISOString(),
    phase2b1MigrationReady,
    phase2cMigrationReady,
  };
}
