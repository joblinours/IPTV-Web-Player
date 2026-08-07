import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryOne, execute, nowEpoch } from '../db.js';

export function registerPreferencesRoutes(app: FastifyInstance) {
  app.get('/api/preferences', { preHandler: [app.authenticate] }, async (request: any) => {
    const row = await queryOne<{ autoplay: number; language: string }>(
      'SELECT autoplay, language FROM user_preferences WHERE user_id = ?',
      [request.user.userId]
    );

    return {
      autoplay: row ? Boolean(row.autoplay) : true,
      language: row?.language ?? 'fr',
    };
  });

  app.put('/api/preferences', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const bodySchema = z.object({
      autoplay: z.boolean().optional(),
      language: z.string().min(2).max(5).optional(),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }

    const existing = await queryOne<{ autoplay: number; language: string }>(
      'SELECT autoplay, language FROM user_preferences WHERE user_id = ?',
      [request.user.userId]
    );

    const autoplay =
      parsed.data.autoplay !== undefined
        ? parsed.data.autoplay ? 1 : 0
        : (existing?.autoplay ?? 1);
    const language = parsed.data.language ?? existing?.language ?? 'fr';

    await execute(
      `INSERT INTO user_preferences(user_id, autoplay, language, updated_at) VALUES (?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE
         autoplay = new.autoplay,
         language = new.language,
         updated_at = new.updated_at`,
      [request.user.userId, autoplay, language, nowEpoch()]
    );

    return { ok: true };
  });
}
