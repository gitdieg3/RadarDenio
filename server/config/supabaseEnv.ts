import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export type DenioEnvironment = 'staging' | 'production';

export interface ResolvedSupabaseConfig {
  environment: DenioEnvironment;
  url: string;
  serviceRoleKey: string;
  projectId: string;
  targetHost: string;
  requiredEnvVars: readonly string[];
  configFingerprint: string;
}

export type SupabaseEnvProbeResult =
  | {
      ok: true;
      config: ResolvedSupabaseConfig;
    }
  | {
      ok: false;
      environment: DenioEnvironment | null;
      error: string;
      requiredEnvVars: readonly string[];
    };

export class SupabaseEnvConfigError extends Error {
  public readonly code: string;
  public readonly environment: DenioEnvironment | null;

  constructor(message: string, code: string, environment: DenioEnvironment | null = null) {
    super(message);
    this.name = 'SupabaseEnvConfigError';
    this.code = code;
    this.environment = environment;
  }
}

const PLACEHOLDER_PATTERNS = [
  /^my_/i,
  /^your[-_]/i,
  /^placeholder/i,
  /^changeme/i,
  /^replace[-_]?me/i,
  /^example/i,
  /^<.*>$/,
];

function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

export function getRequiredEnvVarsForEnvironment(
  env: DenioEnvironment | null
): readonly string[] {
  if (env === 'staging') {
    return [
      'SUPABASE_STAGING_URL',
      'SUPABASE_STAGING_SERVICE_ROLE_KEY',
      'SUPABASE_STAGING_PROJECT_ID',
    ];
  }
  if (env === 'production') {
    return [
      'SUPABASE_PRODUCTION_URL',
      'SUPABASE_PRODUCTION_SERVICE_ROLE_KEY',
      'SUPABASE_PRODUCTION_PROJECT_ID',
    ];
  }
  return [
    'DENIO_ENV',
    'SUPABASE_STAGING_URL',
    'SUPABASE_STAGING_SERVICE_ROLE_KEY',
    'SUPABASE_STAGING_PROJECT_ID',
    'SUPABASE_PRODUCTION_URL',
    'SUPABASE_PRODUCTION_SERVICE_ROLE_KEY',
    'SUPABASE_PRODUCTION_PROJECT_ID',
  ];
}

export function parseDenioEnvironment(rawValue: string | undefined): DenioEnvironment | null {
  const normalized = rawValue?.trim().toLowerCase();
  if (normalized === 'staging' || normalized === 'production') {
    return normalized;
  }
  return null;
}

