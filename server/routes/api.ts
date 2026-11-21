import { Router, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { SupabaseEnvConfigError } from '../config/supabaseEnv.ts';
import {
  SupabaseRepositoryError,
  radarRepository,
} from '../repositories/radarRepository.ts';
import { getConnectorHealth } from '../services/connectorStatus.ts';
import { GeminiClassifierError } from '../services/discoveryClassifier.ts';
import {
  DiscoveryOrchestrationError,
  getLastDiscoveryRun,
  retryRawBatchClassification,
  runLiveSearchDiscovery,
} from '../services/searchDiscoveryService.ts';
import { TavilyApiError } from '../services/tavilyClient.ts';

export const apiRouter = Router();

function handleRouteError(res: Response, err: unknown, fallbackMessage: string) {
  if (err instanceof SupabaseEnvConfigError) {
    res.status(503).json({ error: err.message });
    return;
  }
  if (
    err instanceof SupabaseRepositoryError ||
    err instanceof TavilyApiError ||
    err instanceof GeminiClassifierError ||
    err instanceof DiscoveryOrchestrationError
  ) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  res.status(400).json({ error: err instanceof Error ? err.message : fallbackMessage });
}

apiRouter.get('/health', async (_req, res) => {
  const health = await getConnectorHealth();
  res.json(health);
});

apiRouter.get('/snapshot', async (_req, res) => {
  try {
    const snapshot = await radarRepository.getSnapshot();
    res.json(snapshot);
  } catch (err) {
    handleRouteError(res, err, 'Failed to load DENIO RADAR snapshot from Supabase.');
  }
});

apiRouter.get('/sources', async (_req, res) => {
  try {
    const sources = await radarRepository.listSources();
    res.json(sources);
  } catch (err) {
    handleRouteError(res, err, 'Failed to list sources.');
  }
});

apiRouter.post('/sources', async (req, res) => {
  try {
    const created = await radarRepository.createSource(req.body);
    res.status(201).json(created);
  } catch (err) {
    handleRouteError(res, err, 'Failed to create source.');
  }
});

apiRouter.patch('/sources/:id', async (req, res) => {
  try {
    const updated = await radarRepository.updateSource(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    handleRouteError(res, err, 'Failed to update source.');
  }
});

apiRouter.delete('/sources/:id', async (req, res) => {
  try {
    await radarRepository.deleteSource(req.params.id);
    res.status(204).send();
  } catch (err) {
    handleRouteError(res, err, 'Source not found.');
  }
});

apiRouter.post('/jobs', async (req, res) => {
  try {
    const job = await radarRepository.createJob(req.body);
    res.status(201).json(job);
  } catch (err) {
    handleRouteError(res, err, 'Failed to create job.');
  }
});

apiRouter.post('/jobs/:id/toggle', async (req, res) => {
  try {
    const job = await radarRepository.toggleJobStatus(req.params.id);
    res.json(job);
  } catch (err) {
    handleRouteError(res, err, 'Failed to toggle job.');
  }
});

apiRouter.post('/jobs/:id/trigger', async (req, res) => {
  try {
    const result = await radarRepository.triggerJobDryRun(req.params.id);
    res.json(result);
  } catch (err) {
    handleRouteError(res, err, 'Failed to trigger job.');
  }
});

apiRouter.post('/discovery/keywords', async (req, res) => {
  try {
    const kw = await radarRepository.createKeyword(
      req.body?.phrase ?? '',
      req.body?.category ?? '',
      req.body?.region ?? ''
    );
    res.status(201).json(kw);
  } catch (err) {
    handleRouteError(res, err, 'Failed to add keyword.');
  }
});

apiRouter.post('/discovery/keywords/:id/toggle', async (req, res) => {
  try {
    const kw = await radarRepository.toggleKeyword(req.params.id);
    res.json(kw);
  } catch (err) {
    handleRouteError(res, err, 'Keyword not found.');
  }
});

apiRouter.get('/discovery/last-run', (_req, res) => {
  res.json({ lastRun: getLastDiscoveryRun() });
});

apiRouter.get('/discovery/batches', async (_req, res) => {
  try {
    const batches = await radarRepository.listRawDiscoveryBatches(20);
    res.json({ batches });
  } catch (err) {
    handleRouteError(res, err, 'Failed to load raw discovery batches.');
  }
});

apiRouter.post('/discovery/batches/:id/retry-classification', async (req, res) => {
  try {
    const result = await retryRawBatchClassification(req.params.id);
    res.json(result);
  } catch (err) {
    handleRouteError(res, err, 'Failed to retry batch classification.');
  }
});

apiRouter.post('/discovery/run', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await runLiveSearchDiscovery({
      keywordIds: body.keywordIds,
      maxKeywords: body.maxKeywords,
      maxResultsPerKeyword: body.maxResultsPerKeyword,
      timeRange: body.timeRange,
      excludeDomains: body.excludeDomains,
    });
    res.json(result);
  } catch (err) {
    handleRouteError(res, err, 'Live search discovery failed.');
  }
});

apiRouter.post('/discovery/candidates/:id/promote', async (req, res) => {
  try {
    const result = await radarRepository.promoteCandidate(req.params.id);
    res.json(result);
  } catch (err) {
    handleRouteError(res, err, 'Failed to promote candidate.');
  }
});

apiRouter.post('/discovery/candidates/:id/dismiss', async (req, res) => {
  try {
    const result = await radarRepository.dismissCandidate(req.params.id);
    res.json(result);
  } catch (err) {
    handleRouteError(res, err, 'Candidate not found.');
  }
});

apiRouter.patch('/content/:id', async (req, res) => {
  try {
    const updated = await radarRepository.updateContentStatus(
      req.params.id,
      req.body?.reviewStatus
    );
    res.json(updated);
  } catch (err) {
    handleRouteError(res, err, 'Failed to update content.');
  }
});

apiRouter.put('/settings', async (req, res) => {
  try {
    const updated = await radarRepository.updateSettings(req.body);
    res.json(updated);
  } catch (err) {
    handleRouteError(res, err, 'Failed to update settings.');
  }
});

apiRouter.get('/schema', (_req, res) => {
  try {
    const migrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/001_phase2a_init.sql'
    );
    const migration2b1Path = path.resolve(
      process.cwd(),
      'supabase/migrations/002_phase2b1_discovery_quality.sql'
    );
    const schemaPath = fs.existsSync(migrationPath)
      ? migrationPath
      : path.resolve(process.cwd(), 'supabase/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    const phase2b1Sql = fs.existsSync(migration2b1Path)
      ? fs.readFileSync(migration2b1Path, 'utf-8')
      : '';
    res.json({ sql, phase2b1Sql });
  } catch {
    res.status(404).json({ error: 'Schema file not found.' });
  }
});

apiRouter.delete('/logs', async (_req, res) => {
  try {
    const logs = await radarRepository.clearLogs();
    res.json(logs);
  } catch (err) {
    handleRouteError(res, err, 'Failed to clear logs.');
  }
});

apiRouter.post('/reset', (_req, res) => {
  res.status(409).json({
    error:
      'Demo reset is disabled in Supabase PostgreSQL mode to protect existing database records.',
  });
});
