import type { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { db } from '../db.js';
import { env } from '../config.js';
import { decryptSecret } from '../crypto.js';
import { normalizeServerUrl } from '../xtream.js';
import { sanitizeLogText } from '../utils.js';
import type { IptvAccountRow, PlaybackTrace } from '../types.js';

// Helper: Parse HTTP Range header (e.g., "bytes=1000-2000", "bytes=1000-", "bytes=-500")
function parseRangeHeader(rangeHeader: string | undefined, totalBytes: number): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null;

  const rangePart = rangeHeader.slice(6).trim();
  if (!rangePart || rangePart.includes(',')) return null;

  const parts = rangePart.split('-');
  if (parts.length !== 2) return null;

  const startRaw = parts[0].trim();
  const endRaw = parts[1].trim();

  let start = 0;
  let end = totalBytes - 1;

  if (startRaw === '' && endRaw === '') return null;

  if (startRaw === '') {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, totalBytes - suffixLength);
    end = totalBytes - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    if (!Number.isFinite(start) || start < 0 || start >= totalBytes) return null;

    if (endRaw !== '') {
      const parsedEnd = Number.parseInt(endRaw, 10);
      if (!Number.isFinite(parsedEnd) || parsedEnd < start) return null;
      end = Math.min(parsedEnd, totalBytes - 1);
    }
  }

  if (start > end) return null;
  return { start, end };
}

// Helper: Get duration in seconds from an FFmpeg-accessible source
async function getStreamDuration(sourceUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1:noprint_names=1', sourceUrl]);

    let output = '';
    ffprobe.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    ffprobe.on('close', () => {
      try {
        const duration = parseFloat(output.trim());
        resolve(isNaN(duration) ? null : duration);
      } catch {
        resolve(null);
      }
    });

    ffprobe.on('error', () => {
      resolve(null);
    });

    setTimeout(() => {
      if (!ffprobe.killed) {
        ffprobe.kill('SIGKILL');
        resolve(null);
      }
    }, 5000); // 5 second timeout
  });
}

