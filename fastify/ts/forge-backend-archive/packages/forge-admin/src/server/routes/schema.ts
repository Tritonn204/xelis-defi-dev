import { Router } from 'express';
import type { CoreServices } from '../factory/core';
import { sanitizeResponse } from '../services/sanitization';

export interface SchemaRouteDeps {
  core: CoreServices;
}

export function buildSchemaDeps(core: CoreServices): SchemaRouteDeps {
  return {
    core,
  };
}

export function createSchemaRoutes(deps: SchemaRouteDeps): Router {
  const router = Router();
  const { core } = deps;

  router.get('/schema/info', core.authenticate, async (req, res) => {
    const user = (req as any).user;
    await core.logAudit(user, 'view_schema', {}, req);

    const schema = await core.getCached('admin:schema-info', async () => {
      const { rows: tables } = await core.pool.query(`
        SELECT table_name
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);

      const tableDetails = await Promise.all(
        tables.map(async (table) => {
          const { rows: columns } = await core.pool.query(`
            SELECT 
              column_name,
              data_type,
              is_nullable,
              column_default
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = $1
            ORDER BY ordinal_position
          `, [table.table_name]);

          // Get indexes for this table
          const { rows: indexes } = await core.pool.query(`
            SELECT 
              i.relname as index_name,
              array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
              ix.indisunique as is_unique,
              ix.indisprimary as is_primary
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE t.relname = $1
            GROUP BY i.relname, ix.indisunique, ix.indisprimary
          `, [table.table_name]);

          return {
            name: table.table_name,
            columns: columns.map(col => ({
              name: col.column_name,
              type: col.data_type,
              nullable: col.is_nullable === 'YES',
              default: col.column_default,
            })),
            indexes: indexes.map(idx => ({
              name: idx.index_name,
              columns: idx.columns,
              unique: idx.is_unique,
              primary: idx.is_primary,
            }))
          };
        })
      );

      return { tables: tableDetails, version: Date.now() };
    }, 3600);

    res.json(schema);
  });

  router.post('/schema/refresh', core.csrfProtection, core.authenticate, async (req, res) => {
    try {
      await core.invalidateCache('admin:schema-info');
      await core.logAudit((req as any).user, 'refresh_schema', {}, req);
      res.json({ success: true, message: 'Schema cache cleared' });
    } catch (error) {
      console.error('[refresh-schema] Error:', error);
      res.status(500).json({ error: 'Failed to refresh schema' });
    }
  });

  router.post('/query', core.csrfProtection, core.authenticate, async (req, res) => {
    const { sql } = req.body;
    
    try {
      // ✅ Prevent querying sensitive admin tables directly
      if (/FROM\s+admin_users/i.test(sql) || /FROM\s+admin_audit_log/i.test(sql)) {
        return res.status(403).json({ 
          error: 'Cannot query admin tables directly. Use dedicated endpoints instead.' 
        });
      }

      if (!/^\s*SELECT/i.test(sql.trim())) {
        return res.status(400).json({ 
          error: 'Only SELECT queries allowed. Use macros for write operations.' 
        });
      }
      
      const safeSql = /LIMIT\s+\d+/i.test(sql) ? sql : `${sql} LIMIT 1000`;
      
      const result = await core.pool.query(safeSql);
      
      // ✅ Try to extract table name and sanitize
      const tableNameMatch = safeSql.match(/FROM\s+(\w+)/i);
      const tableName = tableNameMatch ? tableNameMatch[1] : null;
      const sanitizedRows = tableName ? sanitizeResponse(tableName, result.rows) : result.rows;
      
      await core.logAudit((req as any).user, 'execute_query', { 
        query: sql.substring(0, 200) 
      }, req);
      
      res.json({
        rows: sanitizedRows,  // ✅ Sanitized
        rowCount: result.rowCount,
        fields: result.fields.map((f: any) => ({
          name: f.name,
          dataTypeID: f.dataTypeID
        }))
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}