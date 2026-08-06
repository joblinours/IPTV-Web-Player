import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, nowEpoch } from '../db.js';

export function registerPreferencesRoutes(app: FastifyInstance) {
  app.get('/api/preferences', { preHandler: [app.authenticate] }, async (request: any) => {
    const row = db
      .prepare('SELECT autoplay, language FROM user_preferences WHERE user_id = ?')
      .get(request.user.userId) as { autoplay: number; language: string } | undefined;

    return {
      autoplay: row ? row.autoplay === 1 : true,
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

    const existing = db
      .prepare('SELECT autoplay, language FROM user_preferences WHERE user_id = ?')
      .get(request.user.userId) as { autoplay: number; language: string } | undefined;

    const autoplay =
      parsed.data.autoplay !== undefined
        ? parsed.data.autoplay ? 1 : 0
        : (existing?.autoplay ?? 1);
    const language = parsed.data.language ?? existing?.language ?? 'fr';

    db.prepare(`
      INSERT INTO user_preferences(user_id, autoplay, language, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        autoplay = excluded.autoplay,
        language = excluded.language,
        updated_at = excluded.updated_at
    `).run(request.user.userId, autoplay, language, nowEpoch());

    return { ok: true };
  });
}
