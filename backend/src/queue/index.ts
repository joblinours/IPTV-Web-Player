import { Queue, Worker, type Job } from 'bullmq';
import { bullConnection } from '../redis.js';
import { env } from '../config.js';
import { processJellyfinSync, type JellyfinSyncJobData } from './workers/jellyfinSync.js';
import { processWebhook, processPollStatus, type WebhookJobData } from './workers/mediaRequests.js';

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 3600, count: 100 },
  removeOnFail: { age: 86_400 },
};

export const jellyfinSyncQueue = new Queue<JellyfinSyncJobData>('jellyfin-sync', {
  connection: bullConnection,
  defaultJobOptions,
});

export const mediaRequestsQueue = new Queue<WebhookJobData | Record<string, never>>('media-requests', {
  connection: bullConnection,
  defaultJobOptions,
});

export const maintenanceQueue = new Queue('maintenance', {
  connection: bullConnection,
  defaultJobOptions,
});

let workers: Worker[] = [];

export async function enqueueJellyfinSync(reason: 'periodic' | 'import' | 'manual', delayMs = 0): Promise<void> {
  await jellyfinSyncQueue.add(
    'sync',
    { reason },
    { jobId: reason === 'periodic' ? 'jf-sync-periodic' : 'jf-sync-adhoc', delay: delayMs }
  );
}

export async function enqueueWebhook(data: WebhookJobData): Promise<void> {
  await mediaRequestsQueue.add('process-webhook', data);
}

export async function startWorkers(): Promise<void> {
  if (!env.runWorkers) {
    console.log('[queue] RUN_WORKERS=false — skipping in-process workers (start dist/worker.js separately)');
    return;
  }

  const jellyfinWorker = new Worker<JellyfinSyncJobData>(
    'jellyfin-sync',
    async (job: Job<JellyfinSyncJobData>) => processJellyfinSync(job.data),
    { connection: bullConnection, concurrency: 1 }
  );

  const requestsWorker = new Worker(
    'media-requests',
    async (job) => {
      if (job.name === 'process-webhook') return processWebhook(job.data as WebhookJobData);
      if (job.name === 'poll-status') return processPollStatus();
    },
    { connection: bullConnection, concurrency: env.workerConcurrency }
  );

  jellyfinWorker.on('failed', (job, error) => console.warn('[queue] jellyfin-sync job failed', job?.id, error.message));
  requestsWorker.on('failed', (job, error) => console.warn('[queue] media-requests job failed', job?.id, error.message));

  workers = [jellyfinWorker, requestsWorker];

  // Repeatable jobs: re-registering with the same jobId on every boot is
  // idempotent (BullMQ dedupes by repeat key), so this is safe to call every
  // startup rather than only once.
  await jellyfinSyncQueue.add(
    'sync',
    { reason: 'periodic' },
    { repeat: { every: env.jellyfinSyncIntervalMs }, jobId: 'jf-sync-periodic' }
  );
  await mediaRequestsQueue.add(
    'poll-status',
    {},
    { repeat: { every: 300_000 }, jobId: 'req-poll' }
  );
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
}
