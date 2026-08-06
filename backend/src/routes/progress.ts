import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, nowEpoch } from '../db.js';

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

    const account = db
      .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const remaining =
      parsed.data.totalDuration > 0 ? parsed.data.totalDuration - parsed.data.currentTime : Infinity;
    const autoWatched = parsed.data.totalDuration > 0 && remaining <= 10 ? 1 : 0;
    const isWatched = parsed.data.isWatched === true ? 1 : autoWatched;
    const needsTranscode = parsed.data.needsTranscode === true ? 1 : 0;

    db.prepare(`
      INSERT INTO watch_progress(user_id, account_id, type, item_id, series_id, season_number, episode_number, current_time, total_duration, is_watched, needs_transcode, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, account_id, type, item_id) DO UPDATE SET
        current_time = excluded.current_time,
        total_duration = CASE
          WHEN excluded.total_duration > 0 THEN excluded.total_duration
          ELSE watch_progress.total_duration
        END,
        is_watched = MAX(watch_progress.is_watched, excluded.is_watched),
        needs_transcode = MAX(watch_progress.needs_transcode, excluded.needs_transcode),
        series_id = COALESCE(excluded.series_id, watch_progress.series_id),
        season_number = COALESCE(excluded.season_number, watch_progress.season_number),
        episode_number = COALESCE(excluded.episode_number, watch_progress.episode_number),
        updated_at = excluded.updated_at
    `).run(
      request.user.userId,
      parsed.data.accountId,
      parsed.data.type,
      parsed.data.itemId,
      parsed.data.seriesId ?? null,
      parsed.data.seasonNumber ?? null,
      parsed.data.episodeNumber ?? null,
      parsed.data.currentTime,
      parsed.data.totalDuration,
      isWatched,
      needsTranscode,
      nowEpoch()
    );

    return { ok: true };
  });

  app.get('/api/progress', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      type: z.enum(['vod', 'series_episode']),
      itemIds: z.string().optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    const account = db
      .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const itemIds = parsed.data.itemIds
      ? parsed.data.itemIds.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 200)
      : [];

    if (itemIds.length === 0) {
      return { items: [] };
    }

    const placeholders = itemIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT item_id, current_time, total_duration, is_watched, needs_transcode, updated_at
         FROM watch_progress
         WHERE user_id = ? AND account_id = ? AND type = ? AND item_id IN (${placeholders})`
      )
      .all(request.user.userId, parsed.data.accountId, parsed.data.type, ...itemIds) as Array<{
        item_id: string;
        current_time: number;
        total_duration: number;
        is_watched: number;
        needs_transcode: number;
        updated_at: number;
      }>;

    return {
      items: rows.map((row) => ({
        itemId: row.item_id,
        currentTime: row.current_time,
        totalDuration: row.total_duration,
        isWatched: row.is_watched === 1,
        needsTranscode: row.needs_transcode === 1,
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

    const account = db
      .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const rows = db
      .prepare(
        `SELECT item_id, current_time, total_duration, is_watched, needs_transcode, season_number, episode_number, updated_at
         FROM watch_progress
         WHERE user_id = ? AND account_id = ? AND series_id = ?
         ORDER BY updated_at DESC`
      )
      .all(request.user.userId, parsed.data.accountId, parsed.data.seriesId) as Array<{
        item_id: string;
        current_time: number;
        total_duration: number;
        is_watched: number;
        needs_transcode: number;
        season_number: number | null;
        episode_number: number | null;
        updated_at: number;
      }>;

    if (rows.length === 0) {
      return { lastEpisode: null, watchedEpisodeIds: [] };
    }

    const lastRow = rows[0];
    const watchedEpisodeIds = rows.filter((row) => row.is_watched === 1).map((row) => row.item_id);

    return {
      lastEpisode: {
        episodeId: lastRow.item_id,
        seasonNumber: lastRow.season_number,
        episodeNumber: lastRow.episode_number,
        currentTime: lastRow.current_time,
        totalDuration: lastRow.total_duration,
        isWatched: lastRow.is_watched === 1,
        needsTranscode: lastRow.needs_transcode === 1,
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

    const account = db
      .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    db.prepare(
      'DELETE FROM watch_progress WHERE user_id = ? AND account_id = ? AND type = ? AND item_id = ?'
    ).run(request.user.userId, parsed.data.accountId, parsed.data.type, parsed.data.itemId);

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
    const account = db
      .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    // Delete all watch progress for this account
    db.prepare(
      'DELETE FROM watch_progress WHERE user_id = ? AND account_id = ?'
    ).run(request.user.userId, parsed.data.accountId);

    return { ok: true };
  });
}
