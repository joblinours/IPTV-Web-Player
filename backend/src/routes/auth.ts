import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryOne, execute, nowEpoch } from '../db.js';
import { hashPassword, verifyPassword } from '../crypto.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = registerSchema;

export function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }

    // MySQL's utf8mb4_unicode_ci collation is case-insensitive, so this check
    // (and the UNIQUE KEY on the column) already treat "a@b.com" and
    // "A@B.com" as the same address.
    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [parsed.data.email]);
    if (existing) {
      return reply.code(409).send({ message: 'Email already exists' });
    }

    const passwordHash = hashPassword(parsed.data.password);
    const result = await execute('INSERT INTO users(email, password_hash, created_at) VALUES (?, ?, ?)', [
      parsed.data.email,
      passwordHash,
      nowEpoch(),
    ]);

    const token = await reply.jwtSign({ userId: result.insertId, email: parsed.data.email });
    return { token };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }

    const user = await queryOne<{ id: number; email: string; password_hash: string }>(
      'SELECT id, email, password_hash FROM users WHERE email = ?',
      [parsed.data.email]
    );

    if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    const token = await reply.jwtSign({ userId: user.id, email: user.email });
    return { token };
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (request: any) => {
    return { user: { id: request.user.userId, email: request.user.email } };
  });
}
