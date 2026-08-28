# Project backlog

This file records current engineering work, not completed issue history. Keep
items outcome-oriented and remove or move them to release notes after delivery.

## P0 — release blockers

- [ ] Configure HTTPS for the production API and remove the default plain-HTTP
  production endpoint from release builds.
- [ ] Add Windows code signing and macOS Developer ID signing/notarization to
  the release process.
- [ ] Define backup, restore, and migration rollback procedures for PostgreSQL,
  MinIO, and the local Runtime SQLite journal.
- [ ] Add a release security gate covering secret validation, dependency/image
  scanning, and verification that credentials cannot reach Renderer logs or
  packaged artifacts.

## P1 — runtime safety and resilience

- [ ] Queue high-risk file patches for diff review and explicit approval before
  applying them. Preserve the existing inspect-before-write and workspace-lock
  invariants.
- [ ] Move long-running model execution behind durable coordination with leases,
  idempotent resume, cancellation, and retry ownership independent of one Flask
  request/process.
- [ ] Add end-to-end recovery tests for SSE disconnect, Electron restart,
  duplicate tool results, terminal cleanup, and stop-versus-complete races.
- [ ] Define retention and cleanup policies for Agent events, full tool results,
  context checkpoints, local journals, and abandoned Celery jobs.

## P1 — quality coverage

- [ ] Add automated Desktop/API happy-path coverage from authentication through
  streaming response, tool execution, persistence, and replay.
- [ ] Add Mobile/API coverage for streaming, task plans, synchronized Skills,
  HTTP MCP loading, result pagination, and unsupported-capability filtering.
- [ ] Exercise database migrations against both an empty database and a snapshot
  of the previous release in CI.
- [ ] Add Compose health/startup tests for API, worker, beat, PostgreSQL, Redis,
  MinIO, and Nginx SSE proxy behavior.

## P2 — maintainability and product readiness

- [ ] Add observability for Turn latency, provider failures, recovery attempts,
  queue depth, embedding freshness, and storage health without logging secrets.
- [ ] Document supported OpenAI-compatible provider differences and test a small
  compatibility matrix for reasoning fields, tool calls, token usage, and SSE
  termination.
- [ ] Establish performance budgets for long conversations, event replay, large
  tool results, capability retrieval, and mobile rendering.

## Recently completed

- [x] Shared plugin-based tool registry for Desktop and Mobile.
- [x] Mobile streaming UI, Markdown rendering, task activity, synchronized
  Skills, and HTTP MCP support.
- [x] Complete tool-result persistence with bounded read/search access.
- [x] Desktop terminal spawn regression and invalid model-key handling fixes.
- [x] Runtime-owned tool schemas with per-Run snapshots; Flask no longer defines
  static Desktop/Mobile tools or reconstructs MCP capability state.
