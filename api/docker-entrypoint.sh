#!/bin/sh
set -eu

uv run --no-sync flask --app manage:app db upgrade

exec uv run --no-sync gunicorn \
  --bind "0.0.0.0:8765" \
  --workers "${SERVER_WORKER_AMOUNT:-1}" \
  --worker-class "${SERVER_WORKER_CLASS:-gevent}" \
  --worker-connections "${SERVER_WORKER_CONNECTIONS:-10}" \
  --timeout "${GUNICORN_TIMEOUT:-360}" \
  --keep-alive "${GUNICORN_KEEP_ALIVE:-75}" \
  wsgi:app
