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

cd /app
exec "$@"