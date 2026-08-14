/**
 * 数据库迁移：读取 backend/db/schema.sql 并执行（幂等）。
 * 用法：
 *   node --loader tsx backend/db/migrate.ts   （需要 DATABASE_URL）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getPool } from '../lib/db/pool.js';

// migrate.ts 独立运行，需自行加载 .env（server.ts 由自身 dotenv.config() 负责）
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    console.warn('[migrate] DATABASE_URL 未配置，跳过迁移。');
    return;
  }
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('[migrate] schema applied.');
}

// 仅当直接运行本文件时执行迁移（避免被 import 时误跑）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((e: any) => {
      console.error('[migrate] failed:', e?.message);
      process.exit(1);
    });
}