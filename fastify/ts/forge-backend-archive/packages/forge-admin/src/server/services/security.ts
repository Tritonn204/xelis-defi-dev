import { Pool } from "pg";

export async function checkSecurityAlerts(pool: Pool) {
  try {
    // Check for multiple failed logins from same IP
    const { rows: failedLogins } = await pool.query(
      `SELECT 
         ip_address,
         COUNT(*) as attempts,
         ARRAY_AGG(DISTINCT user_email) as emails_tried
       FROM admin_audit_log
       WHERE action IN ('failed_login_invalid_user', 'failed_login_invalid_password')
         AND created_at > NOW() - INTERVAL '1 hour'
       GROUP BY ip_address
       HAVING COUNT(*) > 5`
    );
    
    for (const row of failedLogins) {
      console.warn(`[SECURITY] Multiple failed logins from IP ${row.ip_address}: ${row.attempts} attempts`);
      // TODO: Send alert email/Slack/Discord
    }
    
    // Check for high threat scores
    const { rows: threats } = await pool.query(
      `SELECT DISTINCT ip_address, MAX(threat_score) as score, cf_country
       FROM admin_audit_log
       WHERE threat_score > 40
         AND created_at > NOW() - INTERVAL '1 hour'
       GROUP BY ip_address, cf_country`
    );
    
    for (const row of threats) {
      console.warn(`[SECURITY] High threat score ${row.score} from ${row.ip_address} (${row.cf_country})`);
      // TODO: Send alert
    }
    
  } catch (error) {
    console.error('[security-check] Error:', error);
  }
}