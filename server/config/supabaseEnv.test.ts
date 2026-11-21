import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadActiveEnvFile,
  resolveServerStartupEnvironment,
  resolveSupabaseEnvironment,
  SupabaseEnvConfigError,
  tryResolveSupabaseEnvironment,
} from './supabaseEnv.ts';
import { getConnectorHealth } from '../services/connectorStatus.ts';
import {
  getSupabaseAdminClient,
  isSupabaseEnvConfigured,
  resetSupabaseAdminClientCache,
} from '../services/supabaseClient.ts';

const DUMMY_STAGING_PROJECT_ID = 'stagingdummyref12345';
const DUMMY_STAGING_URL = `https://${DUMMY_STAGING_PROJECT_ID}.supabase.co`;
const DUMMY_STAGING_KEY = 'sb_secret_dummy_staging_alpha_99887766';
const DUMMY_PROD_PROJECT_ID = 'proddummyref67890';
const DUMMY_PROD_URL = `https://${DUMMY_PROD_PROJECT_ID}.supabase.co`;
const DUMMY_PROD_KEY = 'sb_secret_dummy_production_beta_11223344';
const DUMMY_LEGACY_URL = 'https://legacydummyref00000.supabase.co';
const DUMMY_LEGACY_KEY = 'dummy_legacy_service_role_secret_gamma_445566';

function withProcessEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void> | void
): Promise<void> | void {
  const keys = [
    'DENIO_ENV',
    'NODE_ENV',
    'SUPABASE_STAGING_URL',
    'SUPABASE_STAGING_SERVICE_ROLE_KEY',
    'SUPABASE_STAGING_PROJECT_ID',
    'SUPABASE_PRODUCTION_URL',
    'SUPABASE_PRODUCTION_SERVICE_ROLE_KEY',
    'SUPABASE_PRODUCTION_PROJECT_ID',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const snapshot = new Map<string, string | undefined>();
  for (const k of keys) {
    snapshot.set(k, process.env[k]);
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const restore = () => {
    resetSupabaseAdminClientCache();
    for (const k of keys) {
      const prev = snapshot.get(k);
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    }
  };

  try {
    const out = fn();
    if (out && typeof (out as Promise<void>).then === 'function') {
      return (out as Promise<void>).finally(restore);
    }
    restore();
    return;
  } catch (err) {
    restore();
    throw err;
  }
}

test('1. DENIO_ENV=staging selects ONLY Staging credentials (including sb_secret_ key & matching PROJECT_ID)', () => {
  const resolved = resolveSupabaseEnvironment({
    DENIO_ENV: 'staging',
    SUPABASE_STAGING_URL: `${DUMMY_STAGING_URL}/`,
    SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
    SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
    SUPABASE_PRODUCTION_URL: DUMMY_PROD_URL,
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_PROD_KEY,
    SUPABASE_PRODUCTION_PROJECT_ID: DUMMY_PROD_PROJECT_ID,
    SUPABASE_URL: DUMMY_LEGACY_URL,
    SUPABASE_SERVICE_ROLE_KEY: DUMMY_LEGACY_KEY,
  });

  assert.equal(resolved.environment, 'staging');
  assert.equal(resolved.url, DUMMY_STAGING_URL);
  assert.equal(resolved.serviceRoleKey, DUMMY_STAGING_KEY);
  assert.equal(resolved.projectId, DUMMY_STAGING_PROJECT_ID);
  assert.equal(resolved.targetHost, `${DUMMY_STAGING_PROJECT_ID}.supabase.co`);
  assert.deepEqual(resolved.requiredEnvVars, [
    'SUPABASE_STAGING_URL',
    'SUPABASE_STAGING_SERVICE_ROLE_KEY',
    'SUPABASE_STAGING_PROJECT_ID',
  ]);
});

test('2. DENIO_ENV=production selects ONLY Production credentials even when Staging and legacy vars exist', () => {
  const resolved = resolveSupabaseEnvironment({
    DENIO_ENV: 'production',
    SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
    SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
    SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
    SUPABASE_PRODUCTION_URL: `HTTPS://${DUMMY_PROD_PROJECT_ID.toUpperCase()}.SUPABASE.CO/`,
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_PROD_KEY,
    SUPABASE_PRODUCTION_PROJECT_ID: DUMMY_PROD_PROJECT_ID,
    SUPABASE_URL: DUMMY_LEGACY_URL,
    SUPABASE_SERVICE_ROLE_KEY: DUMMY_LEGACY_KEY,
  });

  assert.equal(resolved.environment, 'production');
  assert.equal(resolved.url, DUMMY_PROD_URL);
  assert.equal(resolved.serviceRoleKey, DUMMY_PROD_KEY);
  assert.equal(resolved.projectId, DUMMY_PROD_PROJECT_ID);
  assert.equal(resolved.targetHost, `${DUMMY_PROD_PROJECT_ID}.supabase.co`);
  assert.deepEqual(resolved.requiredEnvVars, [
    'SUPABASE_PRODUCTION_URL',
    'SUPABASE_PRODUCTION_SERVICE_ROLE_KEY',
    'SUPABASE_PRODUCTION_PROJECT_ID',
  ]);
});

test('3. Invalid or missing DENIO_ENV fails closed with SupabaseEnvConfigError', () => {
  for (const badEnv of [undefined, '', '   ', 'development', 'local', 'prod', 'qa']) {
    assert.throws(
      () =>
        resolveSupabaseEnvironment({
          DENIO_ENV: badEnv,
          SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
          SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
          SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
          SUPABASE_PRODUCTION_URL: DUMMY_PROD_URL,
          SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_PROD_KEY,
          SUPABASE_PRODUCTION_PROJECT_ID: DUMMY_PROD_PROJECT_ID,
        }),
      (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_INVALID_DENIO_ENV'
    );
  }
});

test('4. Incomplete credentials, missing/invalid/mismatched PROJECT_ID, or invalid URLs fail closed', () => {
  // Missing active staging key
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
        SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
      }),
    (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_MISSING_SERVICE_ROLE_KEY'
  );

  // Missing active production URL
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'production',
        SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_PROD_KEY,
        SUPABASE_PRODUCTION_PROJECT_ID: DUMMY_PROD_PROJECT_ID,
      }),
    (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_MISSING_URL'
  );

  // Missing mandatory SUPABASE_STAGING_PROJECT_ID
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
        SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
      }),
    (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_MISSING_PROJECT_ID'
  );

  // Empty whitespace SUPABASE_PRODUCTION_PROJECT_ID
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'production',
        SUPABASE_PRODUCTION_URL: DUMMY_PROD_URL,
        SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_PROD_KEY,
        SUPABASE_PRODUCTION_PROJECT_ID: '   ',
      }),
    (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_MISSING_PROJECT_ID'
  );

  // Invalid format SUPABASE_STAGING_PROJECT_ID
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
        SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
        SUPABASE_STAGING_PROJECT_ID: 'bad id!',
      }),
    (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_INVALID_PROJECT_ID'
  );

  // Placeholder values rejected
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: 'https://your-project.supabase.co',
        SUPABASE_STAGING_SERVICE_ROLE_KEY: 'placeholder_secret_value_1234',
        SUPABASE_STAGING_PROJECT_ID: 'your-project',
      }),
    (err) => err instanceof SupabaseEnvConfigError
  );

  // Non-HTTPS URL rejected
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: `http://${DUMMY_STAGING_PROJECT_ID}.supabase.co`,
        SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
        SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
      }),
    (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_INSECURE_URL'
  );

  // Mismatched SUPABASE_STAGING_PROJECT_ID rejected
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
        SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
        SUPABASE_STAGING_PROJECT_ID: DUMMY_PROD_PROJECT_ID,
      }),
    (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_PROJECT_ID_MISMATCH'
  );

  // Non-Supabase URL hostname where project ID cannot be verified is rejected
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: 'https://custom-proxy.example.com',
        SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
        SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
      }),
    (err) =>
      err instanceof SupabaseEnvConfigError && err.code === 'ENV_UNVERIFIABLE_URL_PROJECT_ID'
  );
});

test('5. Identical or swapped Staging and Production URLs, PROJECT_IDs, or keys are rejected', () => {
  // Same URL (even with different casing and trailing slash)
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: 'https://samedummyref12345.supabase.co/',
        SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
        SUPABASE_STAGING_PROJECT_ID: 'samedummyref12345',
        SUPABASE_PRODUCTION_URL: 'HTTPS://SAMEDUMMYREF12345.SUPABASE.CO',
        SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_PROD_KEY,
        SUPABASE_PRODUCTION_PROJECT_ID: 'otherprodref67890',
      }),
    (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_SHARED_URL_CONFLICT'
  );

  // Same PROJECT_ID
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'production',
        SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
        SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
        SUPABASE_STAGING_PROJECT_ID: 'sharedref9999',
        SUPABASE_PRODUCTION_URL: DUMMY_PROD_URL,
        SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_PROD_KEY,
        SUPABASE_PRODUCTION_PROJECT_ID: 'SHAREDREF9999',
      }),
    (err) =>
      err instanceof SupabaseEnvConfigError && err.code === 'ENV_SHARED_PROJECT_ID_CONFLICT'
  );

  // Swapped Staging and Production PROJECT_ID against their URLs
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
        SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
        SUPABASE_STAGING_PROJECT_ID: DUMMY_PROD_PROJECT_ID,
        SUPABASE_PRODUCTION_URL: DUMMY_PROD_URL,
        SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_PROD_KEY,
        SUPABASE_PRODUCTION_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
      }),
    (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_PROJECT_ID_MISMATCH'
  );

  // Same service role key
  assert.throws(
    () =>
      resolveSupabaseEnvironment({
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
        SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
        SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
        SUPABASE_PRODUCTION_URL: DUMMY_PROD_URL,
        SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
        SUPABASE_PRODUCTION_PROJECT_ID: DUMMY_PROD_PROJECT_ID,
      }),
    (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_SHARED_KEY_CONFLICT'
  );
});

