import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryAll, execute, nowEpoch } from '../db.js';
import { encryptSecret } from '../crypto.js';
import { normalizeServerUrl } from '../xtream.js';
import { ensureJellyfinSource } from '../sources/index.js';
import crypto from 'node:crypto';

const addAccountSchema = z.object({
  name: z.string().min(1),
  serverUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});

function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function registerAccountRoutes(app: FastifyInstance) {
  app.post('/api/iptv/accounts', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const parsed = addAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }

    const serverUrl = normalizeServerUrl(parsed.data.serverUrl);
    const sourceKey = sha256hex(`xtream|${serverUrl}|${parsed.data.username}`);
    const now = nowEpoch();

    const result = await execute(
      `INSERT INTO media_sources(user_id, kind, name, server_url, username, secret_enc, source_key, created_at, updated_at)
       VALUES (?, 'xtream', ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.user.userId,
        parsed.data.name,
        serverUrl,
        parsed.data.username,
        encryptSecret(parsed.data.password),
        sourceKey,
        now,
        now,
      ]
    );

    return { accountId: result.insertId };
  });

  app.get('/api/iptv/accounts', { preHandler: [app.authenticate] }, async (request: any) => {
    // Jellyfin, if configured, is auto-provisioned as a browsable "account"
    // the first time this is called — no-op when JELLYFIN_URL/API_KEY are unset.
    await ensureJellyfinSource(request.user.userId);

    const rows = await queryAll(
      'SELECT id, name, server_url, username, kind, created_at FROM media_sources WHERE user_id = ? ORDER BY id DESC',
      [request.user.userId]
    );
    return { items: rows };
  });
}
