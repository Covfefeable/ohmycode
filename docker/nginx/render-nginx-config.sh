#!/bin/sh
set -eu

CLIENT_MAX_BODY_SIZE="${CLIENT_MAX_BODY_SIZE:-20m}"
PROXY_TIMEOUT="${PROXY_TIMEOUT:-3600s}"
SSL_CERT_FILE="${SSL_CERT_FILE:-server.crt}"
SSL_KEY_FILE="${SSL_KEY_FILE:-server.key}"
export CLIENT_MAX_BODY_SIZE PROXY_TIMEOUT SSL_CERT_FILE SSL_KEY_FILE

template=/etc/nginx/templates/http.conf.template
if [ "${ENABLE_SSL:-false}" = "true" ]; then
  cert="/etc/nginx/ssl/${SSL_CERT_FILE}"
  key="/etc/nginx/ssl/${SSL_KEY_FILE}"
  if [ ! -f "$cert" ] || [ ! -f "$key" ]; then
    echo "TLS is enabled but certificate or key is missing: $cert, $key" >&2
    exit 1
  fi
  template=/etc/nginx/templates/https.conf.template
fi

envsubst '${CLIENT_MAX_BODY_SIZE} ${PROXY_TIMEOUT} ${SSL_CERT_FILE} ${SSL_KEY_FILE}' \
  < "$template" > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
