#!/usr/bin/env bash
set -euo pipefail
: "${APP:?}" "${SANDBOX_SITE:?}" "${BACKUP_DIR:?}" "${BENCH_DIR:?}"
cd "/home/frappe/$BENCH_DIR"

DB_GZ="$(ls "$BACKUP_DIR"/*-database.sql.gz | head -1)"
PUB="$(ls "$BACKUP_DIR"/*-files.tar 2>/dev/null | head -1 || true)"
PRIV="$(ls "$BACKUP_DIR"/*-private-files.tar 2>/dev/null | head -1 || true)"

if [ ! -d "sites/$SANDBOX_SITE" ]; then
  bench new-site "$SANDBOX_SITE" --no-mariadb-socket --db-host mariadb \
    --mariadb-root-password root --admin-password admin
fi

RESTORE=(--force restore "$DB_GZ" --mariadb-root-password root)
[ -n "$PUB" ]  && RESTORE+=(--with-public-files "$PUB")
[ -n "$PRIV" ] && RESTORE+=(--with-private-files "$PRIV")
bench --site "$SANDBOX_SITE" "${RESTORE[@]}"

bench --site "$SANDBOX_SITE" list-apps | grep -qx "$APP" || \
  bench --site "$SANDBOX_SITE" install-app "$APP"
bench --site "$SANDBOX_SITE" migrate

# Non-skippable anonymization
bench --site "$SANDBOX_SITE" execute "$APP.utils.anonymize.run"
echo "SEED_PROD_OK site=$SANDBOX_SITE"