export function normalizeAndValidateSupabaseUrl(
  rawUrl: string,
  varName: string,
  environment: DenioEnvironment
): { normalizedUrl: string; hostname: string; extractedProjectId: string | null } {
  const trimmed = rawUrl.trim();
  if (!trimmed || isPlaceholderValue(trimmed)) {
    throw new SupabaseEnvConfigError(
      `${varName} is missing or still set to a placeholder for DENIO_ENV=${environment}.`,
      'ENV_MISSING_URL',
      environment
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SupabaseEnvConfigError(
      `${varName} is not a valid URL for DENIO_ENV=${environment}.`,
      'ENV_INVALID_URL',
      environment
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new SupabaseEnvConfigError(
      `${varName} must use https:// protocol for DENIO_ENV=${environment}.`,
      'ENV_INSECURE_URL',
      environment
    );
  }

  if (parsed.username || parsed.password) {
    throw new SupabaseEnvConfigError(
      `${varName} must not embed credentials in the URL.`,
      'ENV_URL_WITH_CREDENTIALS',
      environment
    );
  }

  if (parsed.search || parsed.hash) {
    throw new SupabaseEnvConfigError(
      `${varName} must be a clean base Supabase project URL without query params or fragments.`,
      'ENV_URL_NOT_CLEAN',
      environment
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || !hostname.includes('.')) {
    throw new SupabaseEnvConfigError(
      `${varName} must contain a valid Supabase hostname.`,
      'ENV_INVALID_HOSTNAME',
      environment
    );
  }

  const cleanPathname = parsed.pathname.replace(/\/+$/, '');
  const normalizedUrl = `${parsed.protocol}//${parsed.host.toLowerCase()}${cleanPathname}`;

  const cloudMatch = hostname.match(/^([a-z0-9-]+)\.supabase\.(co|in|net)$/);
  const extractedProjectId = cloudMatch ? cloudMatch[1] : null;

  return {
    normalizedUrl,
    hostname,
    extractedProjectId,
  };
}

function validateProjectId(
  rawProjectId: string | undefined,
  varName: string,
  urlVarName: string,
  extractedProjectId: string | null,
  environment: DenioEnvironment
): string {
  const trimmed = rawProjectId?.trim();
  if (!trimmed || isPlaceholderValue(trimmed)) {
    throw new SupabaseEnvConfigError(
      `${varName} is required for DENIO_ENV=${environment}.`,
      'ENV_MISSING_PROJECT_ID',
      environment
    );
  }

  if (!/^[a-z0-9-]{4,40}$/i.test(trimmed)) {
    throw new SupabaseEnvConfigError(
      `${varName} has invalid project ID format for DENIO_ENV=${environment}.`,
      'ENV_INVALID_PROJECT_ID',
      environment
    );
  }

  if (!extractedProjectId) {
    throw new SupabaseEnvConfigError(
      `Cannot verify ${varName} because ${urlVarName} does not contain a standard *.supabase.co|in|net project hostname.`,
      'ENV_UNVERIFIABLE_URL_PROJECT_ID',
      environment
    );
  }

  const normalizedId = trimmed.toLowerCase();
  if (extractedProjectId !== normalizedId) {
    throw new SupabaseEnvConfigError(
      `${varName} ("${normalizedId}") does not match the project reference in ${urlVarName} ("${extractedProjectId}").`,
      'ENV_PROJECT_ID_MISMATCH',
      environment
    );
  }

  return normalizedId;
}

function validateServiceRoleKey(
  rawKey: string | undefined,
  varName: string,
  environment: DenioEnvironment
): string {
  const trimmed = rawKey?.trim();
  if (!trimmed || isPlaceholderValue(trimmed)) {
    throw new SupabaseEnvConfigError(
      `${varName} is missing or placeholder for DENIO_ENV=${environment}. Legacy SUPABASE_SERVICE_ROLE_KEY fallback is disabled.`,
      'ENV_MISSING_SERVICE_ROLE_KEY',
      environment
    );
  }

  if (/\s/.test(trimmed) || trimmed.length < 16) {
    throw new SupabaseEnvConfigError(
      `${varName} format is invalid for DENIO_ENV=${environment}.`,
      'ENV_INVALID_SERVICE_ROLE_KEY',
      environment
    );
  }

  return trimmed;
}

/**
 * Loads ONLY the explicit dotenv file matching the declared DENIO_ENV
 * (.env.staging / .env.staging.local OR .env.production / .env.production.local).
 * Never falls back to generic `.env` or cross-environment files.
 */
export function loadActiveEnvFile(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): { loadedFiles: string[]; environment: DenioEnvironment | null } {
  const activeEnv = parseDenioEnvironment(env.DENIO_ENV);
  if (!activeEnv) {
    return { loadedFiles: [], environment: null };
  }

  const candidateFiles = [`.env.${activeEnv}.local`, `.env.${activeEnv}`];
  const loadedFiles: string[] = [];

  for (const relFile of candidateFiles) {
    const absPath = path.resolve(cwd, relFile);
    if (!fs.existsSync(absPath)) continue;
    const result = dotenv.config({
      path: absPath,
      processEnv: env,
      override: false,
      quiet: true,
    });
    if (!result.error) {
      loadedFiles.push(relFile);
    }
  }

  return { loadedFiles, environment: activeEnv };
}

/**
 * Strict, fail-closed Supabase environment resolver.
 * - Requires DENIO_ENV=staging or DENIO_ENV=production
 * - Uses only SUPABASE_STAGING_* or SUPABASE_PRODUCTION_* variables
 * - Never falls back to legacy SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * - Rejects identical Staging and Production URLs, project refs, or keys
 * - Never leaks secret values in error messages or outputs
 */
export function resolveSupabaseEnvironment(
  env: NodeJS.ProcessEnv = process.env
): ResolvedSupabaseConfig {
  const activeEnv = parseDenioEnvironment(env.DENIO_ENV);
  if (!activeEnv) {
    throw new SupabaseEnvConfigError(
      'Invalid or missing DENIO_ENV. Explicitly set DENIO_ENV="staging" or DENIO_ENV="production".',
      'ENV_INVALID_DENIO_ENV',
      null
    );
  }

  // Cross-environment isolation checks whenever both Staging and Production values exist in env
  const rawStagingUrl = env.SUPABASE_STAGING_URL?.trim();
  const rawProdUrl = env.SUPABASE_PRODUCTION_URL?.trim();

  if (rawStagingUrl && rawProdUrl) {
    const parsedStaging = normalizeAndValidateSupabaseUrl(
      rawStagingUrl,
      'SUPABASE_STAGING_URL',
      activeEnv
    );
    const parsedProd = normalizeAndValidateSupabaseUrl(
      rawProdUrl,
      'SUPABASE_PRODUCTION_URL',
      activeEnv
    );

    if (parsedStaging.normalizedUrl === parsedProd.normalizedUrl) {
      throw new SupabaseEnvConfigError(
        'Configuration conflict: SUPABASE_STAGING_URL and SUPABASE_PRODUCTION_URL must point to different Supabase projects.',
        'ENV_SHARED_URL_CONFLICT',
        activeEnv
      );
    }
  }

  const rawStagingProjectId = env.SUPABASE_STAGING_PROJECT_ID?.trim().toLowerCase();
  const rawProdProjectId = env.SUPABASE_PRODUCTION_PROJECT_ID?.trim().toLowerCase();
  if (rawStagingProjectId && rawProdProjectId && rawStagingProjectId === rawProdProjectId) {
    throw new SupabaseEnvConfigError(
      'Configuration conflict: SUPABASE_STAGING_PROJECT_ID and SUPABASE_PRODUCTION_PROJECT_ID must be distinct.',
      'ENV_SHARED_PROJECT_ID_CONFLICT',
      activeEnv
    );
  }

  const rawStagingKey = env.SUPABASE_STAGING_SERVICE_ROLE_KEY?.trim();
  const rawProdKey = env.SUPABASE_PRODUCTION_SERVICE_ROLE_KEY?.trim();
  if (rawStagingKey && rawProdKey && rawStagingKey === rawProdKey) {
    throw new SupabaseEnvConfigError(
      'Configuration conflict: SUPABASE_STAGING_SERVICE_ROLE_KEY and SUPABASE_PRODUCTION_SERVICE_ROLE_KEY must not be identical.',
      'ENV_SHARED_KEY_CONFLICT',
      activeEnv
    );
  }

  const urlVarName =
    activeEnv === 'staging' ? 'SUPABASE_STAGING_URL' : 'SUPABASE_PRODUCTION_URL';
  const keyVarName =
    activeEnv === 'staging'
      ? 'SUPABASE_STAGING_SERVICE_ROLE_KEY'
      : 'SUPABASE_PRODUCTION_SERVICE_ROLE_KEY';
  const projectIdVarName =
    activeEnv === 'staging'
      ? 'SUPABASE_STAGING_PROJECT_ID'
      : 'SUPABASE_PRODUCTION_PROJECT_ID';

  const rawActiveUrl = env[urlVarName];
  if (!rawActiveUrl || !rawActiveUrl.trim()) {
    throw new SupabaseEnvConfigError(
      `${urlVarName} is required for DENIO_ENV=${activeEnv}. Legacy SUPABASE_URL fallback is disabled.`,
      'ENV_MISSING_URL',
      activeEnv
    );
  }

  const parsedUrl = normalizeAndValidateSupabaseUrl(rawActiveUrl, urlVarName, activeEnv);
  const serviceRoleKey = validateServiceRoleKey(env[keyVarName], keyVarName, activeEnv);
  const projectId = validateProjectId(
    env[projectIdVarName],
    projectIdVarName,
    urlVarName,
    parsedUrl.extractedProjectId,
    activeEnv
  );

  // One-way fingerprint only for internal client-cache invalidation (never returned by API or logged)
  const configFingerprint = crypto
    .createHash('sha256')
    .update(`${activeEnv}\0${parsedUrl.normalizedUrl}\0${projectId}\0${serviceRoleKey}`)
    .digest('hex');

  return {
    environment: activeEnv,
    url: parsedUrl.normalizedUrl,
    serviceRoleKey,
    projectId,
    targetHost: parsedUrl.hostname,
    requiredEnvVars: getRequiredEnvVarsForEnvironment(activeEnv),
    configFingerprint,
  };
}

export function tryResolveSupabaseEnvironment(
  env: NodeJS.ProcessEnv = process.env
): SupabaseEnvProbeResult {
  const parsedEnv = parseDenioEnvironment(env.DENIO_ENV);
  try {
    const config = resolveSupabaseEnvironment(env);
    return { ok: true, config };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Supabase environment configuration is invalid.';
    return {
      ok: false,
      environment: parsedEnv,
      error: message,
      requiredEnvVars: getRequiredEnvVarsForEnvironment(parsedEnv),
    };
  }
}

export type ServerStartupResolution =
  | {
      mode: 'configured';
      config: ResolvedSupabaseConfig;
      loadedFiles: string[];
    }
  | {
      mode: 'unconfigured';
      loadedFiles: string[];
      reason: string;
    };

/**
 * Evaluates server startup configuration:
 * - In production runtime (NODE_ENV=production) or whenever DENIO_ENV is explicitly set,
 *   startup is strictly fail-closed via resolveSupabaseEnvironment().
 * - In local/container development (NODE_ENV !== 'production' and DENIO_ENV unset/blank),
 *   the HTTP/Vite dev server is allowed to start in 'unconfigured' mode while all database
 *   operations remain strictly fail-closed with zero legacy fallback.
 */
export function resolveServerStartupEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): ServerStartupResolution {
  const { loadedFiles } = loadActiveEnvFile(env, cwd);
  const rawDenioEnv = env.DENIO_ENV?.trim() ?? '';
  const isProductionRuntime = env.NODE_ENV?.trim().toLowerCase() === 'production';

  if (rawDenioEnv.length > 0 || isProductionRuntime) {
    const config = resolveSupabaseEnvironment(env);
    return {
      mode: 'configured',
      config,
      loadedFiles,
    };
  }

  return {
    mode: 'unconfigured',
    loadedFiles,
    reason:
      'DENIO_ENV is not set; starting dev server with Supabase disconnected (no legacy fallback).',
  };
}

