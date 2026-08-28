#!/bin/sh
# Boot MariaDB, prepare the schema + demo data, then start the app.
# Designed for throwaway demo hosting (e.g. Render free tier). Not for production.
set -e

DATADIR=/var/lib/mysql
DB_PASSWORD="${DB_PASSWORD:-demo}"
DB_NAME="${DB_NAME:-muscle_fitness}"

mkdir -p /run/mysqld
chown -R mysql:mysql /run/mysqld "$DATADIR"

FRESH=0
if [ ! -d "$DATADIR/mysql" ]; then
  echo "[demo] initializing MariaDB data directory..."
  mariadb-install-db --user=mysql --datadir="$DATADIR" \
    --auth-root-authentication-method=normal --skip-test-db >/dev/null
  FRESH=1
fi

echo "[demo] starting MariaDB..."
mysqld_safe --datadir="$DATADIR" \
  --bind-address=127.0.0.1 \
  --innodb-buffer-pool-size=48M \
  --innodb-log-buffer-size=8M \
  --key-buffer-size=8M \
  --max-connections=25 \
  --performance-schema=0 \
  --skip-name-resolve &

echo "[demo] waiting for MariaDB..."
for i in $(seq 1 90); do
  if mysqladmin --socket=/run/mysqld/mysqld.sock ping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Pick a working root connection (fresh install = no password; later boots = password set).
if mysql --socket=/run/mysqld/mysqld.sock -u root -e "SELECT 1" >/dev/null 2>&1; then
  ROOT="mysql --socket=/run/mysqld/mysqld.sock -u root"
else
  ROOT="mysql --socket=/run/mysqld/mysqld.sock -u root -p${DB_PASSWORD}"
fi

if [ "$FRESH" = "1" ]; then
  echo "[demo] configuring database + root access..."
  $ROOT <<SQL
SET PASSWORD FOR 'root'@'localhost' = PASSWORD('${DB_PASSWORD}');
CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
FLUSH PRIVILEGES;
SQL
fi

echo "[demo] running migrations..."
node scripts/migrate.js up

echo "[demo] seeding base data..."
node src/db/seed.js || echo "[demo] base seed skipped"

echo "[demo] ensuring admin account..."
node scripts/ensure-admin.js || echo "[demo] ensure-admin skipped"

echo "[demo] seeding demo member + content..."
node scripts/demo-seed.js || echo "[demo] demo seed skipped"

echo "[demo] starting application on port ${PORT:-3000}..."
exec node src/server.js
