import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config.js';
import { pool, waitForDb, runMigrations } from './db.js';
import { redis, bullConnection, waitForRedis } from './redis.js';
import { registerAuth } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerFavoritesRoutes } from './routes/favorites.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerPreferencesRoutes } from './routes/preferences.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerTmdbRoutes } from './routes/tmdb.js';
import { registerJellyfinRoutes } from './routes/jellyfin.js';
import { registerRequestsRoutes } from './routes/requests.js';
import { registerSystemRoutes } from './routes/system.js';
import { startWorkers, stopWorkers } from './queue/index.js';

const app = Fastify({ logger: true });

console.log('[boot] waiting for MySQL...');
await waitForDb();
console.log('[boot] running migrations...');
await runMigrations();
console.log('[boot] waiting for Redis...');
await waitForRedis();

await app.register(cors, { origin: env.corsOrigin, credentials: true });
await registerAuth(app);

registerAuthRoutes(app);
registerAccountRoutes(app);
registerFavoritesRoutes(app);
registerProgressRoutes(app);
registerPreferencesRoutes(app);
registerCatalogRoutes(app);
registerStreamRoutes(app);
registerTmdbRoutes(app);
registerJellyfinRoutes(app);
registerRequestsRoutes(app);
registerSystemRoutes(app);

if (env.runWorkers) {
  app.addHook('onReady', async () => {
    await startWorkers();
  });
}

app.addHook('onClose', async () => {
  await stopWorkers();
  await pool.end();
  await redis.quit();
  await bullConnection.quit();
});

let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`[boot] received ${signal}, shutting down gracefully`);
    app.close().then(() => process.exit(0));
  });
}

app.listen({ host: env.host, port: env.port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
