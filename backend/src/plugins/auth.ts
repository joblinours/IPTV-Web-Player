import type { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(jwt, { secret: env.jwtSecret });

  app.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
  });
}
