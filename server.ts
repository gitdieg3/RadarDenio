import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveServerStartupEnvironment,
} from './server/config/supabaseEnv.ts';
import { apiRouter } from './server/routes/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const startupEnv = resolveServerStartupEnvironment();

  const app = express();
  const requestedPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  const PORT =
    process.env.NODE_ENV !== 'production' && nginxPort && requestedPort === nginxPort
      ? Number(process.env.DEFAULT_APP_PORT) || 3000
      : requestedPort || 3000;

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter);

  let viteServer: { close: () => Promise<void> } | null = null;

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    viteServer = vite;
    app.use(vite.middlewares);
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    if (startupEnv.mode === 'configured') {
      const envSourceNote =
        startupEnv.loadedFiles.length > 0
          ? `env files: ${startupEnv.loadedFiles.join(', ')}`
          : 'process environment';
      console.log(
        `DENIO RADAR server listening on http://0.0.0.0:${PORT} [DENIO_ENV=${startupEnv.config.environment.toUpperCase()} | target: ${startupEnv.config.targetHost} | ${envSourceNote}]`
      );
    } else {
      console.log(
        `DENIO RADAR dev server listening on http://0.0.0.0:${PORT} [DENIO_ENV=UNCONFIGURED | ${startupEnv.reason}]`
      );
    }
  });

  httpServer.on('error', (err) => {
    console.error('HTTP server error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });

  const shutdown = async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    if (viteServer) {
      await viteServer.close().catch(() => {});
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
