import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, nowEpoch } from '../db.js';

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

    const account = db
      .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const rows = db
      .prepare('SELECT item_id FROM favorites WHERE user_id = ? AND account_id = ? AND type = ? ORDER BY id DESC')
      .all(request.user.userId, parsed.data.accountId, parsed.data.type) as { item_id: string }[];

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

    const account = db
      .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    db.prepare(
      `INSERT OR IGNORE INTO favorites(user_id, account_id, type, item_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(request.user.userId, parsed.data.accountId, parsed.data.type, parsed.data.itemId, nowEpoch());

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

    const account = db
      .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    db.prepare('DELETE FROM favorites WHERE user_id = ? AND account_id = ? AND type = ? AND item_id = ?').run(
      request.user.userId,
      parsed.data.accountId,
      parsed.data.type,
      parsed.data.itemId
    );

    return { ok: true };
  });
}
