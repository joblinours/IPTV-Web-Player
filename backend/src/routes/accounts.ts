import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, nowEpoch } from '../db.js';
import { encryptSecret } from '../crypto.js';
import { normalizeServerUrl } from '../xtream.js';

const addAccountSchema = z.object({
  name: z.string().min(1),
  serverUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});

export function registerAccountRoutes(app: FastifyInstance) {
  app.post('/api/iptv/accounts', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const parsed = addAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }

    const result = db
      .prepare(
        `INSERT INTO iptv_accounts(user_id, name, server_url, username, password_enc, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        request.user.userId,
        parsed.data.name,
        normalizeServerUrl(parsed.data.serverUrl),
        parsed.data.username,
        encryptSecret(parsed.data.password),
        nowEpoch()
      );

    return { accountId: result.lastInsertRowid };
  });

  app.get('/api/iptv/accounts', { preHandler: [app.authenticate] }, async (request: any) => {
    const rows = db
      .prepare('SELECT id, name, server_url, username, created_at FROM iptv_accounts WHERE user_id = ? ORDER BY id DESC')
      .all(request.user.userId);
    return { items: rows };
  });
}