export function registerStreamRoutes(app: FastifyInstance) {
  function logPlaybackTrace(trace: PlaybackTrace) {
    app.log.info({
      event: 'playback_trace',
      at: new Date().toISOString(),
      ...trace,
      mediaTitle: sanitizeLogText(trace.mediaTitle),
      seriesTitle: sanitizeLogText(trace.seriesTitle),
    });
  }

  app.get('/api/iptv/stream-url', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      type: z.enum(['live', 'vod', 'series']),
      streamId: z.coerce.number().int().positive(),
      containerExtension: z.string().min(2).max(8).optional(),
      mediaTitle: z.string().max(180).optional(),
      seriesTitle: z.string().max(180).optional(),
      seasonNumber: z.coerce.number().int().min(1).max(100).optional(),
      episodeNumber: z.coerce.number().int().min(1).max(10000).optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    const account = db
      .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as IptvAccountRow | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const password = decryptSecret(account.password_enc);
    const extension =
      parsed.data.containerExtension ?? (parsed.data.type === 'live' ? 'm3u8' : 'mp4');
    const pathType = parsed.data.type === 'live' ? 'live' : parsed.data.type === 'vod' ? 'movie' : 'series';
    const url = `${normalizeServerUrl(account.server_url)}/${pathType}/${account.username}/${password}/${parsed.data.streamId}.${extension}`;

    logPlaybackTrace({
      route: 'stream-url',
      mode: 'direct',
      accountId: parsed.data.accountId,
      mediaType: parsed.data.type,
      streamId: parsed.data.streamId,
      extension,
      mediaTitle: parsed.data.mediaTitle,
      seriesTitle: parsed.data.seriesTitle,
      seasonNumber: parsed.data.seasonNumber,
      episodeNumber: parsed.data.episodeNumber,
      note: 'url_generated',
    });

    return { url };
  });

  app.get('/api/iptv/stream-proxy', async (request: any, reply) => {
    const querySchema = z.object({
      token: z.string().min(10),
      accountId: z.coerce.number().int().positive(),
      type: z.enum(['live', 'vod', 'series']),
      streamId: z.coerce.number().int().positive(),
      containerExtension: z.string().min(2).max(8).optional(),
      mediaTitle: z.string().max(180).optional(),
      seriesTitle: z.string().max(180).optional(),
      seasonNumber: z.coerce.number().int().min(1).max(100).optional(),
      episodeNumber: z.coerce.number().int().min(1).max(10000).optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    let payload: { userId?: number };
    try {
      payload = (await app.jwt.verify(parsed.data.token)) as { userId?: number };
    } catch {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const userId = Number(payload.userId ?? 0);
    if (!userId) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const account = db
      .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, userId) as IptvAccountRow | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const password = decryptSecret(account.password_enc);
    const extension = parsed.data.containerExtension ?? (parsed.data.type === 'live' ? 'm3u8' : 'mp4');
    const pathType = parsed.data.type === 'live' ? 'live' : parsed.data.type === 'vod' ? 'movie' : 'series';
    const sourceUrl = `${normalizeServerUrl(account.server_url)}/${pathType}/${account.username}/${password}/${parsed.data.streamId}.${extension}`;

    const incomingRange = request.headers.range;
    const buildHeaders = (includeRange: boolean) => ({
      'User-Agent': 'Mozilla/5.0 IPTV-Web-Player',
      Referer: normalizeServerUrl(account.server_url),
      ...(includeRange && incomingRange ? { Range: String(incomingRange) } : {}),
    });

    const fetchWithTimeout = async (includeRange: boolean) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.streamProxyTimeoutMs);
      try {
        return await fetch(sourceUrl, {
          headers: buildHeaders(includeRange),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let upstream: Response;
    try {
      upstream = await fetchWithTimeout(true);
    } catch (error: any) {
      const note = error?.name === 'AbortError' ? 'proxy_timeout' : 'proxy_network_error';
      logPlaybackTrace({
        route: 'stream-proxy',
        mode: 'proxy',
        accountId: parsed.data.accountId,
        mediaType: parsed.data.type,
        streamId: parsed.data.streamId,
        extension,
        mediaTitle: parsed.data.mediaTitle,
        seriesTitle: parsed.data.seriesTitle,
        seasonNumber: parsed.data.seasonNumber,
        episodeNumber: parsed.data.episodeNumber,
        note,
      });
      return reply.code(504).send({ message: 'Upstream stream timeout' });
    }

    let fallbackWithoutRange = false;

    if ((upstream.status === 405 || upstream.status === 416) && incomingRange) {
      fallbackWithoutRange = true;
      try {
        upstream = await fetchWithTimeout(false);
      } catch (error: any) {
        const note = error?.name === 'AbortError' ? 'proxy_timeout_after_range_fallback' : 'proxy_network_error_after_range_fallback';
        logPlaybackTrace({
          route: 'stream-proxy',
          mode: 'proxy',
          accountId: parsed.data.accountId,
          mediaType: parsed.data.type,
          streamId: parsed.data.streamId,
          extension,
          mediaTitle: parsed.data.mediaTitle,
          seriesTitle: parsed.data.seriesTitle,
          seasonNumber: parsed.data.seasonNumber,
          episodeNumber: parsed.data.episodeNumber,
          fallbackWithoutRange,
          note,
        });
        return reply.code(504).send({ message: 'Upstream stream timeout' });
      }
    }

    logPlaybackTrace({
      route: 'stream-proxy',
      mode: 'proxy',
      accountId: parsed.data.accountId,
      mediaType: parsed.data.type,
      streamId: parsed.data.streamId,
      extension,
      mediaTitle: parsed.data.mediaTitle,
      seriesTitle: parsed.data.seriesTitle,
      seasonNumber: parsed.data.seasonNumber,
      episodeNumber: parsed.data.episodeNumber,
      upstreamStatus: upstream.status,
      fallbackWithoutRange,
      note: incomingRange ? 'range_request' : 'plain_request',
    });

    if (!upstream.ok && upstream.status !== 206) {
      return reply.code(upstream.status || 502).send({ message: 'Upstream stream rejected' });
    }

    const contentType = upstream.headers.get('content-type') ?? 'video/mp4';
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    const acceptRanges = upstream.headers.get('accept-ranges');

    reply.hijack();
    reply.raw.statusCode = upstream.status;
    reply.raw.setHeader('Content-Type', contentType);
    reply.raw.setHeader('Cache-Control', 'no-store');

    if (contentLength) reply.raw.setHeader('Content-Length', contentLength);
    if (contentRange) reply.raw.setHeader('Content-Range', contentRange);
    if (acceptRanges) reply.raw.setHeader('Accept-Ranges', acceptRanges);

    if (!upstream.body) {
      reply.raw.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body as any);
    request.raw.on('close', () => {
      nodeStream.destroy();
    });
    nodeStream.pipe(reply.raw);
  });

  app.get('/api/iptv/replay-url', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      streamId: z.coerce.number().int().positive(),
      start: z.string().min(10),
      durationMinutes: z.coerce.number().int().min(1).max(24 * 60),
      containerExtension: z.string().min(2).max(8).optional().default('ts'),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    const account = db
      .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as IptvAccountRow | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const password = decryptSecret(account.password_enc);

    const parseDate = (raw: string): Date | null => {
      const direct = new Date(raw);
      if (!Number.isNaN(direct.getTime())) return direct;

      const isoCandidate = raw.includes(' ') ? raw.replace(' ', 'T') : raw;
      const iso = new Date(isoCandidate);
      if (!Number.isNaN(iso.getTime())) return iso;

      return null;
    };

    const dt = parseDate(parsed.data.start);
    const normalizedStart = (() => {
      if (!dt) {
        return parsed.data.start;
      }

      const year = dt.getFullYear();
      const month = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      const hour = String(dt.getHours()).padStart(2, '0');
      const minute = String(dt.getMinutes()).padStart(2, '0');
      const second = String(dt.getSeconds()).padStart(2, '0');

      return `${year}-${month}-${day}:${hour}-${minute}-${second}`;
    })();

    const url = `${normalizeServerUrl(account.server_url)}/timeshift/${account.username}/${password}/${parsed.data.durationMinutes}/${normalizedStart}/${parsed.data.streamId}.${parsed.data.containerExtension}`;

    return { url };
  });

  app.get('/api/iptv/transcode', async (request: any, reply) => {
    const querySchema = z.object({
      token: z.string().min(10),
      accountId: z.coerce.number().int().positive(),
      type: z.enum(['live', 'vod', 'series']),
      streamId: z.coerce.number().int().positive(),
      seekSeconds: z.coerce.number().min(0).optional(),
      durationSeconds: z.coerce.number().min(1).optional(),
      containerExtension: z.string().min(2).max(8).optional().default('mkv'),
      mediaTitle: z.string().max(180).optional(),
      seriesTitle: z.string().max(180).optional(),
      seasonNumber: z.coerce.number().int().min(1).max(100).optional(),
      episodeNumber: z.coerce.number().int().min(1).max(10000).optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    let payload: { userId?: number };
    try {
      payload = (await app.jwt.verify(parsed.data.token)) as { userId?: number };
    } catch {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const userId = Number(payload.userId ?? 0);
    if (!userId) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const account = db
      .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, userId) as IptvAccountRow | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const password = decryptSecret(account.password_enc);
    const pathType = parsed.data.type === 'live' ? 'live' : parsed.data.type === 'vod' ? 'movie' : 'series';
    const sourceUrl = `${normalizeServerUrl(account.server_url)}/${pathType}/${account.username}/${password}/${parsed.data.streamId}.${parsed.data.containerExtension}`;

    // Handle Range requests for seeking in transcoded video
    let seekSeconds = typeof parsed.data.seekSeconds === 'number' && Number.isFinite(parsed.data.seekSeconds)
      ? Math.max(0, parsed.data.seekSeconds)
      : 0;

    let isRangeRequest = false;
    let contentRangeHeader: string | undefined;
    let responseStatusCode = 200;

    const rangeHeader = request.headers.range;
    if (rangeHeader && typeof rangeHeader === 'string') {
      // Try to use provided duration or fetch it
      let durationSeconds: number | null | undefined = parsed.data.durationSeconds;

      if (!durationSeconds) {
        // Fallback: try to fetch duration using ffprobe (with timeout)
        durationSeconds = await getStreamDuration(sourceUrl);
      }

      if (durationSeconds && durationSeconds > 0) {
        // Estimate file size using a conservative default transcode bitrate budget.
        const estimatedBitrateBitsPerSecond = 4_000_000; // 4 Mbps
        const estimatedTotalBytes = Math.max(1, Math.floor((durationSeconds * estimatedBitrateBitsPerSecond) / 8));

        const range = parseRangeHeader(rangeHeader, estimatedTotalBytes);
        if (range) {
          isRangeRequest = true;
          responseStatusCode = 206;

          // Map byte range to time range
          const bytesPerSecond = Math.max(1, estimatedTotalBytes / durationSeconds);
          const startSeconds = Math.floor(range.start / bytesPerSecond);
          const endSeconds = Math.floor(range.end / bytesPerSecond);

          seekSeconds = startSeconds;
          contentRangeHeader = `bytes ${range.start}-${range.end}/${estimatedTotalBytes}`;

          logPlaybackTrace({
            route: 'transcode',
            mode: 'transcode',
            accountId: parsed.data.accountId,
            mediaType: parsed.data.type,
            streamId: parsed.data.streamId,
            extension: parsed.data.containerExtension,
            mediaTitle: parsed.data.mediaTitle,
            seriesTitle: parsed.data.seriesTitle,
            seasonNumber: parsed.data.seasonNumber,
            episodeNumber: parsed.data.episodeNumber,
            note: `range_request_${range.start}-${range.end}_seek_${startSeconds}-${endSeconds}s`,
          });
        }
      }
    }

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-fflags',
      '+genpts',
    ];

    if (/^https?:\/\//i.test(sourceUrl)) {
      ffmpegArgs.push(
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '5',
        '-rw_timeout',
        '15000000',
      );
    }

    if (seekSeconds > 0) {
      ffmpegArgs.push('-ss', seekSeconds.toFixed(3));
    }

    ffmpegArgs.push(
      '-i',
      sourceUrl,
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-b:a',
      '160k',
      '-movflags',
      'frag_keyframe+empty_moov+faststart',
      '-f',
      'mp4',
      'pipe:1',
    );

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    logPlaybackTrace({
      route: 'transcode',
      mode: 'transcode',
      accountId: parsed.data.accountId,
      mediaType: parsed.data.type,
      streamId: parsed.data.streamId,
      extension: parsed.data.containerExtension,
      mediaTitle: parsed.data.mediaTitle,
      seriesTitle: parsed.data.seriesTitle,
      seasonNumber: parsed.data.seasonNumber,
      episodeNumber: parsed.data.episodeNumber,
      note: seekSeconds > 0 ? `ffmpeg_start_seek_${seekSeconds.toFixed(3)}` : 'ffmpeg_start',
    });

    let started = false;

    ffmpeg.stdout.once('data', () => {
      started = true;
    });

    ffmpeg.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) {
        app.log.warn({ message }, 'ffmpeg transcode');
      }
    });

    ffmpeg.on('error', () => {
      if (!reply.raw.headersSent) {
        reply.code(500).send({ message: 'FFmpeg not available on server' });
        return;
      }

      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });

    ffmpeg.on('close', (code) => {
      logPlaybackTrace({
        route: 'transcode',
        mode: 'transcode',
        accountId: parsed.data.accountId,
        mediaType: parsed.data.type,
        streamId: parsed.data.streamId,
        extension: parsed.data.containerExtension,
        mediaTitle: parsed.data.mediaTitle,
        seriesTitle: parsed.data.seriesTitle,
        seasonNumber: parsed.data.seasonNumber,
        episodeNumber: parsed.data.episodeNumber,
        note: `ffmpeg_close_${code ?? 'unknown'}`,
      });

      if (!started && !reply.raw.headersSent) {
        reply.code(502).send({ message: `Transcoding failed (${code ?? 'unknown'})` });
        return;
      }

      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });

    request.raw.on('close', () => {
      if (!ffmpeg.killed) {
        ffmpeg.kill('SIGKILL');
      }
    });

    reply.hijack();
    reply.raw.statusCode = responseStatusCode;
    reply.raw.setHeader('Content-Type', 'video/mp4');
    reply.raw.setHeader('Accept-Ranges', 'bytes');
    reply.raw.setHeader('Cache-Control', 'no-store');
    if (contentRangeHeader) {
      reply.raw.setHeader('Content-Range', contentRangeHeader);
    }
    ffmpeg.stdout.pipe(reply.raw);
  });
}
