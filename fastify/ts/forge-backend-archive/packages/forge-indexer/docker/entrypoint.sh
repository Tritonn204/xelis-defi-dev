#!/bin/sh
set -eu

# Map any VAR_FILE to VAR (read the file contents, strip CR/LF)
for var in $(env | awk -F= '/_FILE=/{print $1}'); do
  file="$(eval echo \$$var)"
  [ -n "$file" ] || continue
  if [ -f "$file" ]; then
    name="${var%_FILE}"
    export "$name"="$(tr -d '\r\n' < "$file")"
  fi
done

if [ -z "${NODE_RPC_URL:-}" ] && [ -n "${NODE_WS_URL:-}" ]; then
  export NODE_RPC_URL="$NODE_WS_URL"
fi

cd /app

echo "[entrypoint] role=${ROLE:-unset} service=${SERVICE_NAME:-unset} router=${ROUTER_CONTRACT:-unset}"

exec "$@"