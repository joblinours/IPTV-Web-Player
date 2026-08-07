import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env, radarrConfigured, sonarrConfigured } from '../config.js';
import { queryAll, queryOne, execute, nowEpoch } from '../db.js';
import { computePagination } from '../utils.js';
import { enqueueWebhook } from '../queue/index.js';
import {
  radarrLookupByTmdb,
  sonarrLookupByTvdb,
  radarrFindExistingByTmdb,
  sonarrFindExistingByTvdb,
  resolveTvdbId,
  arrPost,
  arrDelete,
} from '../radarrSonarr.js';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

export function registerRequestsRoutes(app: FastifyInstance) {
  app.post('/api/requests', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const bodySchema = z.object({
      tmdbId: z.coerce.number().int().positive(),
      mediaType: z.enum(['movie', 'tv']),
      title: z.string().max(512).optional(),
      year: z.coerce.number().int().min(1900).max(2100).optional(),
      posterPath: z.string().max(255).optional(),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }

    const service = parsed.data.mediaType === 'movie' ? 'radarr' : 'sonarr';
    if (service === 'radarr' && !radarrConfigured) {
      return reply.code(503).send({ message: 'Radarr is not configured yet' });
    }
    if (service === 'sonarr' && !sonarrConfigured) {
      return reply.code(503).send({ message: 'Sonarr is not configured yet' });
    }

    const existing = await queryOne<{ id: number; status: string }>(
      'SELECT id, status FROM media_requests WHERE user_id = ? AND media_type = ? AND tmdb_id = ?',
      [request.user.userId, parsed.data.mediaType, parsed.data.tmdbId]
    );
    if (existing) {
      return { id: existing.id, status: existing.status, alreadyRequested: true };
    }

    const now = nowEpoch();

    if (service === 'radarr') {
      const candidate = await radarrLookupByTmdb(parsed.data.tmdbId);
      if (!candidate) {
        return reply.code(422).send({ message: 'Movie not found on Radarr lookup' });
      }

      const insertResult = await execute(
        `INSERT INTO media_requests(user_id, tmdb_id, media_type, title, year, poster_path, status, service, requested_at, updated_at)
         VALUES (?, ?, 'movie', ?, ?, ?, 'pending', 'radarr', ?, ?)`,
        [
          request.user.userId,
          parsed.data.tmdbId,
          parsed.data.title ?? candidate.title ?? 'Untitled',
          parsed.data.year ?? null,
          parsed.data.posterPath ?? null,
          now,
          now,
        ]
      );

      const addResult = await arrPost<{ id: number }>('radarr', '/api/v3/movie', {
        ...candidate,
        qualityProfileId: env.radarrQualityProfileId,
        rootFolderPath: env.radarrRootFolder,
        monitored: true,
        minimumAvailability: 'released',
        addOptions: { searchForMovie: true },
      });

      if (addResult.ok && addResult.body) {
        await execute('UPDATE media_requests SET status = ?, service_item_id = ?, updated_at = ? WHERE id = ?', [
          'added',
          addResult.body.id,
          nowEpoch(),
          insertResult.insertId,
        ]);
        return { id: insertResult.insertId, status: 'added', alreadyRequested: false };
      }

      // "Already exists" (another user requested it first) is a success, not a failure.
      const existingRemote = await radarrFindExistingByTmdb(parsed.data.tmdbId);
      if (existingRemote) {
        await execute('UPDATE media_requests SET status = ?, service_item_id = ?, updated_at = ? WHERE id = ?', [
          'added',
          existingRemote.id,
          nowEpoch(),
          insertResult.insertId,
        ]);
        return { id: insertResult.insertId, status: 'added', alreadyRequested: false };
      }

      await execute('UPDATE media_requests SET status = ?, error_message = ?, updated_at = ? WHERE id = ?', [
        'failed',
        `Radarr rejected the request (HTTP ${addResult.status})`,
        nowEpoch(),
        insertResult.insertId,
      ]);
      return reply.code(502).send({ message: 'Radarr rejected the request' });
    }

    // Sonarr: keys on TVDB, not TMDB.
    const tvdbId = await resolveTvdbId(parsed.data.tmdbId);
    if (!tvdbId) {
      return reply.code(422).send({ message: 'No TVDB id found for this series' });
    }

    const candidate = await sonarrLookupByTvdb(tvdbId);
    if (!candidate) {
      return reply.code(422).send({ message: 'Series not found on Sonarr lookup' });
    }

    const insertResult = await execute(
      `INSERT INTO media_requests(user_id, tmdb_id, tvdb_id, media_type, title, year, poster_path, status, service, requested_at, updated_at)
       VALUES (?, ?, ?, 'tv', ?, ?, ?, 'pending', 'sonarr', ?, ?)`,
      [
        request.user.userId,
        parsed.data.tmdbId,
        tvdbId,
        parsed.data.title ?? candidate.title ?? 'Untitled',
        parsed.data.year ?? null,
        parsed.data.posterPath ?? null,
        now,
        now,
      ]
    );

    const addResult = await arrPost<{ id: number }>('sonarr', '/api/v3/series', {
      ...candidate,
      qualityProfileId: env.sonarrQualityProfileId,
      rootFolderPath: env.sonarrRootFolder,
      monitored: true,
      seasonFolder: true,
      addOptions: { monitor: 'all', searchForMissingEpisodes: true, searchForCutoffUnmetEpisodes: false },
    });

    if (addResult.ok && addResult.body) {
      await execute('UPDATE media_requests SET status = ?, service_item_id = ?, updated_at = ? WHERE id = ?', [
        'added',
        addResult.body.id,
        nowEpoch(),
        insertResult.insertId,
      ]);
      return { id: insertResult.insertId, status: 'added', alreadyRequested: false };
    }

    const existingRemote = await sonarrFindExistingByTvdb(tvdbId);
    if (existingRemote) {
      await execute('UPDATE media_requests SET status = ?, service_item_id = ?, updated_at = ? WHERE id = ?', [
        'added',
        existingRemote.id,
        nowEpoch(),
        insertResult.insertId,
      ]);
      return { id: insertResult.insertId, status: 'added', alreadyRequested: false };
    }

    await execute('UPDATE media_requests SET status = ?, error_message = ?, updated_at = ? WHERE id = ?', [
      'failed',
      `Sonarr rejected the request (HTTP ${addResult.status})`,
      nowEpoch(),
      insertResult.insertId,
    ]);
    return reply.code(502).send({ message: 'Sonarr rejected the request' });
  });

  app.get('/api/requests', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      status: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
      offset: z.coerce.number().int().min(0).optional().default(0),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    const whereStatus = parsed.data.status ? 'AND status = ?' : '';
    const params = parsed.data.status
      ? [request.user.userId, parsed.data.status]
      : [request.user.userId];

    const rows = await queryAll<any>(
      `SELECT id, tmdb_id, media_type, title, year, poster_path, status, service, requested_at, updated_at
       FROM media_requests WHERE user_id = ? ${whereStatus} ORDER BY requested_at DESC`,
      params
    );

    const total = rows.length;
    const paged = rows.slice(parsed.data.offset, parsed.data.offset + parsed.data.limit);

    return {
      items: paged.map((row) => ({
        id: row.id,
        tmdbId: row.tmdb_id,
        mediaType: row.media_type,
        title: row.title,
        year: row.year,
        posterUrl: row.poster_path ? `${TMDB_IMAGE_BASE}${row.poster_path}` : null,
        status: row.status,
        service: row.service,
        requestedAt: row.requested_at,
        updatedAt: row.updated_at,
      })),
      pagination: computePagination(total, parsed.data.offset, parsed.data.limit),
    };
  });

  app.delete('/api/requests/:id', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid request' });
    }

    const row = await queryOne<{ id: number; service: 'radarr' | 'sonarr'; service_item_id: number | null }>(
      'SELECT id, service, service_item_id FROM media_requests WHERE id = ? AND user_id = ?',
      [parsed.data.id, request.user.userId]
    );
    if (!row) {
      return reply.code(404).send({ message: 'Request not found' });
    }

    if (row.service_item_id) {
      const path = row.service === 'radarr' ? `/api/v3/movie/${row.service_item_id}` : `/api/v3/series/${row.service_item_id}`;
      await arrDelete(row.service, `${path}?deleteFiles=false&addImportExclusion=false`).catch(() => false);
    }

    await execute('DELETE FROM media_requests WHERE id = ?', [row.id]);
    return { ok: true };
  });

  // Radarr/Sonarr's "Webhook" connection only supports a URL + method (no
  // custom headers), so the shared secret lives in the path itself.
  const registerWebhook = (service: 'radarr' | 'sonarr') => {
    app.post(`/api/webhooks/${service}/:secret`, async (request: any, reply) => {
      const paramsSchema = z.object({ secret: z.string() });
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success || !env.requestsWebhookSecret) {
        return reply.code(404).send();
      }

      const provided = Buffer.from(parsed.data.secret);
      const expected = Buffer.from(env.requestsWebhookSecret);
      if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        return reply.code(404).send();
      }

      const body = request.body ?? {};
      const payloadHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

      try {
        await execute(
          'INSERT INTO webhook_events(service, event_type, external_id, payload_hash, received_at) VALUES (?, ?, ?, ?, ?)',
          [service, String(body.eventType ?? 'unknown'), body.movie?.id ?? body.series?.id ?? null, payloadHash, nowEpoch()]
        );
      } catch {
        // Duplicate payload_hash (unique key) => a retry we've already processed.
        return { ok: true };
      }

      await enqueueWebhook({ service, body });
      return { ok: true };
    });
  };

  registerWebhook('radarr');
  registerWebhook('sonarr');
}
