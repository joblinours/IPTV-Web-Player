/**
 * One-off SQLite -> MySQL cutover script. Run ONCE per deployment, after
 * taking the backups documented in the plan (see repo root docker-compose
 * runbook). Never run this against a MySQL database that already has data —
 * pass --force-truncate only if you explicitly intend to overwrite it.
 *
 * Usage (inside the backend container, after `docker compose up -d mysql
 * redis backend` so 001_init has already run against the empty MySQL db):
 *
 *   node dist/scripts/migrate-sqlite-to-mysql.js \
 *     --sqlite /data-legacy/app.db --verify --verify-secrets
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { pool, waitForDb } from '../db.js';
import { decryptSecret } from '../crypto.js';

interface CliArgs {
  sqlitePath: string;
  verify: boolean;
  verifySecrets: boolean;
  forceTruncate: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    sqlitePath: 'app.db',
    verify: false,
    verifySecrets: false,
    forceTruncate: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sqlite') args.sqlitePath = argv[++i];
    else if (argv[i] === '--verify') args.verify = true;
    else if (argv[i] === '--verify-secrets') args.verifySecrets = true;
    else if (argv[i] === '--force-truncate') args.forceTruncate = true;
  }
  return args;
}

function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function fail(message: string): never {
  console.error(`\n[migrate] FAILED: ${message}\n`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[migrate] reading legacy SQLite database at ${args.sqlitePath}`);

  const sqlite = new Database(args.sqlitePath, { readonly: true, fileMustExist: true });

  // ── Pre-flight checks — read-only, refuse to continue on any failure ──────
  const emailCollisions = sqlite
    .prepare('SELECT LOWER(email) AS email, COUNT(*) AS n FROM users GROUP BY 1 HAVING COUNT(*) > 1')
    .all() as Array<{ email: string; n: number }>;
  if (emailCollisions.length > 0) {
    fail(`case-insensitive email collisions found: ${emailCollisions.map((r) => r.email).join(', ')}`);
  }

  const duplicateAccounts = sqlite
    .prepare('SELECT user_id, server_url, username, COUNT(*) AS n FROM iptv_accounts GROUP BY 1,2,3 HAVING COUNT(*) > 1')
    .all();
  if (duplicateAccounts.length > 0) {
    fail(`duplicate (server_url, username) per user found: ${JSON.stringify(duplicateAccounts)}`);
  }

  await waitForDb();

  const targetCounts = await Promise.all(
    ['users', 'media_sources', 'favorites', 'watch_progress', 'user_preferences'].map(async (table) => {
      const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM ${table}`);
      return (rows as any[])[0].n as number;
    })
  );
  const targetHasData = targetCounts.some((n) => n > 0);
  if (targetHasData && !args.forceTruncate) {
    fail('target MySQL tables are not empty — refusing to continue without --force-truncate');
  }

  // ── Copy, in dependency order, inside a single transaction ────────────────
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 0');

    const users = sqlite.prepare('SELECT id, email, password_hash, created_at FROM users').all() as any[];
    for (const user of users) {
      await connection.execute(
        'INSERT INTO users(id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
        [user.id, user.email, user.password_hash, user.created_at]
      );
    }
    console.log(`[migrate] users: ${users.length} rows`);

    const accounts = sqlite
      .prepare('SELECT id, user_id, name, server_url, username, password_enc, created_at FROM iptv_accounts')
      .all() as any[];
    for (const account of accounts) {
      const sourceKey = sha256hex(`xtream|${account.server_url}|${account.username}`);
      await connection.execute(
        `INSERT INTO media_sources(id, user_id, kind, name, server_url, username, secret_enc, source_key, created_at, updated_at)
         VALUES (?, ?, 'xtream', ?, ?, ?, ?, ?, ?, ?)`,
        [
          account.id,
          account.user_id,
          account.name,
          account.server_url,
          account.username,
          account.password_enc,
          sourceKey,
          account.created_at,
          account.created_at,
        ]
      );
    }
    console.log(`[migrate] media_sources (from iptv_accounts): ${accounts.length} rows`);

    const preferences = sqlite
      .prepare('SELECT user_id, autoplay, language, updated_at FROM user_preferences')
      .all() as any[];
    for (const pref of preferences) {
      await connection.execute(
        'INSERT INTO user_preferences(user_id, autoplay, language, updated_at) VALUES (?, ?, ?, ?)',
        [pref.user_id, pref.autoplay, pref.language, pref.updated_at]
      );
    }
    console.log(`[migrate] user_preferences: ${preferences.length} rows`);

    const favorites = sqlite
      .prepare('SELECT id, user_id, account_id, type, item_id, created_at FROM favorites')
      .all() as any[];
    for (const fav of favorites) {
      await connection.execute(
        'INSERT INTO favorites(id, user_id, source_id, type, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [fav.id, fav.user_id, fav.account_id, fav.type, fav.item_id, fav.created_at]
      );
    }
    console.log(`[migrate] favorites: ${favorites.length} rows`);

    const progressRows = sqlite
      .prepare(
        // "current_time" MUST be quoted: unquoted, SQLite parses it as the
        // special CURRENT_TIME literal (today's wall-clock time as a
        // string, e.g. "13:42:38") instead of a reference to the column of
        // that name — silently aliasing the wrong value to position_seconds.
        `SELECT id, user_id, account_id, type, item_id, series_id, season_number, episode_number,
                "current_time" AS position_seconds, total_duration, is_watched, needs_transcode, updated_at
         FROM watch_progress`
      )
      .all() as any[];
    let clampedCount = 0;
    for (const row of progressRows) {
      // Coerce first: defends against any other non-numeric surprise from
      // the legacy DB the same way, instead of letting a bad type silently
      // turn into NaN through Math.max/Math.min (which propagate NaN rather
      // than picking a safe bound when one operand isn't a finite number).
      let position = Number(row.position_seconds);
      let total = Number(row.total_duration);
      if (!Number.isFinite(position) || position < 0 || position > 1e9) {
        position = Math.min(Math.max(Number.isFinite(position) ? position : 0, 0), 1e9);
        clampedCount++;
      }
      if (!Number.isFinite(total) || total < 0 || total > 1e9) {
        total = Math.min(Math.max(Number.isFinite(total) ? total : 0, 0), 1e9);
        clampedCount++;
      }

      await connection.execute(
        `INSERT INTO watch_progress(id, user_id, source_id, type, item_id, series_id, season_number, episode_number, position_seconds, total_duration, is_watched, needs_transcode, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.user_id, row.account_id, row.type, row.item_id, row.series_id,
          row.season_number, row.episode_number, position, total, row.is_watched, row.needs_transcode, row.updated_at,
        ]
      );
    }
    console.log(`[migrate] watch_progress: ${progressRows.length} rows (${clampedCount} values clamped)`);

    // ── Verification, inside the still-open transaction ─────────────────────
    if (args.verify) {
      const checks: Array<[string, number]> = [
        ['users', users.length],
        ['media_sources', accounts.length],
        ['favorites', favorites.length],
        ['watch_progress', progressRows.length],
        ['user_preferences', preferences.length],
      ];
      for (const [table, expected] of checks) {
        const [rows] = await connection.query(`SELECT COUNT(*) AS n FROM ${table}`);
        const actual = (rows as any[])[0].n as number;
        if (actual !== expected) {
          throw new Error(`row count mismatch on ${table}: expected ${expected}, got ${actual}`);
        }
        console.log(`[migrate] verify ${table}: ${actual}/${expected} OK`);
      }
    }

    if (args.verifySecrets) {
      let failures = 0;
      for (const account of accounts) {
        try {
          const decrypted = decryptSecret(account.password_enc);
          if (!decrypted) failures++;
        } catch {
          failures++;
        }
      }
      if (failures > 0) {
        throw new Error(
          `${failures}/${accounts.length} media_sources.secret_enc values failed to decrypt — ` +
          'APP_ENCRYPTION_SECRET likely differs from the old deployment. DO NOT proceed.'
        );
      }
      console.log(`[migrate] verify-secrets: ${accounts.length}/${accounts.length} decrypted OK`);
    }

    await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 1');

    // Belt-and-braces: InnoDB derives AUTO_INCREMENT correctly from explicit
    // inserts, but make it explicit anyway.
    for (const table of ['users', 'media_sources', 'favorites', 'watch_progress']) {
      const [rows] = await connection.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ${table}`);
      const nextId = (rows as any[])[0].next_id as number;
      await connection.query(`ALTER TABLE ${table} AUTO_INCREMENT = ${nextId}`);
    }

    await connection.commit();
    console.log('\n[migrate] SUCCESS — transaction committed.\n');
  } catch (error) {
    await connection.rollback();
    fail(`transaction rolled back — nothing was written. Cause: ${(error as Error).message}`);
  } finally {
    connection.release();
  }

  sqlite.close();
  await pool.end();
}

main().catch((error) => {
  console.error('[migrate] unexpected error', error);
  process.exit(1);
});
