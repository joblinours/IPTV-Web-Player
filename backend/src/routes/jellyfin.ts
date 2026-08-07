import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env, jellyfinConfigured } from '../config.js';
import { enqueueJellyfinSync } from '../queue/index.js';

export function registerJellyfinRoutes(app: FastifyInstance) {
  app.get('/api/jellyfin/status', { preHandler: [app.authenticate] }, async () => {
    if (!jellyfinConfigured) {
      return { configured: false, reachable: false, version: null, serverName: null, libraries: [] };
    }

    try {
      const response = await fetch(`${env.jellyfinUrl}/System/Info/Public`);
      if (!response.ok) {
        return { configured: true, reachable: false, version: null, serverName: null, libraries: [] };
      }
      const info = (await response.json()) as { Version?: string; ServerName?: string };
      return {
        configured: true,
        reachable: true,
        version: info.Version ?? null,
        serverName: info.ServerName ?? null,
      };
    } catch {
      return { configured: true, reachable: false, version: null, serverName: null, libraries: [] };
    }
  });

  // Image proxy: an <img src> can't send an Authorization header, so this
  // mirrors the ?token= query-string pattern already used by
  // /api/iptv/stream-proxy. Keeps Jellyfin (and its api_key) off the public
  // network entirely — the browser never talks to Jellyfin directly.
  app.get('/api/jellyfin/image/:itemId/:imageType', async (request: any, reply) => {
    if (!jellyfinConfigured) {
      return reply.code(404).send();
    }

    const paramsSchema = z.object({
      itemId: z.string().min(1),
      imageType: z.enum(['Primary', 'Backdrop']),
    });
    const querySchema = z.object({ tag: z.string().optional(), token: z.string().optional() });

    const params = paramsSchema.safeParse(request.params);
    const query = querySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ message: 'Invalid request' });
    }

    if (query.data.token) {
      try {
        await app.jwt.verify(query.data.token);
      } catch {
        return reply.code(401).send();
      }
    }

    const tagParam = query.data.tag ? `&tag=${encodeURIComponent(query.data.tag)}` : '';
    const upstreamUrl =
      `${env.jellyfinUrl}/Items/${params.data.itemId}/Images/${params.data.imageType}` +
      `?api_key=${encodeURIComponent(env.jellyfinApiKey)}${tagParam}&maxHeight=450&quality=90`;

    try {
      const upstream = await fetch(upstreamUrl);
      if (!upstream.ok || !upstream.body) {
        return reply.code(upstream.status || 502).send();
      }

      reply.header('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
      // Safe to cache aggressively: the `tag` query param changes whenever
      // the underlying image does.
      reply.header('Cache-Control', 'public, max-age=86400, immutable');
      return reply.send(upstream.body);
    } catch {
      return reply.code(502).send();
    }
  });

  app.post('/api/jellyfin/sync', { preHandler: [app.authenticate] }, async (_request, reply) => {
    if (!jellyfinConfigured) {
      return reply.code(503).send({ message: 'Jellyfin is not configured' });
    }
    await enqueueJellyfinSync('manual');
    return { enqueued: true };
  });
}
