import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  resolveSupabaseEnvironment,
  tryResolveSupabaseEnvironment,
  type DenioEnvironment,
} from '../config/supabaseEnv.ts';

let cachedClient: SupabaseClient | null = null;
let cachedEnvironment: DenioEnvironment | null = null;
let cachedConfigFingerprint = '';

export function resetSupabaseAdminClientCache(): void {
  cachedClient = null;
  cachedEnvironment = null;
  cachedConfigFingerprint = '';
}

export function isSupabaseEnvConfigured(): boolean {
  return tryResolveSupabaseEnvironment().ok;
}

export function getActiveSupabaseEnvironment(): DenioEnvironment | null {
  const probe = tryResolveSupabaseEnvironment();
  return probe.ok ? probe.config.environment : probe.environment;
}

export function getSupabaseAdminClient(): SupabaseClient {
  const resolved = resolveSupabaseEnvironment();

  if (
    !cachedClient ||
    cachedEnvironment !== resolved.environment ||
    cachedConfigFingerprint !== resolved.configFingerprint
  ) {
    cachedClient = createClient(resolved.url, resolved.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    cachedEnvironment = resolved.environment;
    cachedConfigFingerprint = resolved.configFingerprint;
  }

  return cachedClient;
}
