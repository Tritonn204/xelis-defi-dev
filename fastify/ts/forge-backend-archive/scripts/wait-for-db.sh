#!/bin/sh
set -e

# Read database secrets and construct URL
export DB_USER=$(cat /run/secrets/postgres_user)
export DB_PASS=$(cat /run/secrets/postgres_password)
export DB_NAME=$(cat /run/secrets/postgres_db)
export DB_HOST=${DATABASE_HOST:-postgres}
export DB_PORT=${DATABASE_PORT:-5432}
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# Wait for database using Node.js
echo "Waiting for database at ${DB_HOST}:${DB_PORT}..."
until node -e "const net=require('net');const c=net.connect({host:process.env.DB_HOST,port:process.env.DB_PORT},()=>{c.end();process.exit(0)});c.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),3000)" 2>/dev/null; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "Database is ready! DATABASE_URL configured."