test('6. Zero fallback to legacy SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY', () => {
  const stagingProbe = tryResolveSupabaseEnvironment({
    DENIO_ENV: 'staging',
    SUPABASE_URL: DUMMY_LEGACY_URL,
    SUPABASE_SERVICE_ROLE_KEY: DUMMY_LEGACY_KEY,
  });
  assert.equal(stagingProbe.ok, false);

  const prodProbe = tryResolveSupabaseEnvironment({
    DENIO_ENV: 'production',
    SUPABASE_URL: DUMMY_LEGACY_URL,
    SUPABASE_SERVICE_ROLE_KEY: DUMMY_LEGACY_KEY,
  });
  assert.equal(prodProbe.ok, false);
});

test('7. Service role secrets never appear in errors, probe summaries, or /api/health responses', async () => {
  const secretToken = 'sb_secret_super_secret_role_token_never_expose_987654321';

  // Error path checks (e.g. conflict or invalid URL/key never echo secret values)
  try {
    resolveSupabaseEnvironment({
      DENIO_ENV: 'staging',
      SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
      SUPABASE_STAGING_SERVICE_ROLE_KEY: secretToken,
      SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
      SUPABASE_PRODUCTION_URL: DUMMY_PROD_URL,
      SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: secretToken,
      SUPABASE_PRODUCTION_PROJECT_ID: DUMMY_PROD_PROJECT_ID,
    });
    assert.fail('Expected conflict error');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.equal(msg.includes(secretToken), false);
    assert.equal(msg.includes('super_secret'), false);
  }

  await withProcessEnv(
    {
      DENIO_ENV: 'staging',
      SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
      SUPABASE_STAGING_SERVICE_ROLE_KEY: secretToken,
      SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
      // Trigger cross-env conflict so getConnectorHealth exits before any network request
      SUPABASE_PRODUCTION_URL: DUMMY_STAGING_URL,
      SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_PROD_KEY,
      SUPABASE_PRODUCTION_PROJECT_ID: DUMMY_PROD_PROJECT_ID,
    },
    async () => {
      const health = await getConnectorHealth();
      const serialized = JSON.stringify(health);
      assert.equal(health.activeEnvironment, 'staging');
      assert.equal(health.supabaseConnected, false);
      assert.equal(serialized.includes(secretToken), false);
      assert.equal(serialized.includes(DUMMY_PROD_KEY), false);
    }
  );
});

test('8. Cached Supabase client supports sb_secret_ keys and never leaks across staging and production', () => {
  withProcessEnv(
    {
      DENIO_ENV: 'staging',
      SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
      SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
      SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
      SUPABASE_PRODUCTION_URL: DUMMY_PROD_URL,
      SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: DUMMY_PROD_KEY,
      SUPABASE_PRODUCTION_PROJECT_ID: DUMMY_PROD_PROJECT_ID,
    },
    () => {
      assert.equal(isSupabaseEnvConfigured(), true);
      const stagingClientA = getSupabaseAdminClient();
      const stagingClientB = getSupabaseAdminClient();
      assert.strictEqual(stagingClientA, stagingClientB);

      const stagingClientUrl = (stagingClientA as unknown as { supabaseUrl?: string }).supabaseUrl;
      assert.equal(stagingClientUrl, DUMMY_STAGING_URL);

      // Switch active environment to production -> MUST NOT return cached staging client
      process.env.DENIO_ENV = 'production';
      const prodClient = getSupabaseAdminClient();
      assert.notStrictEqual(prodClient, stagingClientA);

      const prodClientUrl = (prodClient as unknown as { supabaseUrl?: string }).supabaseUrl;
      assert.equal(prodClientUrl, DUMMY_PROD_URL);

      // Switch back to staging -> invalidates prod cache and returns staging URL client
      process.env.DENIO_ENV = 'staging';
      const stagingClientC = getSupabaseAdminClient();
      assert.notStrictEqual(stagingClientC, prodClient);
      assert.equal(
        (stagingClientC as unknown as { supabaseUrl?: string }).supabaseUrl,
        DUMMY_STAGING_URL
      );
    }
  );
});

