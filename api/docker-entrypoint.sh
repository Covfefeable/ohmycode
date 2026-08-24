#!/bin/sh
set -eu

uv run flask --app manage:app db upgrade

exec uv run gunicorn \
  --bind "0.0.0.0:${API_PORT:-8765}" \
  --workers "${SERVER_WORKER_AMOUNT:-1}" \
  --worker-class "${SERVER_WORKER_CLASS:-gevent}" \
  --worker-connections "${SERVER_WORKER_CONNECTIONS:-10}" \
  --timeout "${GUNICORN_TIMEOUT:-360}" \
  wsgi:app
