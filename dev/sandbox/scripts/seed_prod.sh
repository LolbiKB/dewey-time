#!/usr/bin/env bash
set -euo pipefail
: "${APP:?}" "${SANDBOX_SITE:?}" "${BACKUP_DIR:?}" "${BENCH_DIR:?}"
ANONYMIZE_METHOD="${ANONYMIZE_METHOD:-$APP.utils.anonymize.run}"
DB_HOST="${DB_HOST:-mariadb}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-root}"
cd "/home/frappe/$BENCH_DIR"

DB_GZ="$(ls "$BACKUP_DIR"/*-database.sql.gz 2>/dev/null | head -1 || true)"
if [ -z "$DB_GZ" ]; then
  echo "ERROR: no *-database.sql.gz found in $BACKUP_DIR" >&2
  exit 1
fi
PUB="$(ls "$BACKUP_DIR"/*-files.tar 2>/dev/null | grep -v -- '-private-files.tar' | head -1 || true)"
PRIV="$(ls "$BACKUP_DIR"/*-private-files.tar 2>/dev/null | head -1 || true)"

if [ ! -d "sites/$SANDBOX_SITE" ]; then
  bench new-site "$SANDBOX_SITE" --no-mariadb-socket --db-host "$DB_HOST" \
    --mariadb-root-password "$DB_ROOT_PASSWORD" --admin-password admin
fi

# ---------------------------------------------------------------------------
# PII safety. Once a prod backup is restored, this script MUST NOT exit leaving
# un-anonymized data resting in the DB. The EXIT trap guarantees anonymize-or-
# destroy for ANY failure after restore (prune crash, bootstrap crash, anonymize
# error, a cross-version migrate blow-up, an interrupt) — the non-skippable rule
# made truly non-skippable.
# ---------------------------------------------------------------------------
RESTORED=0
ANONYMIZED=0
DBNAME=""
_resolve_dbname() {
  # Resolve the site's DB name from site_config.json; never fails the script.
  python3 -c "import json;print(json.load(open('sites/$SANDBOX_SITE/site_config.json'))['db_name'])" 2>/dev/null || true
}
pii_safety() {
  rc=$?
  trap - EXIT INT TERM HUP   # disarm first, so a signal during cleanup can't re-enter
  if [ "$RESTORED" = "1" ] && [ "$ANONYMIZED" != "1" ]; then
    echo "PII-SAFETY: restore completed but anonymize did not — enforcing now." >&2
    if bench --site "$SANDBOX_SITE" execute "$ANONYMIZE_METHOD" >&2; then
      echo "PII-SAFETY: anonymize succeeded in trap." >&2
    else
      # Last resort: destroy the DB so un-anonymized prod data cannot rest. Resolve
      # the name freshly (DBNAME may be unset if we died before it was assigned).
      db="${DBNAME:-$(_resolve_dbname)}"
      echo "PII-SAFETY: anonymize failed — DROPPING DB '${db:-<unknown>}' to prevent resting prod PII." >&2
      if [ -n "$db" ] && mysql -h "$DB_HOST" -uroot -p"$DB_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS \`$db\`"; then
        echo "PII-SAFETY: DB dropped." >&2
      else
        echo "PII-SAFETY: FATAL — could neither anonymize NOR drop; un-anonymized prod data may" >&2
        echo "            rest in site '$SANDBOX_SITE'. Investigate immediately." >&2
        rc=1
      fi
    fi
  fi
  exit "$rc"
}
# EXIT covers normal/errexit; INT/TERM/HUP cover Ctrl-C and `docker stop`. SIGKILL
# is undefendable — but the next seed's `restore --force` overwrites any remnant.
trap pii_safety EXIT INT TERM HUP

# --- restore prod data ---
RESTORE=(--force restore "$DB_GZ" --mariadb-root-password "$DB_ROOT_PASSWORD")
[ -n "$PUB" ]  && RESTORE+=(--with-public-files "$PUB")
[ -n "$PRIV" ] && RESTORE+=(--with-private-files "$PRIV")
bench --site "$SANDBOX_SITE" "${RESTORE[@]}"
RESTORED=1
DBNAME="$(_resolve_dbname)"

# --- prune apps the backup lists but this bench lacks (else migrate/init crash
#     importing their hooks); also warns on bench-vs-backup major-version drift ---
DB_HOST="$DB_HOST" DB_ROOT_PASSWORD="$DB_ROOT_PASSWORD" \
  env/bin/python /workspace/repo/dev/sandbox/scripts/prune_foreign_apps.py "$SANDBOX_SITE"

# --- ensure the app under test is installed (list-apps is safe post-prune) ---
bench --site "$SANDBOX_SITE" list-apps | grep -qx "$APP" || \
  bench --site "$SANDBOX_SITE" install-app "$APP"

# --- ANONYMIZE first, before any fragile step. It is raw, column-tolerant SQL
#     (no doc-save hooks), so it survives cross-version skew that later doc-saving
#     steps may not. Non-skippable; the EXIT trap above is the backstop. ---
bench --site "$SANDBOX_SITE" execute "$ANONYMIZE_METHOD"
ANONYMIZED=1

# --- app bootstrap (best-effort): ensure custom fields / masters / config. On a
#     cross-major-version restore, doc-save hooks from the older bench code can hit
#     doctypes the newer data dropped (e.g. Energy Point Settings) — non-fatal here,
#     since anonymize already ran and a real restore already carries the columns. ---
BOOTSTRAP=skipped
if [ -n "${BOOTSTRAP_METHOD:-}" ]; then
  if bench --site "$SANDBOX_SITE" execute "$BOOTSTRAP_METHOD"; then
    BOOTSTRAP=ok
  else
    BOOTSTRAP=failed
    echo "WARN: bootstrap ($BOOTSTRAP_METHOD) failed — continuing (anonymize already done)." >&2
  fi
fi

# --- migrate is best-effort: the seed's contract (restored + anonymized) is now
#     met. A cross-major-version backup may legitimately fail to migrate on this
#     bench; surface it rather than aborting (and discarding the anonymized data). ---
MIGRATE=ok
if ! bench --site "$SANDBOX_SITE" migrate; then
  MIGRATE=failed
  echo "WARN: migrate failed — data is restored+anonymized; continuing. (Often a" >&2
  echo "      bench-vs-backup major-version mismatch; provision the bench to match prod.)" >&2
fi

echo "SEED_PROD_OK site=$SANDBOX_SITE anonymized=1 bootstrap=$BOOTSTRAP migrate=$MIGRATE"
