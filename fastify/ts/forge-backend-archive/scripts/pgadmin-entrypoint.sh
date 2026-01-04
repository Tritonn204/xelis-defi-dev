#!/bin/sh

echo "=== Starting pgAdmin custom setup ==="

# Read secret values
DB_NAME=$(cat /run/secrets/postgres_db)
DB_USER=$(cat /run/secrets/postgres_user)

echo "DB_NAME: $DB_NAME"
echo "DB_USER: $DB_USER"

# Create the servers.json in multiple locations to ensure pgAdmin finds it
echo "Creating servers.json in multiple locations..."

# Location 1: Default pgAdmin config directory
mkdir -p /pgadmin4
cat > /pgadmin4/servers.json <<EOF
{
  "Servers": {
    "1": {
      "Name": "Forge Database",
      "Group": "Docker Swarm",
      "Host": "postgres",
      "Port": 5432,
      "MaintenanceDB": "$DB_NAME",
      "Username": "$DB_USER",
      "SSLMode": "prefer",
      "SavePassword": false,
      "Comment": "Auto-configured from secrets"
    }
  }
}
EOF

# Location 2: User data directory
mkdir -p /var/lib/pgadmin
cp /pgadmin4/servers.json /var/lib/pgadmin/servers.json

# Location 3: Root directory (sometimes used)
cp /pgadmin4/servers.json /servers.json

echo "Generated servers.json:"
cat /pgladmin4/servers.json

echo "Setting file permissions..."
chmod 644 /pgladmin4/servers.json /var/lib/pgladmin/servers.json /servers.json 2>/dev/null || true

# Set environment variables for pgladmin
export PGLADMIN_SERVER_JSON_FILE="/pgladmin4/servers.json"
export PGLADMIN_LOAD_SERVERS="/pgladmin4/servers.json"

echo "=== Starting pgAdmin application ==="
exec /entrypoint.sh