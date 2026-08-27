# Docker operations

## Persistent data

Both Compose files use bind mounts under `docker/volumes/`:

- `volumes/postgres`
- `volumes/redis`
- `volumes/minio`

The directory is intentionally ignored by Git. Compose creates missing bind
mount directories when the stack starts. Back up these directories while the
corresponding containers are stopped.

## Reverse proxy and TLS

The production stack exposes only Nginx. It proxies `/api` to the internal API
container and disables proxy buffering for streaming responses.

Set `ENABLE_SSL=true`, place the configured certificate and private key under
`docker/nginx/ssl/`, and set `SSL_CERT_FILE` and `SSL_KEY_FILE`. Nginx fails fast
when TLS is enabled but either file is missing.

PostgreSQL, Redis, MinIO and the Flask API are not published by the production
Compose file.