test('9. loadActiveEnvFile loads only .env.<DENIO_ENV> and never falls back to .env or other env files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denio-env-test-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      `SUPABASE_PRODUCTION_URL=${DUMMY_PROD_URL}\nSUPABASE_PRODUCTION_PROJECT_ID=${DUMMY_PROD_PROJECT_ID}\nSUPABASE_URL=${DUMMY_LEGACY_URL}\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.env.production'),
      `SUPABASE_PRODUCTION_URL=${DUMMY_PROD_URL}\nSUPABASE_PRODUCTION_SERVICE_ROLE_KEY=${DUMMY_PROD_KEY}\nSUPABASE_PRODUCTION_PROJECT_ID=${DUMMY_PROD_PROJECT_ID}\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.env.staging'),
      `SUPABASE_STAGING_URL=${DUMMY_STAGING_URL}\nSUPABASE_STAGING_SERVICE_ROLE_KEY=${DUMMY_STAGING_KEY}\nSUPABASE_STAGING_PROJECT_ID=${DUMMY_STAGING_PROJECT_ID}\n`
    );

    const stagingEnv: NodeJS.ProcessEnv = { DENIO_ENV: 'staging' };
    const loaded = loadActiveEnvFile(stagingEnv, tmpDir);

    assert.deepEqual(loaded.loadedFiles, ['.env.staging']);
    assert.equal(stagingEnv.SUPABASE_STAGING_URL, DUMMY_STAGING_URL);
    assert.equal(stagingEnv.SUPABASE_STAGING_PROJECT_ID, DUMMY_STAGING_PROJECT_ID);
    assert.equal(stagingEnv.SUPABASE_PRODUCTION_URL, undefined);
    assert.equal(stagingEnv.SUPABASE_PRODUCTION_PROJECT_ID, undefined);
    assert.equal(stagingEnv.SUPABASE_URL, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('10. resolveServerStartupEnvironment allows unconfigured dev startup when DENIO_ENV is unset, while staying fail-closed for missing PROJECT_ID or NODE_ENV=production', () => {
  const emptyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denio-startup-test-'));
  try {
    // Dev mode with DENIO_ENV unset (even with legacy vars present) starts in unconfigured mode
    const devUnconfigured = resolveServerStartupEnvironment(
      {
        NODE_ENV: 'development',
        SUPABASE_URL: DUMMY_LEGACY_URL,
        SUPABASE_SERVICE_ROLE_KEY: DUMMY_LEGACY_KEY,
      },
      emptyTmpDir
    );
    assert.equal(devUnconfigured.mode, 'unconfigured');

    // Production runtime without DENIO_ENV MUST fail closed
    assert.throws(
      () =>
        resolveServerStartupEnvironment(
          {
            NODE_ENV: 'production',
            SUPABASE_URL: DUMMY_LEGACY_URL,
            SUPABASE_SERVICE_ROLE_KEY: DUMMY_LEGACY_KEY,
          },
          emptyTmpDir
        ),
      (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_INVALID_DENIO_ENV'
    );

    // Explicit DENIO_ENV=staging without SUPABASE_STAGING_PROJECT_ID MUST fail closed
    assert.throws(
      () =>
        resolveServerStartupEnvironment(
          {
            NODE_ENV: 'development',
            DENIO_ENV: 'staging',
            SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
            SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
          },
          emptyTmpDir
        ),
      (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_MISSING_PROJECT_ID'
    );

    // Explicit DENIO_ENV=staging with valid URL + sb_secret_ key + matching PROJECT_ID succeeds
    const stagingConfigured = resolveServerStartupEnvironment(
      {
        NODE_ENV: 'development',
        DENIO_ENV: 'staging',
        SUPABASE_STAGING_URL: DUMMY_STAGING_URL,
        SUPABASE_STAGING_SERVICE_ROLE_KEY: DUMMY_STAGING_KEY,
        SUPABASE_STAGING_PROJECT_ID: DUMMY_STAGING_PROJECT_ID,
      },
      emptyTmpDir
    );
    assert.equal(stagingConfigured.mode, 'configured');
    assert.equal(stagingConfigured.config.projectId, DUMMY_STAGING_PROJECT_ID);

    // Invalid explicit DENIO_ENV MUST fail closed
    assert.throws(
      () =>
        resolveServerStartupEnvironment(
          {
            NODE_ENV: 'development',
            DENIO_ENV: 'local',
          },
          emptyTmpDir
        ),
      (err) => err instanceof SupabaseEnvConfigError && err.code === 'ENV_INVALID_DENIO_ENV'
    );
  } finally {
    fs.rmSync(emptyTmpDir, { recursive: true, force: true });
  }
});
