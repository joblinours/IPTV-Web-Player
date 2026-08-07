import { Queue, Worker, type Job } from 'bullmq';
import { bullConnection } from '../redis.js';
import { env } from '../config.js';
import { processJellyfinSync, type JellyfinSyncJobData } from './workers/jellyfinSync.js';
import { processWebhook, processPollStatus, processEpisodeMonitor, type WebhookJobData, type EpisodeMonitorJobData } from './workers/mediaRequests.js';
import { processTmdbEnrich, type TmdbEnrichJobData } from './workers/tmdbEnrich.js';

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

export const mediaRequestsQueue = new Queue<WebhookJobData | EpisodeMonitorJobData | Record<string, never>>('media-requests', {
  connection: bullConnection,
  defaultJobOptions,
});

export const maintenanceQueue = new Queue<TmdbEnrichJobData | Record<string, never>>('maintenance', {
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

export async function enqueueEpisodeMonitor(data: EpisodeMonitorJobData): Promise<void> {
  // A few seconds' delay: give Sonarr's own POST /series response a moment
  // to fully settle server-side before the first episode-list poll.
  await mediaRequestsQueue.add('episode-monitor', data, { delay: 3000 });
}

export async function enqueueTmdbEnrich(data: TmdbEnrichJobData): Promise<void> {
  // Deduped by jobId: many cards can share the exact same title/year within
  // the same TTL window (a re-run of a batch that's still mid-resolution
  // shouldn't queue the same lookup twice).
  const jobId = `tmdb-enrich-${data.type}-${data.title.trim().toLowerCase()}-${data.year ?? ''}`;
  await maintenanceQueue.add('resolve-tmdb-match', data, { jobId });
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
      if (job.name === 'episode-monitor') return processEpisodeMonitor(job.data as EpisodeMonitorJobData);
    },
    { connection: bullConnection, concurrency: env.workerConcurrency }
  );

  const maintenanceWorker = new Worker(
    'maintenance',
    async (job) => {
      if (job.name === 'resolve-tmdb-match') return processTmdbEnrich(job.data as TmdbEnrichJobData);
    },
    { connection: bullConnection, concurrency: env.workerConcurrency }
  );

  jellyfinWorker.on('failed', (job, error) => console.warn('[queue] jellyfin-sync job failed', job?.id, error.message));
  requestsWorker.on('failed', (job, error) => console.warn('[queue] media-requests job failed', job?.id, error.message));
  maintenanceWorker.on('failed', (job, error) => console.warn('[queue] maintenance job failed', job?.id, error.message));

  workers = [jellyfinWorker, requestsWorker, maintenanceWorker];

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
