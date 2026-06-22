import mysql, { Pool, PoolOptions, RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import { getEnv } from '../config/env.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

const logger = pino({ name: 'db-pool' });

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const env = getEnv();
    const options: PoolOptions = {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      connectionLimit: env.DB_CONNECTION_LIMIT,
      waitForConnections: true,
      namedPlaceholders: true,
    };
    pool = mysql.createPool(options);
    logger.info(
      { host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME, user: env.DB_USER },
      'MySQL pool created',
    );
  }
  return pool;
}

export async function queryReadOnly<T extends RowDataPacket[]>(
  sql: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  assertReadOnlySql(sql);
  const env = getEnv();
  const connection = await getPool().getConnection();
  try {
    try {
      await connection.query(`SET SESSION MAX_EXECUTION_TIME = ${env.DB_QUERY_TIMEOUT_MS}`);
    } catch {
      // MariaDB / MySQL antiguo: ignorar si MAX_EXECUTION_TIME no existe
    }
    const [rows] = await connection.query<T>(
      sql,
      params as Record<string, string | number | boolean | null>,
    );
    return rows;
  } catch (error) {
    logger.error({ err: sanitizeErrorMessage(error) }, 'Query failed');
    throw new Error(sanitizeErrorMessage(error));
  } finally {
    connection.release();
  }
}

export function assertReadOnlySql(sql: string): void {
  const normalized = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim();
  const forbidden =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|CALL|EXECUTE|LOAD\s+DATA|INTO\s+OUTFILE|INTO\s+DUMPFILE|LOCK\s+TABLES|UNLOCK\s+TABLES)\b/i;
  if (forbidden.test(normalized)) {
    throw new Error('Only read-only SELECT queries are permitted.');
  }
  if (!/^\s*(WITH\b[\s\S]*)?\s*SELECT\b/i.test(normalized)) {
    throw new Error('Only SELECT queries are permitted.');
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('MySQL pool closed');
  }
}
