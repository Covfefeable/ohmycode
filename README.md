# OhMyCode

OhMyCode is a desktop-first code-agent workspace built with Electron, React, Flask,
PostgreSQL, and Redis. This repository currently contains the runnable foundation;
agent execution, model adapters, and streaming task events are intentionally left as
the next product layer.

## Workspace

```text
api/       Flask API, persistence, and integrations
client/    Electron main/preload processes and React renderer
docker/    Full and dependency-only Compose stacks
docs/      Architecture notes
```

## Prerequisites

- Python 3.12 and `uv`
- Node.js 22 and pnpm
- Docker Desktop with WSL integration (when developing from WSL)

## Development

Create local environment files:

```bash
cp docker/.env.example docker/.env
cp api/.env.example api/.env
cp client/.env.example client/.env
```

Start PostgreSQL and Redis:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.dev.yml up -d
```

Prepare the API:

```bash
cd api
uv sync
uv run flask --app manage:app db upgrade
```

After pulling backend dependency changes, stop the running Flask process before `uv sync`
on Windows because executable launchers inside `.venv/Scripts` may otherwise be locked.

Authentication endpoints are available under `/api/auth`: register, login, current user,
and refresh. The Electron main process stores tokens with the operating system's secure
storage API; tokens are not exposed to the renderer or browser storage.

The `.venv` directory is operating-system specific. If dependencies were previously
installed from WSL and the API is now being run from Windows PowerShell (or vice versa),
recreate it in the current environment with `uv venv --clear .venv` followed by
`uv sync`.

Run the desktop client (it starts and stops the Flask API automatically):

```bash
cd client
pnpm install
pnpm dev
```

The client configures a dedicated Electron binary mirror in `client/.npmrc` for
networks that cannot reach GitHub releases directly.

To run all server-side services in containers:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml up --build
```

The full stack binds the API only to `127.0.0.1`; PostgreSQL and Redis remain internal.

## Checks

```bash
cd api && uv run ruff check . && uv run pytest
cd client && pnpm typecheck && pnpm build
docker compose --env-file docker/.env.example -f docker/docker-compose.yml config
docker compose --env-file docker/.env.example -f docker/docker-compose.dev.yml config
```
