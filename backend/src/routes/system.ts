import type { FastifyInstance } from 'fastify';
import { env } from '../config.js';

export function registerSystemRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true }));

  app.get('/api/version', async () => ({
    version: env.appVersion,
    commit: env.gitCommit,
    buildDate: process.env.BUILD_DATE ?? null,
  }));
}
