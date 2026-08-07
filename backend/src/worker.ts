// Standalone worker entrypoint — unused today (RUN_WORKERS=true runs workers
// inside the main Fastify process by default, see index.ts). Kept ready so
// splitting workers into their own `backend-worker` compose service later is
// just a compose edit, not a code change: set RUN_WORKERS=false on `backend`
// and add a service running `node dist/worker.js` with the same image/env.
import { waitForDb } from './db.js';
import { waitForRedis } from './redis.js';
import { startWorkers, stopWorkers } from './queue/index.js';

async function main() {
  await waitForDb();
  await waitForRedis();
  await startWorkers();
  console.log('[worker] started');

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, async () => {
      await stopWorkers();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error('[worker] failed to start', error);
  process.exit(1);
});
