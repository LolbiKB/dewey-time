#!/usr/bin/env bash
set -euo pipefail

# Env (passed by the CLI): APP, APP_SRC, REQUIRED_APPS, BRANCH, TEST_SITE,
# REGISTER_APPS_TXT, BENCH_DIR
: "${APP:?}" "${APP_SRC:?}" "${REQUIRED_APPS:?}" "${BRANCH:?}" "${TEST_SITE:?}" "${BENCH_DIR:?}"

# Frappe v15 needs Python <=3.12; the frappe/bench image's default `python` (pyenv)
# may be 3.14 (too new), and the system python3.11 lacks dev headers so C-extension
# builds (psutil) fail. Prefer a pyenv 3.12/3.11 (those ship headers). Override via PYTHON_BIN.
if [ -z "${PYTHON_BIN:-}" ]; then
  PYTHON_BIN="$(ls -d "$HOME"/.pyenv/versions/3.12.*/bin/python "$HOME"/.pyenv/versions/3.11.*/bin/python 2>/dev/null | head -1 || true)"
  PYTHON_BIN="${PYTHON_BIN:-$(command -v python3.12 || command -v python3.11 || command -v python3)}"
fi

cd /home/frappe

if [ ! -d "$BENCH_DIR" ]; then
  bench init --skip-redis-config-generation --skip-assets \
    --frappe-branch "$BRANCH" --python "$PYTHON_BIN" "$BENCH_DIR"
fi
cd "$BENCH_DIR"

bench set-config -g db_host mariadb
bench set-config -g redis_cache    "redis://redis-cache:6379"
bench set-config -g redis_queue    "redis://redis-queue:6379"
bench set-config -g redis_socketio "redis://redis-queue:6379"

for app in $REQUIRED_APPS; do
  [ -d "apps/$app" ] || bench get-app "$app" --branch "$BRANCH" --skip-assets
done
[ -d "apps/$APP" ] || bench get-app "$APP" "$APP_SRC" --skip-assets

if [ "${REGISTER_APPS_TXT:-1}" = "1" ]; then
  [ -s sites/apps.txt ] && [ -n "$(tail -c1 sites/apps.txt)" ] && echo >> sites/apps.txt
  grep -qxF "$APP" sites/apps.txt 2>/dev/null || echo "$APP" >> sites/apps.txt
fi

if [ ! -d "sites/$TEST_SITE" ]; then
  bench new-site "$TEST_SITE" --no-mariadb-socket --db-host mariadb \
    --mariadb-root-password root --admin-password admin
  bench --site "$TEST_SITE" install-app $REQUIRED_APPS "$APP"
fi
bench --site "$TEST_SITE" set-config allow_tests true
echo "PROVISION_OK site=$TEST_SITE apps=$REQUIRED_APPS $APP"
