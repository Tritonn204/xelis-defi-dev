import { Pool } from 'pg';
import type { Config } from '../config';

let pool: Pool | null = null;

/**
 * Get or create the database pool
 * Safe to call multiple times - returns existing pool
 */
export function getPool(config: Config): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 5, // Limited pool for admin dashboard
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Log pool errors
    pool.on('error', (err) => {
      console.error('[pool] Unexpected error on idle client', err);
    });

    // Log pool creation
    console.log('[pool] Database pool created');
  }
  
  return pool;
}

/**
 * Close the database pool
 * Call during graceful shutdown
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[pool] Database pool closed');
  }
}

/**
 * Validate table name exists in public schema
 * Used by table CRUD operations
 */
export async function validateTableName(pool: Pool, tableName: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables 
     WHERE schemaname = 'public' AND tablename = $1`,
    [tableName]
  );
  return rows.length > 0;
}

/**
 * Get primary key column name for a table
 * Defaults to 'id' if no primary key found
 */
export async function getPrimaryKey(pool: Pool, tableName: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid 
       AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary
     LIMIT 1`,
    [tableName]
  );
  return rows[0]?.attname || 'id';
}

/**
 * Check if database connection is healthy
 * Used by health check endpoint
 */
export async function checkDatabaseHealth(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('[pool] Health check failed:', error);
    return false;
  }
}