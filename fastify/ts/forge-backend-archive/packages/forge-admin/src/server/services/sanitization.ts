/**
 * Sensitive columns that should never be returned in API responses
 */
export const SENSITIVE_COLUMNS: Record<string, string[]> = {
  admin_users: ['password_hash', 'totp_secret', 'backup_codes', 'token_version'],
  admin_user_invites: ['token'],  // Don't leak invite tokens
  // Add other tables as needed
};

/**
 * Remove sensitive columns from a data row
 */
function sanitizeRow(tableName: string, row: any): any {
  if (!row || typeof row !== 'object') {
    return row;
  }

  const sensitiveColumns = SENSITIVE_COLUMNS[tableName] || [];
  if (sensitiveColumns.length === 0) {
    return row; // No sensitive columns, return as-is
  }

  const sanitized = { ...row };
  sensitiveColumns.forEach(column => {
    delete sanitized[column];
  });

  return sanitized;
}

/**
 * Sanitize response data (handles single row or array)
 */
export function sanitizeResponse(tableName: string, data: any): any {
  if (!data) return data;
  
  if (Array.isArray(data)) {
    return data.map(row => sanitizeRow(tableName, row));
  }

  return sanitizeRow(tableName, data);
}

/**
 * Sanitize audit log rows (special handling)
 */
export function sanitizeAuditRow(row: any): any {
  const sanitized = { ...row };
  
  // Audit logs may contain sensitive data in details
  if (sanitized.details && typeof sanitized.details === 'object') {
    // Remove any password-like fields from details
    const sensitiveKeys = ['password', 'token', 'secret', 'hash'];
    
    for (const key of Object.keys(sanitized.details)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized.details[key] = '[REDACTED]';
      }
    }
  }
  
  return sanitized;
}

/**
 * Check if a column is sensitive
 */
export function isSensitiveColumn(tableName: string, columnName: string): boolean {
  const sensitiveColumns = SENSITIVE_COLUMNS[tableName] || [];
  return sensitiveColumns.includes(columnName);
}

/**
 * Get list of safe columns for a table (excludes sensitive ones)
 */
export function getSafeColumns(tableName: string, allColumns: string[]): string[] {
  const sensitiveColumns = SENSITIVE_COLUMNS[tableName] || [];
  return allColumns.filter(col => !sensitiveColumns.includes(col));
}