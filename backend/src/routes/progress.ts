import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryOne, queryAll, execute, nowEpoch } from '../db.js';

export function registerProgressRoutes(app: FastifyInstance) {
  app.post('/api/progress', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const bodySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      type: z.enum(['vod', 'series_episode']),
      itemId: z.string().min(1),
      seriesId: z.string().optional(),
      seasonNumber: z.coerce.number().int().min(1).optional(),
      episodeNumber: z.coerce.number().int().min(1).optional(),
      currentTime: z.coerce.number().min(0),
      totalDuration: z.coerce.number().min(0),
      isWatched: z.boolean().optional(),
      needsTranscode: z.boolean().optional(),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }

    const source = await queryOne<{ id: number }>(
      'SELECT id FROM media_sources WHERE id = ? AND user_id = ?',
      [parsed.data.accountId, request.user.userId]
    );

    if (!source) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    // Clamp non-finite values (Infinity would be accepted by the schema
    // above but MySQL's DOUBLE column rejects it).
    const positionSeconds = Number.isFinite(parsed.data.currentTime) ? parsed.data.currentTime : 0;
    const totalDuration = Number.isFinite(parsed.data.totalDuration) ? parsed.data.totalDuration : 0;

    const remaining = totalDuration > 0 ? totalDuration - positionSeconds : Infinity;
    const autoWatched = totalDuration > 0 && remaining <= 10 ? 1 : 0;
    const isWatched = parsed.data.isWatched === true ? 1 : autoWatched;
    const needsTranscode = parsed.data.needsTranscode === true ? 1 : 0;

    await execute(
      `
      INSERT INTO watch_progress(user_id, source_id, type, item_id, series_id, season_number, episode_number, position_seconds, total_duration, is_watched, needs_transcode, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
      ON DUPLICATE KEY UPDATE
        position_seconds = new.position_seconds,
        total_duration = CASE
          WHEN new.total_duration > 0 THEN new.total_duration
          ELSE watch_progress.total_duration
        END,
        is_watched = GREATEST(watch_progress.is_watched, new.is_watched),
        needs_transcode = GREATEST(watch_progress.needs_transcode, new.needs_transcode),
        series_id = COALESCE(new.series_id, watch_progress.series_id),
        season_number = COALESCE(new.season_number, watch_progress.season_number),
        episode_number = COALESCE(new.episode_number, watch_progress.episode_number),
        updated_at = new.updated_at
    `,
      [
        request.user.userId,
        parsed.data.accountId,
        parsed.data.type,
        parsed.data.itemId,
        parsed.data.seriesId ?? null,
        parsed.data.seasonNumber ?? null,
        parsed.data.episodeNumber ?? null,
        positionSeconds,
        totalDuration,
        isWatched,
        needsTranscode,
        nowEpoch(),
      ]
    );

    return { ok: true };
  });

  app.get('/api/progress', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive().optional(),
      mode: z.enum(['single', 'merged']).optional().default('single'),
      type: z.enum(['vod', 'series_episode']),
      itemIds: z.string().optional(),
      // Merged mode: comma list of `${sourceId}:${itemId}` pairs — a bare
      // itemId isn't unique once more than one source is in play, so the
      // caller must tell us which source each item came from.
      itemKeys: z.string().optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    if (parsed.data.mode === 'merged') {
      const pairs = (parsed.data.itemKeys ?? '')
        .split(',')
        .map((raw) => raw.trim())
        .filter(Boolean)
        .slice(0, 200)
        .map((raw) => {
          const separatorIndex = raw.indexOf(':');
          if (separatorIndex <= 0) return null;
          const sourceId = Number(raw.slice(0, separatorIndex));
          const itemId = raw.slice(separatorIndex + 1);
          return Number.isFinite(sourceId) && itemId ? { sourceId, itemId } : null;
        })
        .filter((pair): pair is { sourceId: number; itemId: string } => pair !== null);

      if (pairs.length === 0) {
        return { items: [] };
      }

      const itemIdsBySource = new Map<number, string[]>();
      for (const pair of pairs) {
        const list = itemIdsBySource.get(pair.sourceId) ?? [];
        list.push(pair.itemId);
        itemIdsBySource.set(pair.sourceId, list);
      }

      const items: Array<{ sourceId: number; itemId: string; currentTime: number; totalDuration: number; isWatched: boolean; needsTranscode: boolean; updatedAt: number }> = [];
      for (const [sourceId, itemIds] of itemIdsBySource) {
        const source = await queryOne<{ id: number }>(
          'SELECT id FROM media_sources WHERE id = ? AND user_id = ?',
          [sourceId, request.user.userId]
        );
        if (!source) continue; // silently skip — not an error, just nothing to report for a source the user no longer owns

        const placeholders = itemIds.map(() => '?').join(',');
        const rows = await queryAll<{
          item_id: string;
          position_seconds: number;
          total_duration: number;
          is_watched: number;
          needs_transcode: number;
          updated_at: number;
        }>(
          `SELECT item_id, position_seconds, total_duration, is_watched, needs_transcode, updated_at
           FROM watch_progress
           WHERE user_id = ? AND source_id = ? AND type = ? AND item_id IN (${placeholders})`,
          [request.user.userId, sourceId, parsed.data.type, ...itemIds]
        );

        for (const row of rows) {
          items.push({
            sourceId,
            itemId: row.item_id,
            currentTime: row.position_seconds,
            totalDuration: row.total_duration,
            isWatched: Boolean(row.is_watched),
            needsTranscode: Boolean(row.needs_transcode),
            updatedAt: row.updated_at,
          });
        }
      }

      return { items };
    }

    if (!parsed.data.accountId) {
      return reply.code(400).send({ message: 'accountId is required outside merged mode' });
    }

    const source = await queryOne<{ id: number }>(
      'SELECT id FROM media_sources WHERE id = ? AND user_id = ?',
      [parsed.data.accountId, request.user.userId]
    );

    if (!source) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const itemIds = parsed.data.itemIds
      ? parsed.data.itemIds.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 200)
      : [];

    if (itemIds.length === 0) {
      return { items: [] };
    }

    const placeholders = itemIds.map(() => '?').join(',');
    const rows = await queryAll<{
      item_id: string;
      position_seconds: number;
      total_duration: number;
      is_watched: number;
      needs_transcode: number;
      updated_at: number;
    }>(
      `SELECT item_id, position_seconds, total_duration, is_watched, needs_transcode, updated_at
       FROM watch_progress
       WHERE user_id = ? AND source_id = ? AND type = ? AND item_id IN (${placeholders})`,
      [request.user.userId, parsed.data.accountId, parsed.data.type, ...itemIds]
    );

    return {
      items: rows.map((row) => ({
        itemId: row.item_id,
        currentTime: row.position_seconds,
        totalDuration: row.total_duration,
        isWatched: Boolean(row.is_watched),
        needsTranscode: Boolean(row.needs_transcode),
        updatedAt: row.updated_at,
      })),
    };
  });

  app.get('/api/progress/series', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      seriesId: z.string().min(1),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    const source = await queryOne<{ id: number }>(
      'SELECT id FROM media_sources WHERE id = ? AND user_id = ?',
      [parsed.data.accountId, request.user.userId]
    );

    if (!source) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const rows = await queryAll<{
      item_id: string;
      position_seconds: number;
      total_duration: number;
      is_watched: number;
      needs_transcode: number;
      season_number: number | null;
      episode_number: number | null;
      updated_at: number;
    }>(
      `SELECT item_id, position_seconds, total_duration, is_watched, needs_transcode, season_number, episode_number, updated_at
       FROM watch_progress
       WHERE user_id = ? AND source_id = ? AND series_id = ?
       ORDER BY updated_at DESC`,
      [request.user.userId, parsed.data.accountId, parsed.data.seriesId]
    );

    if (rows.length === 0) {
      return { lastEpisode: null, watchedEpisodeIds: [] };
    }

    const lastRow = rows[0];
    const watchedEpisodeIds = rows.filter((row) => Boolean(row.is_watched)).map((row) => row.item_id);

    return {
      lastEpisode: {
        episodeId: lastRow.item_id,
        seasonNumber: lastRow.season_number,
        episodeNumber: lastRow.episode_number,
        currentTime: lastRow.position_seconds,
        totalDuration: lastRow.total_duration,
        isWatched: Boolean(lastRow.is_watched),
        needsTranscode: Boolean(lastRow.needs_transcode),
      },
      watchedEpisodeIds,
    };
  });

  app.delete('/api/progress', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const bodySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      type: z.enum(['vod', 'series_episode']),
      itemId: z.string().min(1),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }

    const source = await queryOne<{ id: number }>(
      'SELECT id FROM media_sources WHERE id = ? AND user_id = ?',
      [parsed.data.accountId, request.user.userId]
    );

    if (!source) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    await execute('DELETE FROM watch_progress WHERE user_id = ? AND source_id = ? AND type = ? AND item_id = ?', [
      request.user.userId,
      parsed.data.accountId,
      parsed.data.type,
      parsed.data.itemId,
    ]);

    return { ok: true };
  });

  app.delete('/api/progress/clear', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    // Verify user owns this account
    const source = await queryOne<{ id: number }>(
      'SELECT id FROM media_sources WHERE id = ? AND user_id = ?',
      [parsed.data.accountId, request.user.userId]
    );

    if (!source) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    // Delete all watch progress for this account
    await execute('DELETE FROM watch_progress WHERE user_id = ? AND source_id = ?', [
      request.user.userId,
      parsed.data.accountId,
    ]);

    return { ok: true };
  });
}
