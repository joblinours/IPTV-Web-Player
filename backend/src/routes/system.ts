import type { FastifyInstance } from 'fastify';
import { env, jellyfinConfigured, radarrConfigured, sonarrConfigured } from '../config.js';
import { pool } from '../db.js';
import { redis } from '../redis.js';

export function registerSystemRoutes(app: FastifyInstance) {
  // Liveness-only: always 200, no DB call. frontend's docker-compose
  // depends_on keys on this — a transient MySQL blip must never take the
  // whole UI down with it. Use /api/system/health for a real diagnostic.
  app.get('/health', async () => ({ ok: true }));

  app.get('/api/version', async () => ({
    version: env.appVersion,
    commit: env.gitCommit,
    buildDate: process.env.BUILD_DATE ?? null,
  }));

  app.get('/api/system/health', async () => {
    const [mysqlOk, redisOk] = await Promise.all([
      pool.query('SELECT 1').then(() => true).catch(() => false),
      redis.ping().then(() => true).catch(() => false),
    ]);

    return { mysql: mysqlOk, redis: redisOk };
  });

  app.get('/api/system/integrations', async () => ({
    tmdb: !!env.tmdbApiKey,
    jellyfin: jellyfinConfigured,
    radarr: radarrConfigured,
    sonarr: sonarrConfigured,
  }));
}
