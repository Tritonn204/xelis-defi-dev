import { Pool } from 'pg';
import fs from 'fs/promises';
import path from 'path';

export async function ensureSchemaFromFile(pool: Pool, filePath?: string) {
  const resolved = filePath ?? path.join(process.cwd(), 'schema.sql');
  const ddl = await fs.readFile(resolved, 'utf8');
  const sql = ddl.replace(/^\uFEFF/, ''); // strip BOM if present
  // Postgres accepts multiple semicolon-separated statements in one query
  await pool.query(sql);
}