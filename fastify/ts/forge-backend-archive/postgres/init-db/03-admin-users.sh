#!/bin/sh
set -e

echo "DEBUG: Checking for admin secrets..."
ls -la /run/secrets/ || echo "No /run/secrets directory"

if [ -f /run/secrets/admin_email ] && [ -f /run/secrets/admin_password ]; then
    echo "DEBUG: Admin secrets found!"
    
    ADMIN_EMAIL=$(cat /run/secrets/admin_email | tr -d '\r\n')
    ADMIN_PASSWORD=$(cat /run/secrets/admin_password | tr -d '\r\n')
    ADMIN_NAME=$(cat /run/secrets/admin_name 2>/dev/null | tr -d '\r\n' || echo "System Administrator")
    
    echo "DEBUG: Admin email: $ADMIN_EMAIL"
    echo "DEBUG: Admin name: $ADMIN_NAME"
    
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        -- Create admin user
        INSERT INTO admin_users (email, password_hash, full_name, is_active, token_version)
        VALUES (
          '$ADMIN_EMAIL',
          crypt('$ADMIN_PASSWORD', gen_salt('bf', 10)),
          '$ADMIN_NAME',
          true,
          0
        ) ON CONFLICT (email) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          full_name = EXCLUDED.full_name;
        
        -- Create invite table if not exists
        CREATE TABLE IF NOT EXISTS admin_user_invites (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          invited_by INTEGER REFERENCES admin_users(id),
          invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ,
          consumed_by_ip TEXT,
          full_name TEXT,
          CONSTRAINT unique_pending_invite EXCLUDE USING btree (email WITH =) WHERE (consumed_at IS NULL)
        );
        
        CREATE INDEX IF NOT EXISTS idx_invites_token 
          ON admin_user_invites(token) 
          WHERE consumed_at IS NULL;
        
        CREATE INDEX IF NOT EXISTS idx_invites_expires 
          ON admin_user_invites(expires_at) 
          WHERE consumed_at IS NULL;
        
        -- Create super users table
        CREATE TABLE IF NOT EXISTS admin_super_users (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
          granted_by INTEGER NOT NULL REFERENCES admin_users(id),
          granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          notes TEXT,
          CONSTRAINT unique_super_user UNIQUE (user_id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_super_users_user_id ON admin_super_users(user_id);
        
        -- Grant super user to primary maintainer (self-granted during bootstrap)
        INSERT INTO admin_super_users (user_id, granted_by, notes)
        SELECT u.id, u.id, 'Bootstrap primary maintainer'
        FROM admin_users u
        WHERE u.email = '$ADMIN_EMAIL'
        ON CONFLICT (user_id) DO NOTHING;
        
        -- Log the initialization
        INSERT INTO admin_audit_log (user_email, action, details, success)
        VALUES ('$ADMIN_EMAIL', 'bootstrap_admin_created', '{"source": "docker_secret", "super_user": true}', true);
        
        SELECT 'Admin user ready: ' || email as message FROM admin_users WHERE email = '$ADMIN_EMAIL';
EOSQL

    echo "Admin user initialization complete"
else
    echo "ERROR: Admin secrets not found!"
fi