import { Router, Request, Response } from 'express';
import { CoreServices } from '../factory/core';

export interface DashboardRouteDeps {
  core: CoreServices,
}

export function buildDashboardDeps(core: CoreServices): DashboardRouteDeps {
  return {
    core,
  };
}

export function createDashboardRoutes(deps: DashboardRouteDeps): Router {
  const router = Router();
  const { core } = deps;
  
  // Dashboard metrics
  router.get('/dashboard/metrics', core.authenticate, async (req, res) => {
    try {
      const metrics = await core.getCached('admin:metrics', async () => {
        const todayMs = Math.floor(Date.now() / 86400000) * 86400000;

        const [todayStats, totals, dbSize] = await Promise.all([
          core.pool.query(
            `SELECT 
               COUNT(*)::int as swap_count,
               COALESCE(SUM(base_in), 0)::float as volume,
               COUNT(DISTINCT pair_id)::int as active_pairs
             FROM swaps
             WHERE ts_ms >= $1`,
            [todayMs]
          ),
          core.pool.query(
            `SELECT 
               (SELECT COUNT(*) FROM swaps)::int as total_swaps,
               (SELECT COUNT(*) FROM pairs)::int as total_pairs,
               (SELECT COUNT(*) FROM assets)::int as total_assets`
          ),
          core.pool.query(
            `SELECT pg_size_pretty(pg_database_size(current_database())) as db_size`
          ),
        ]);

        return {
          swaps_today: todayStats.rows[0].swap_count,
          volume_today: todayStats.rows[0].volume,
          active_pairs_today: todayStats.rows[0].active_pairs,
          total_swaps: totals.rows[0].total_swaps,
          total_pairs: totals.rows[0].total_pairs,
          total_assets: totals.rows[0].total_assets,
          db_size: dbSize.rows[0].db_size,
        };
      });

      res.json(metrics);
    } catch (error) {
      console.error('[metrics] Error:', error);
      res.status(500).json({ error: 'Failed to fetch metrics' });
    }
  });

  // Recent swaps
  router.get('/dashboard/recent-swaps', core.authenticate, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      
      const swaps = await core.getCached(`admin:swaps:${limit}`, async () => {
        const { rows } = await core.pool.query(
          `SELECT 
             s.id, s.ts_ms, p.symbol, s.side, s.price, s.base_in, s.quote_out
           FROM swaps s
           JOIN pairs p ON p.id = s.pair_id
           ORDER BY s.ts_ms DESC
           LIMIT $1`,
          [limit]
        );
        return rows;
      }, 5 * 60); // 5 min cache

      res.json(swaps);
    } catch (error) {
      console.error('[swaps] Error:', error);
      res.status(500).json({ error: 'Failed to fetch swaps' });
    }
  });

  // Audit log
  router.get('/dashboard/audit-log', core.authenticate, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      
      const { rows } = await core.pool.query(
        `SELECT 
           id, user_email, action, target_table, target_id,
           details, success, error_message, created_at
         FROM admin_audit_log
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );

      res.json(rows);
    } catch (error) {
      console.error('[audit-log] Error:', error);
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  });

  // Table stats
  router.get('/dashboard/table-stats', core.authenticate, async (req, res) => {
    try {
      const stats = await core.getCached('admin:table-stats', async () => {
        const { rows } = await core.pool.query(
          `SELECT 
             tablename,
             pg_size_pretty(pg_total_relation_size('public.' || tablename)) as size,
             n_live_tup as row_count,
             n_dead_tup as dead_rows
           FROM pg_stat_user_tables
           WHERE schemaname = 'public'
           ORDER BY pg_total_relation_size('public.' || tablename) DESC
           LIMIT 20`
        );
        return rows;
      });

      res.json(stats);
    } catch (error) {
      console.error('[table-stats] Error:', error);
      res.status(500).json({ error: 'Failed to fetch table stats' });
    }
  });

  // Force cache refresh
  router.post('/dashboard/refresh-cache', core.csrfProtection, core.authenticate, async (req, res) => {
    try {
      await core.invalidateCache('admin:*');
      await core.logAudit((req as any).user, 'refresh_cache', {}, req);
      res.json({ success: true, message: 'Cache cleared' });
    } catch (error) {
      console.error('[refresh-cache] Error:', error);
      res.status(500).json({ error: 'Failed to refresh cache' });
    }
  });

  return router;
}