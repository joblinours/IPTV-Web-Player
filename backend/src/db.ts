import mysql, { type ResultSetHeader, type PoolConnection } from 'mysql2/promise';
import { env } from './config.js';
import { migrations } from './db/migrations.js';

export const pool = mysql.createPool({
  host: env.mysqlHost,
  port: env.mysqlPort,
  user: env.mysqlUser,
  password: env.mysqlPassword,
  database: env.mysqlDatabase,
  connectionLimit: env.mysqlPoolSize,
  waitForConnections: true,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  timezone: 'Z',
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
});

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Typed query helpers — deliberately NOT `db.prepare(...).get() as T` like the
 * old better-sqlite3 code. That pattern silences the type checker on a
 * forgotten `await`, which `tsc --noEmit` (our only pre-deploy gate) cannot
 * catch. These return real Promises, so a missing `await` is a compile error
 * on the very next property access instead of a runtime crash.
 */
export async function queryOne<T>(sql: string, params: any[] = []): Promise<T | undefined> {
  const [rows] = await pool.query(sql, params);
  const list = rows as T[];
  return list[0];
}

export async function queryAll<T>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function execute(sql: string, params: any[] = []): Promise<ResultSetHeader> {
  const [result] = await pool.execute(sql, params);
  return result as ResultSetHeader;
}

export async function withTransaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Retries the initial connection so the backend survives MySQL starting a few seconds slower. */
export async function waitForDb(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(`Could not reach MySQL within ${timeoutMs}ms: ${String(lastError)}`);
}

/** Minimal migration runner: TS-embedded `up` scripts, tracked in schema_migrations. */
export async function runMigrations(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) NOT NULL PRIMARY KEY,
      applied_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const applied = new Set(
    (await queryAll<{ version: string }>('SELECT version FROM schema_migrations')).map((row) => row.version)
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    console.log(`[db] applying migration ${migration.version}`);
    // Multiple `CREATE TABLE ...;` statements per migration — mysql2 needs
    // multipleStatements for this, so split and run them one at a time
    // instead of enabling that flag pool-wide (it's a SQL-injection footgun).
    const statements = migration.up
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await execute(statement);
    }

    await execute('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)', [
      migration.version,
      nowEpoch(),
    ]);
  }
}
