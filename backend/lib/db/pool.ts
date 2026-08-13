/**
 * PostgreSQL 连接池：读取 DATABASE_URL。
 * 未配置 DATABASE_URL 时返回 null，调用方据此回退到内存仓储。
 */
import pg from 'pg';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      max: Number(process.env.DB_POOL_SIZE) || 10,
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000,
    });
    pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
  }
  return pool;
}

export async function assertDbConnection(): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('SELECT 1');
    return true;
  } catch (e: any) {
    console.error('[db] connection check failed:', e?.message);
    return false;
  }
}