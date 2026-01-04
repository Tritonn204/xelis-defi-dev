import { fromEnvOrFile } from '@forge-backend/shared/utils/env';

export interface Config {
  // Server
  PORT: number;
  NODE_ENV: string;

  BASE_URL: string;
  
  // Database
  DATABASE_URL: string;
  
  // Security
  JWT_SECRET: string;
  CSRF_SECURE_COOKIE: boolean;
  STRICT_IP_CHECK: boolean;
  ADMIN_ALLOWED_IPS: string[];
  
  // Admin
  PRIMARY_MAINTAINER_EMAIL: string;
  
  // Cache
  CACHE_TTL: number;
}

export function loadConfig(): Config {
  const adminAllowedIPs = fromEnvOrFile('ADMIN_ALLOWED_IPS')
    ?.split(',')
    .map(ip => ip.trim())
    .filter(Boolean) || [];

  return {
    PORT: parseInt(process.env.PORT || '3001'),
    NODE_ENV: process.env.NODE_ENV || 'development',
    BASE_URL: process.env.NODE_ENV === 'production'
      ? 'https://forge-admin.neptuun.xyz'
      : 'http://localhost:5173',
    DATABASE_URL: fromEnvOrFile('DATABASE_URL') || '',
    JWT_SECRET: fromEnvOrFile('JWT_SECRET') || 'change-me-in-production',
    CSRF_SECURE_COOKIE: fromEnvOrFile('CSRF_SECURE_COOKIE') === 'true',
    STRICT_IP_CHECK: fromEnvOrFile('STRICT_IP_CHECK') === 'true',
    ADMIN_ALLOWED_IPS: adminAllowedIPs,
    PRIMARY_MAINTAINER_EMAIL: fromEnvOrFile('PRIMARY_MAINTAINER_EMAIL') || 
                              fromEnvOrFile('admin_email') || '',
    CACHE_TTL: 30 * 60, // 30 minutes
  };
}