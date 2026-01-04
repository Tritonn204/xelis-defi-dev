import { Router } from 'express';
import type { CoreServices } from '../factory/core';
import { sanitizeResponse} from '../services/sanitization';
import { validateMacroSQL, isWriteQuery, executeBatched } from '../services/sql';

export interface MacrosRouteDeps {
  core: CoreServices;
}

export function buildMacrosDeps(core: CoreServices): MacrosRouteDeps {
  return {
    core,
  };
}

export function createMacrosRoutes(deps: MacrosRouteDeps): Router {
  const router = Router();
  const { core } = deps;
  router.post('/macros', core.csrfProtection, core.authenticate, async (req, res) => {
    const { name, description, sql, parameters, category } = req.body;
    
    // Validate SQL
    const validation = await validateMacroSQL(core.pool, sql);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const { rows } = await core.pool.query(
      `INSERT INTO query_macros (name, description, sql, parameters, category, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [name, description, sql, JSON.stringify(parameters || []), category, (req as any).user.id]
    );

    await core.logAudit((req as any).user, 'create_macro', { macro_id: rows[0].id, name }, req);
    res.json(rows[0]);
  });

  // List all macros
  router.get('/macros', core.csrfProtection, core.authenticate, async (req, res) => {
    try {
      const { rows } = await core.pool.query(
        `SELECT 
          m.id, m.name, m.description, m.sql, m.parameters, 
          m.category, m.requires_confirmation, m.created_at,
          u.email as created_by_email, u.full_name as created_by_name
        FROM query_macros m
        LEFT JOIN admin_users u ON u.id = m.created_by
        ORDER BY m.created_at DESC`
      );
      res.json(rows);
    } catch (error) {
      console.error('[list-macros] Error:', error);
      res.status(500).json({ error: 'Failed to fetch macros' });
    }
  });

  // Get single macro
  router.get('/macros/:id', core.csrfProtection, core.authenticate, async (req, res) => {
    try {
      const { rows } = await core.pool.query(
        `SELECT 
          m.*,
          u.email as created_by_email,
          u.full_name as created_by_name
        FROM query_macros m
        LEFT JOIN admin_users u ON u.id = m.created_by
        WHERE m.id = $1`,
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'Macro not found' });
      }

      res.json(rows[0]);
    } catch (error) {
      console.error('[get-macro] Error:', error);
      res.status(500).json({ error: 'Failed to fetch macro' });
    }
  });

  // Delete macro
  router.delete('/macros/:id', core.csrfProtection, core.authenticate, async (req, res) => {
    try {
      const { rows } = await core.pool.query(
        'DELETE FROM query_macros WHERE id = $1 RETURNING name',
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'Macro not found' });
      }

      await core.logAudit((req as any).user, 'delete_macro', { macro_id: req.params.id, name: rows[0].name }, req);
      res.json({ success: true });
    } catch (error) {
      console.error('[delete-macro] Error:', error);
      res.status(500).json({ error: 'Failed to delete macro' });
    }
  });

  // Get execution history for a macro
  router.get('/macros/:id/executions', core.authenticate, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      
      const { rows } = await core.pool.query(
        `SELECT 
          me.*,
          u.email as executed_by_email,
          u.full_name as executed_by_name
        FROM macro_executions me
        LEFT JOIN admin_users u ON u.id = me.executed_by
        WHERE me.macro_id = $1
        ORDER BY me.executed_at DESC
        LIMIT $2`,
        [req.params.id, limit]
      );

      res.json(rows);
    } catch (error) {
      console.error('[macro-executions] Error:', error);
      res.status(500).json({ error: 'Failed to fetch execution history' });
    }
  });

  router.post('/macros/:id/execute', core.csrfProtection, core.authenticate, async (req, res) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { parameters, batchSize = 1000, dryRun = false } = req.body;
    
    const startTime = Date.now();

    try {
      const { rows: [macro] } = await core.pool.query(
        'SELECT * FROM query_macros WHERE id = $1',
        [id]
      );

      if (!macro) {
        return res.status(404).json({ error: 'Macro not found' });
      }

      const validation = await validateMacroSQL(core.pool, macro.sql);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      
      if (dryRun) {
        return res.json({
          estimatedRows: validation.estimatedRows,
          requiresBatching: validation.requiresBatching,
          recommendedBatchSize: Math.min(batchSize, 5000),
        });
      }

      if (validation.requiresBatching && isWriteQuery(macro.sql)) {
        const result = await executeBatched(core.pool, macro.sql, parameters, batchSize);
        return res.json(result);
      }

      const result = await core.pool.query(macro.sql, parameters || []);
      const rowsAffected = result.rowCount || 0;

      const tableNameMatch = macro.sql.match(/FROM\s+(\w+)/i);
      const resultTableName = tableNameMatch ? tableNameMatch[1] : null;
      const sanitizedRows = resultTableName ? sanitizeResponse(resultTableName, result.rows) : result.rows;

      await core.pool.query(
        `INSERT INTO macro_executions 
        (macro_id, executed_by, parameters, rows_affected, execution_time_ms, success)
        VALUES ($1, $2, $3, $4, $5, true)`,
        [id, user.id, JSON.stringify(parameters), rowsAffected, Date.now() - startTime]
      );

      await core.logAudit(user, 'execute_macro', {
        macro_id: req.params.id,
        macro_name: macro.name,
        rows_affected: result.rowCount,
        batch_size: batchSize,
        has_parameters: !!parameters && parameters.length > 0
      }, req);

      res.json({ 
        success: true, 
        rowsAffected,
        data: sanitizedRows,
        executionTimeMs: Date.now() - startTime
      });

    } catch (err: any) {
      const executionTime = Date.now() - startTime;
      
      await core.pool.query(
        `INSERT INTO macro_executions 
        (macro_id, executed_by, parameters, execution_time_ms, success, error_message)
        VALUES ($1, $2, $3, $4, false, $5)`,
        [id, user.id, JSON.stringify(parameters), executionTime, err.message]
      );

      await core.logAudit(user, 'execute_macro_failed', {
        macro_id: req.params.id,
        error: err.message.substring(0, 200)
      }, req);

      res.status(500).json({ error: 'Macro execution failed', details: err.message });
    }
  });

  return router;
}