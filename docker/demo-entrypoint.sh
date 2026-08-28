#!/bin/sh
# Boot MariaDB, prepare the schema + demo data, then start the app.
# Designed for throwaway demo hosting (e.g. Render free tier). Not for production.
set -e

DATADIR=/var/lib/mysql
SOCK=/run/mysqld/mysqld.sock
DB_PASSWORD="${DB_PASSWORD:-demo}"
DB_NAME="${DB_NAME:-muscle_fitness}"

mkdir -p /run/mysqld
chown -R mysql:mysql /run/mysqld "$DATADIR"

# The Debian mariadb-server package already initializes the data directory
# during image build; only initialize if it is genuinely empty (e.g. a mounted
# empty volume).
if [ ! -d "$DATADIR/mysql" ]; then
  echo "[demo] initializing MariaDB data directory..."
  mariadb-install-db --user=mysql --datadir="$DATADIR" \
    --auth-root-authentication-method=normal --skip-test-db >/dev/null
fi

echo "[demo] starting MariaDB..."
mysqld_safe --datadir="$DATADIR" \
  --socket="$SOCK" \
  --bind-address=127.0.0.1 \
  --innodb-buffer-pool-size=48M \
  --innodb-log-buffer-size=8M \
  --key-buffer-size=8M \
  --max-connections=25 \
  --performance-schema=0 \
  --skip-name-resolve &

echo "[demo] waiting for MariaDB socket..."
for i in $(seq 1 90); do
  if mysqladmin --socket="$SOCK" ping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Connect as root over the local socket. Fresh package init = unix_socket / empty
# password; a persisted datadir from a previous boot = password already set.
if mysql --socket="$SOCK" -u root -e "SELECT 1" >/dev/null 2>&1; then
  ROOT="mysql --socket=$SOCK -u root"
elif mysql --socket="$SOCK" -u root -p"$DB_PASSWORD" -e "SELECT 1" >/dev/null 2>&1; then
  ROOT="mysql --socket=$SOCK -u root -p$DB_PASSWORD"
else
  echo "[demo] ERROR: cannot open a root session on the MariaDB socket" >&2
  exit 1
fi

echo "[demo] ensuring database + TCP root access (idempotent)..."
$ROOT <<SQL
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER 'root'@'%' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER 'root'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
FLUSH PRIVILEGES;
SQL

echo "[demo] verifying TCP connection..."
if ! mysql -h 127.0.0.1 -u root -p"$DB_PASSWORD" -e "SELECT 1" >/dev/null 2>&1; then
  echo "[demo] ERROR: root cannot connect to MariaDB over 127.0.0.1" >&2
  exit 1
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
