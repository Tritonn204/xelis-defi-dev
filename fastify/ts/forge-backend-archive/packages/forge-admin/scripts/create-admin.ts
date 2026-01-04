import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { fromEnvOrFile } from '@forge-backend/shared/utils/env';

const DATABASE_URL = fromEnvOrFile('DATABASE_URL');
if (!DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.log('Usage: pnpm create-admin <email> <password>');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const hash = await bcrypt.hash(password, 10);

await pool.query(
  `INSERT INTO admin_users (email, password_hash)
   VALUES ($1, $2)
   ON CONFLICT (email) DO UPDATE
   SET password_hash = EXCLUDED.password_hash`,
  [email.toLowerCase(), hash]
);

console.log(`✓ Admin user created: ${email}`);
await pool.end();