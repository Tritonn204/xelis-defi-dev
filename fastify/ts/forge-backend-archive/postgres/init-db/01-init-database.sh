#!/bin/sh
set -e

echo "Configuring pg_hba.conf for Docker Swarm..."

# Get database details
DB_NAME=$(cat /run/secrets/postgres_db)
DB_USER=$(cat /run/secrets/postgres_user)

# Add restrictive Swarm network rules
cat >> "$PGDATA/pg_hba.conf" <<EOF

# Docker Swarm network - restrictive access
host $DB_NAME $DB_USER 10.0.0.0/16 scram-sha-256

# Explicitly deny broader access
host all all 10.0.0.0/8 reject
EOF

# Reload configuration
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$DB_NAME" <<-EOSQL
    SELECT pg_reload_conf();
EOSQL

echo "PostgreSQL configured for secure Swarm access"

echo "Starting database initialization..."
echo "Database: $POSTGRES_DB"
echo "User: $POSTGRES_USER"

# List all databases
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    \l
EOSQL

# First, connect to the postgres database to ensure our target database exists
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    -- Create the database if it doesn't exist (this will error if it exists, which is fine)
    SELECT 'CREATE DATABASE $POSTGRES_DB' 
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$POSTGRES_DB')\gexec
EOSQL

# Now connect to our actual database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EOSQL

echo "Database initialization completed!"