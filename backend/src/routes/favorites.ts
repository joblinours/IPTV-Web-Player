import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryOne, queryAll, execute, nowEpoch } from '../db.js';

export function registerFavoritesRoutes(app: FastifyInstance) {
  app.get('/api/favorites', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      type: z.enum(['live', 'vod', 'series']),
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

    const rows = await queryAll<{ item_id: string }>(
      'SELECT item_id FROM favorites WHERE user_id = ? AND source_id = ? AND type = ? ORDER BY id DESC',
      [request.user.userId, parsed.data.accountId, parsed.data.type]
    );

    return { items: rows.map((row) => row.item_id) };
  });

  app.post('/api/favorites', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const bodySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      type: z.enum(['live', 'vod', 'series']),
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

    await execute(
      `INSERT INTO favorites(user_id, source_id, type, item_id, created_at) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE created_at = created_at`,
      [request.user.userId, parsed.data.accountId, parsed.data.type, parsed.data.itemId, nowEpoch()]
    );

    return { ok: true };
  });

  app.delete('/api/favorites', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const bodySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      type: z.enum(['live', 'vod', 'series']),
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

    await execute('DELETE FROM favorites WHERE user_id = ? AND source_id = ? AND type = ? AND item_id = ?', [
      request.user.userId,
      parsed.data.accountId,
      parsed.data.type,
      parsed.data.itemId,
    ]);

    return { ok: true };
  });
}
