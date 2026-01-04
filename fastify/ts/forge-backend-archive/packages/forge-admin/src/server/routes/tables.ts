import { Router } from 'express';
import type { CoreServices } from '../factory/core';
import { validateTableName, getPrimaryKey } from '../services/database';
import { sanitizeResponse, SENSITIVE_COLUMNS } from '../services/sanitization';

export interface TablesRouteDeps {
  core: CoreServices;
}

export function buildTablesDeps(core: CoreServices): TablesRouteDeps {
  return {
    core,
  };
}

export function createTablesRoutes(deps: TablesRouteDeps): Router {
  const router = Router();
  const { core } = deps;
  
  router.get('/tables/:tableName/data', core.authenticate, async (req, res) => {
    const { tableName } = req.params;
    const { page = '1', pageSize = '50', sortBy, sortOrder = 'ASC' } = req.query;
    
    try {
      if (tableName === 'admin_users') {
        return res.status(403).json({ error: 'Cannot browse admin_users directly. Use /admin/users endpoint instead.' });
      }

      if (!await validateTableName(core.pool, tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }

      const offset = (Number(page) - 1) * Number(pageSize);
      const limit = Math.min(Number(pageSize), 1000);
      
      let orderByClause = '';
      if (sortBy) {
        const { rows: columnCheck } = await core.pool.query(
          `SELECT column_name FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
          [tableName, sortBy]
        );
        
        if (columnCheck.length === 0) {
          return res.status(400).json({ error: 'Invalid sort column' });
        }
        
        const validatedOrder = sortOrder === 'DESC' ? 'DESC' : 'ASC';
        orderByClause = `ORDER BY "${sortBy as string}" ${validatedOrder}`;
      }
      
      // ✅ Safe because validateTableName confirmed it exists in pg_tables
      const countQuery = `SELECT COUNT(*) as total FROM ${tableName}`;
      const { rows: countRows } = await core.pool.query(countQuery);
      
      const dataQuery = `
        SELECT * FROM ${tableName}
        ${orderByClause}
        LIMIT $1 OFFSET $2
      `;
      const { rows: data } = await core.pool.query(dataQuery, [limit, offset]);
      
      const sanitizedData = sanitizeResponse(tableName, data);
      
      await core.logAudit((req as any).user, 'browse_table', { 
        table: tableName,
        page,
        pageSize 
      }, req);
      
      res.json({
        data: sanitizedData,
        total: parseInt(countRows[0].total),
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(countRows[0].total / Number(pageSize))
      });
      
    } catch (error: any) {
      console.error('[browse-table] Error:', error);
      res.status(500).json({ error: 'Failed to fetch table data' });
    }
  });

  router.get('/tables/:tableName/row/:id', core.authenticate, async (req, res) => {
    const { tableName, id } = req.params;
    
    try {
      if (tableName === 'admin_users') {
        return res.status(403).json({ error: 'Cannot view admin_users directly. Use /admin/users/:id endpoint instead.' });
      }

      if (!await validateTableName(core.pool, tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }
      
      const pkColumn = await getPrimaryKey(core.pool, tableName);
      
      const { rows } = await core.pool.query(
        `SELECT * FROM ${tableName} WHERE "${pkColumn}" = $1`,
        [id]
      );
      
      if (!rows.length) {
        return res.status(404).json({ error: 'Row not found' });
      }
      
      const sanitizedRow = sanitizeResponse(tableName, rows[0]);
      
      res.json(sanitizedRow);
    } catch (error: any) {
      console.error('[get-row] Error:', error);
      res.status(500).json({ error: 'Failed to fetch row' });
    }
  });

  router.put('/tables/:tableName/row/:id', core.csrfProtection, core.authenticate, async (req, res) => {
    const { tableName, id } = req.params;
    const updates = req.body;
    
    try {
      // ✅ Block direct admin_users updates
      if (tableName === 'admin_users') {
        return res.status(403).json({ 
          error: 'Cannot update admin_users directly. Use /admin/users/:id endpoint instead.' 
        });
      }

      if (!await validateTableName(core.pool, tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }
      
      const columnNames = Object.keys(updates);
      
      // ✅ Check if trying to update sensitive columns
      const sensitiveColumns = SENSITIVE_COLUMNS[tableName] || [];
      const attemptedSensitive = columnNames.filter(col => sensitiveColumns.includes(col));
      
      if (attemptedSensitive.length > 0) {
        await core.logAudit((req as any).user, 'attempted_sensitive_column_update', {
          table: tableName,
          sensitive_columns: attemptedSensitive,
          id
        }, req);
        
        return res.status(403).json({ 
          error: `Cannot update sensitive columns: ${attemptedSensitive.join(', ')}` 
        });
      }
      
      // ✅ Validate all column names exist
      const { rows: validColumns } = await core.pool.query(
        `SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = $1 
          AND column_name = ANY($2)`,
        [tableName, columnNames]
      );
      
      if (validColumns.length !== columnNames.length) {
        return res.status(400).json({ error: 'Invalid column name(s)' });
      }
      
      const pkColumn = await getPrimaryKey(core.pool, tableName);
      const values = Object.values(updates);
      const setClause = columnNames
        .map((col, idx) => `"${col}" = $${idx + 1}`)
        .join(', ');
      
      const { rows } = await core.pool.query(
        `UPDATE ${tableName} 
        SET ${setClause} 
        WHERE "${pkColumn}" = $${columnNames.length + 1} 
        RETURNING *`,
        [...values, id]
      );
      
      if (!rows.length) {
        return res.status(404).json({ error: 'Row not found' });
      }
      
      // ✅ Sanitize response before sending
      const sanitizedRow = sanitizeResponse(tableName, rows[0]);
      
      await core.logAudit((req as any).user, 'update_row', { 
        table: tableName, 
        id, 
        columns: columnNames 
      }, req);
      
      res.json(sanitizedRow);  // ✅ Sanitized
    } catch (error: any) {
      console.error('[update-row] Error:', error);
      res.status(500).json({ error: 'Failed to update row' });
    }
  });

  router.post('/tables/:tableName/row', core.csrfProtection, core.authenticate, async (req, res) => {
    const { tableName } = req.params;
    const data = req.body;
    
    try {
      if (tableName === 'admin_users') {
        return res.status(403).json({ 
          error: 'Cannot insert into admin_users directly. Use /admin/users endpoint instead.' 
        });
      }

      if (!await validateTableName(core.pool, tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }
      
      const columnNames = Object.keys(data);
      
      const sensitiveColumns = SENSITIVE_COLUMNS[tableName] || [];
      const attemptedSensitive = columnNames.filter(col => sensitiveColumns.includes(col));
      
      if (attemptedSensitive.length > 0) {
        await core.logAudit((req as any).user, 'attempted_sensitive_column_insert', {
          table: tableName,
          sensitive_columns: attemptedSensitive
        }, req);
        
        return res.status(403).json({ 
          error: `Cannot insert sensitive columns: ${attemptedSensitive.join(', ')}` 
        });
      }
      
      const { rows: validColumns } = await core.pool.query(
        `SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = $1 
          AND column_name = ANY($2)`,
        [tableName, columnNames]
      );
      
      if (validColumns.length !== columnNames.length) {
        return res.status(400).json({ error: 'Invalid column name(s)' });
      }
      
      const values = Object.values(data);
      const placeholders = columnNames.map((_, idx) => `$${idx + 1}`).join(', ');
      const quotedColumns = columnNames.map(col => `"${col}"`).join(', ');
      
      const { rows } = await core.pool.query(
        `INSERT INTO ${tableName} (${quotedColumns}) 
        VALUES (${placeholders}) 
        RETURNING *`,
        values
      );
      
      const sanitizedRow = sanitizeResponse(tableName, rows[0]);
      
      await core.logAudit((req as any).user, 'insert_row', { 
        table: tableName, 
        columns: columnNames 
      }, req);
      
      res.json(sanitizedRow);
    } catch (error: any) {
      console.error('[insert-row] Error:', error);
      res.status(500).json({ error: 'Failed to insert row' });
    }
  });

  router.delete('/tables/:tableName/row/:id', core.csrfProtection, core.authenticate, async (req, res) => {
    const { tableName, id } = req.params;
    
    if (tableName === 'admin_users') {
      return res.status(403).json({ 
        error: 'Cannot delete admin_users directly.' 
      });
    }

    try {
      if (!await validateTableName(core.pool, tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }
      
      const pkColumn = await getPrimaryKey(core.pool, tableName);
      
      const { rowCount } = await core.pool.query(
        `DELETE FROM ${tableName} WHERE "${pkColumn}" = $1`,
        [id]
      );
      
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Row not found' });
      }
      
      await core.logAudit((req as any).user, 'delete_row', { 
        table: tableName, 
        id 
      }, req);
      
      res.json({ success: true });
    } catch (error: any) {
      console.error('[delete-row] Error:', error);
      res.status(500).json({ error: 'Failed to delete row' });
    }
  });
  
  return router;
}