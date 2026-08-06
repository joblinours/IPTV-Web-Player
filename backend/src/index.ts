import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config.js';
import { initDb } from './db.js';
import { registerAuth } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerFavoritesRoutes } from './routes/favorites.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerPreferencesRoutes } from './routes/preferences.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerTmdbRoutes } from './routes/tmdb.js';
import { registerSystemRoutes } from './routes/system.js';

const app = Fastify({ logger: true });

initDb();

await app.register(cors, { origin: env.corsOrigin, credentials: true });
await registerAuth(app);

registerAuthRoutes(app);
registerAccountRoutes(app);
registerFavoritesRoutes(app);
registerProgressRoutes(app);
registerPreferencesRoutes(app);
registerCatalogRoutes(app);
registerStreamRoutes(app);
registerTmdbRoutes(app);
registerSystemRoutes(app);

app.listen({ host: env.host, port: env.port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
