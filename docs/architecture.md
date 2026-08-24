# Architecture

## Process boundary

The Electron main process owns the local Flask sidecar. The renderer is sandboxed and
can only invoke a small, typed preload API. It never receives Node.js, filesystem, or
process execution access directly.

```text
React renderer -> typed IPC -> Electron main -> Flask HTTP API
                                            -> PostgreSQL
                                            -> Redis
```

PostgreSQL stores durable sessions and task metadata. Redis is reserved for ephemeral
coordination, cancellation flags, event fan-out, and future workers. Long-running agent
work should live behind a dedicated execution service rather than inside HTTP routes.

## Environment boundary

Host processes connect to `localhost`. Containers connect to Compose service names
(`postgres` and `redis`). Electron itself is not containerized.

## Next implementation layer

1. Define task, message, tool-call, and file-change models and migrations.
2. Add a model-provider adapter with secrets stored outside the renderer.
3. Add an isolated command runner with explicit workspace boundaries.
4. Stream structured task events to the client and support cancellation.
5. Add diff review and approval before applying high-risk changes.

