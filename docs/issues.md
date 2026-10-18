# Project backlog

This file records current engineering work, not completed issue history. Keep
items outcome-oriented and remove or move them to release notes after delivery.

## Planning status — 2026-10-18

The stop/recovery audit and expanded cross-process end-to-end test work are
deferred at the user's request, not completed or removed from the backlog.
The next product feature is pending selection; the items below remain tracked
but do not imply authorization to start implementation.

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
- [ ] Add end-to-end recovery tests for SSE disconnect, Electron restart,
  duplicate tool results, terminal cleanup, and stop-versus-complete races.
- [ ] Complete retention policy coverage for context checkpoints, local journals,
  and abandoned Celery jobs. Preserve the implemented 90-day minimum and
  summary/reference protection for eligible Agent events and stream histories.

## P1 — quality coverage

- [ ] Add automated Desktop/API happy-path coverage from authentication through
  streaming response, tool execution, persistence, and replay.
- [ ] Add Mobile/API coverage for streaming, task plans, synchronized Skills,
  HTTP MCP loading, result pagination, and unsupported-capability filtering.
- [ ] Exercise migrations against a snapshot of the previous release in CI;
  empty-database upgrades, schema drift checks, and PostgreSQL integration
  regression tests are already covered.
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

- [x] Background model requests with persistent execution records, leases,
  idempotent tool-result resume, cancellation, and SSE replay through Celery.
- [x] Backend coverage reports, PostgreSQL concurrency/migration regression,
  Runtime stream regression, renderer interaction tests, and cross-platform CI.
- [x] Summarized, unreferenced Agent event and model-stream history cleanup after
  at least 90 days, including references from pending model executions.

- [x] Shared plugin-based tool registry for Desktop and Mobile.
- [x] Mobile streaming UI, Markdown rendering, task activity, synchronized
  Skills, and HTTP MCP support.
- [x] Complete tool-result persistence with bounded read/search access.
- [x] Desktop terminal spawn regression and invalid model-key handling fixes.
- [x] Runtime-owned tool schemas with per-Run snapshots; Flask no longer defines
  static Desktop/Mobile tools or reconstructs MCP capability state.
