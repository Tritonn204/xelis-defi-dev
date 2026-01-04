import type { Pool, PoolClient } from 'pg';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  requiresBatching?: boolean;
  estimatedRows?: number;
}

export interface BatchExecutionResult {
  success: boolean;
  totalRowsAffected: number;
  batchesExecuted: number;
  executionTimeMs: number;
}

// Patterns to block in macros
const MACRO_DENY_PATTERNS = [
  { pattern: /DROP\s+(TABLE|DATABASE|SCHEMA)/i, message: 'DROP operations not allowed' },
  { pattern: /TRUNCATE/i, message: 'TRUNCATE not allowed' },
  { pattern: /ALTER\s+TABLE/i, message: 'Schema changes not allowed (use migrations)' },
  { pattern: /CREATE\s+(TABLE|INDEX)/i, message: 'Schema changes not allowed' },
];

/**
 * Validate SQL for macro execution
 * Checks deny patterns and estimates row impact
 */
export async function validateMacroSQL(pool: Pool, sql: string): Promise<ValidationResult> {
  // Check deny list first
  for (const { pattern, message } of MACRO_DENY_PATTERNS) {
    if (pattern.test(sql)) {
      return { valid: false, error: message };
    }
  }

  const isSelect = /^\s*SELECT/i.test(sql.trim());
  const isWrite = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql.trim());
  const hasLimit = /LIMIT\s+\d+/i.test(sql);

  try {
    // Get query plan to estimate row count
    const { rows } = await pool.query(`EXPLAIN (FORMAT JSON) ${sql}`);
    const plan = rows[0]['QUERY PLAN'][0];
    const estimatedRows = plan?.Plan?.['Plan Rows'] || 0;

    // SELECT rules
    if (isSelect) {
      if (!hasLimit && estimatedRows > 1000) {
        return { 
          valid: false, 
          error: `SELECT query may return ${estimatedRows} rows. Add LIMIT clause (max 50000) or use batching.` 
        };
      }
      
      if (hasLimit) {
        const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
        const limitValue = parseInt(limitMatch?.[1] || '0');
        if (limitValue > 50000) {
          return { valid: false, error: 'SELECT LIMIT cannot exceed 50000 rows' };
        }
      }
    }

    // Write operation rules  
    if (isWrite && estimatedRows > 10000) {
      return {
        valid: true,
        requiresBatching: true,
        estimatedRows,
      };
    }

    return { valid: true, estimatedRows };

  } catch (err: any) {
    // If EXPLAIN fails, be permissive but cautious
    if (isSelect && !hasLimit) {
      return { valid: false, error: 'Cannot analyze query. Please add LIMIT clause to SELECT queries.' };
    }
    return { valid: false, error: `SQL Error: ${err.message}` };
  }
}

/**
 * Check if query is a write operation
 */
export function isWriteQuery(sql: string): boolean {
  return /^\s*(INSERT|UPDATE|DELETE)/i.test(sql.trim());
}

/**
 * Execute write query in batches with transaction safety
 */
export async function executeBatched(
  pool: Pool,
  sql: string, 
  parameters: any[], 
  batchSize: number
): Promise<BatchExecutionResult> {
  const startTime = Date.now();
  let totalRowsAffected = 0;
  let batchesExecuted = 0;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const batchedQuery = convertToBatchedQuery(sql, batchSize);
    
    while (true) {
      const result = await client.query(batchedQuery, parameters);
      const rowsAffected = result.rowCount || 0;
      
      totalRowsAffected += rowsAffected;
      batchesExecuted++;
      
      if (rowsAffected === 0) break;
      
      if (batchesExecuted >= 1000) {
        throw new Error('Batch limit exceeded. Query may be too broad.');
      }
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await client.query('COMMIT');

    return {
      success: true,
      totalRowsAffected,
      batchesExecuted,
      executionTimeMs: Date.now() - startTime,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;

  } finally {
    client.release();
  }
}

/**
 * Convert a query to a batched version with LIMIT
 */
function convertToBatchedQuery(sql: string, batchSize: number): string {
  // Handle DELETE statements
  if (/^\s*DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)/i.test(sql)) {
    const match = sql.match(/^\s*DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)/i);
    if (match) {
      const [, tableName, whereClause] = match;
      return `
        DELETE FROM ${tableName} 
        WHERE id IN (
          SELECT id FROM ${tableName} 
          WHERE ${whereClause} 
          LIMIT ${batchSize}
        )
      `;
    }
  }
  
  // Handle UPDATE statements
  if (/^\s*UPDATE\s+(\w+)\s+SET\s+(.+)\s+WHERE\s+(.+)/i.test(sql)) {
    const match = sql.match(/^\s*UPDATE\s+(\w+)\s+SET\s+(.+)\s+WHERE\s+(.+)/i);
    if (match) {
      const [, tableName, setClause, whereClause] = match;
      return `
        UPDATE ${tableName} 
        SET ${setClause}
        WHERE id IN (
          SELECT id FROM ${tableName} 
          WHERE ${whereClause} 
          LIMIT ${batchSize}
        )
      `;
    }
  }
  
  return sql; // Fallback to original
}