#!/bin/sh
set -e

# Read secrets from files
export POSTGRES_DB=$(cat /run/secrets/postgres_db)
export POSTGRES_USER=$(cat /run/secrets/postgres_user)
export POSTGRES_PASSWORD=$(cat /run/secrets/postgres_password)

# Execute the original entrypoint
exec docker-entrypoint.sh "$@"