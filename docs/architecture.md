# Architecture

This document describes the high-level architecture of OhMyCode at version 0.1.0.
It is a desktop-first Code Agent workspace with an Expo mobile companion. The
Electron desktop application owns local execution, the mobile application owns
only mobile-safe capabilities, and the Python Flask API runs independently.

## Table of contents

- [Process boundary](#process-boundary)
- [Data and control flow](#data-and-control-flow)
- [Thread / Turn / Item event model](#thread--turn--item-event-model)
- [Shared Agent Runtime](#shared-agent-runtime)
- [Electron desktop host](#electron-desktop-host)
- [Mobile host](#mobile-host)
- [Flask service boundaries](#flask-service-boundaries)
- [Agent Loop and context compression](#agent-loop-and-context-compression)
- [Local tools](#local-tools)
- [Multi-Agent collaboration](#multi-agent-collaboration)
- [Persistence model](#persistence-model)
- [Environment boundary](#environment-boundary)
- [Remaining work](#remaining-work)

## Process boundary

The Electron main process owns the local agent runtime and capabilities, while
connecting to a separately managed Flask API. The renderer is sandboxed and can only invoke a small, typed
preload API. It never receives Node.js, filesystem, or process execution access
directly.

```text
React renderer
     |
     v
typed preload IPC
     |
     v
Electron main (Agent Runtime + local tools)
     |                              |
     | HTTP + SSE                   v
     |                      PTY terminals
     v                      filesystem tools
Flask HTTP API
     |
     +--> PostgreSQL
     +--> Redis
     +--> MinIO
     +--> Celery Worker / Beat
     +--> OpenAI-compatible LLM
```

Key boundaries:

- React Renderer code must not execute OS commands or access Node APIs. Use the
  narrow IPC boundary registered under `desktop/electron/ipc/`.
- Local tools (terminal, file tools) stay behind the Runtime. Do not expose
  generic terminal or filesystem APIs to the Renderer.
- Secrets and model credentials live in the service or Electron main process and
  must never be exposed to the Renderer, logs, fixtures, or commits.

## Data and control flow

A normal chat turn flows like this:

1. The user sends a message in the React UI.
2. The Renderer calls `startTurn()` on the Agent Runtime through the preload API.
3. The Runtime creates a Turn in `EventJournal` and asks `conversation-service.ts`
   to start the transport and Tool Loop.
4. `conversation-service.ts` exports the Runtime's current tool definitions and
   POSTs them to `/api/projects/conversations/{id}/stream`. Flask validates and
   persists this Run tool snapshot, then forwards it to the model unchanged.
5. The model may stream reasoning, message content, or tool calls. Flask emits
   SSE events, which the Runtime translates into `Thread/Turn/Item` Runtime
   events and publishes to Renderer listeners.
6. If the model requests tools, the Tool Loop executes independent calls in
   parallel through the Runtime tool registry, then calls
   `/api/agent-runs/{id}/resume` with the complete result batch and the current
   tool snapshot. This repeats until the run finishes. Loading an MCP updates
   the client Registry before resume, so its definitions are available to the
   next model request without Flask reconstructing capability state.
7. When the model returns a final answer, Flask persists an `assistant` Message,
   and the Runtime emits `turn.completed`.

If an HTTP/SSE connection ends unexpectedly, the Runtime retains the partial
message, reasoning, pending tool-call IDs, and already-produced tool results.
It reconnects through `/api/agent-runs/{id}/recover` with bounded backoff. Flask
then continues a disconnected model stream, replays pending tool requests, or
accepts an already-produced result batch without executing local side effects a
second time.

Switching React pages or closing a window does **not** cancel a Turn. The
Runtime keeps running in Electron main; when the user re-enters the Thread,
the Renderer re-subscribes, reads the current snapshot, and replays events by
`sequence` so nothing is lost.

## Thread / Turn / Item event model

The system uses one event model for ordinary chat and Multi-Agent execution.

- **Thread**: a resumable conversation. Maps to `Conversation` in PostgreSQL.
- **Turn**: one user request from start to completion/failure/interruption.
  Maps to `AgentRun`.
- **Item**: an atomic activity inside a Turn (reasoning, agent message, tool
  call). Maps conceptually to `AgentEvent`.

Runtime event lifecycle:

```text
turn.started
  item.started   (reasoning / agent_message / tool)
  item.delta
  item.completed
turn.completed | turn.failed | turn.interrupted
```

Each event carries `threadId`, `turnId`, and a monotonically increasing
`sequence` assigned by `EventJournal`. The Journal is the single source of
truth for active Turn state and supports:

- subscription and re-subscription,
- snapshot replay by `sequence`,
- consistent ordering across all Renderer windows.

## Shared Agent Runtime

The platform-neutral harness lives in `packages/agent-runtime`. It owns provider
stream parsing, the model/tool/resume loop, parallel tool dispatch, bounded
failure recovery, pending-result replay, and Turn execution. Tool definitions
and execution contracts live separately in `packages/tool-contracts`, while
`packages/runtime-core` owns the event journal and execution state.

Tool definitions and execution are composed from `ToolPlugin` instances in a
shared `ToolRegistry`. The active Desktop or Mobile Runtime is the sole source
of tool capability and Schema. Flask bounds, persists, and forwards each Run's
snapshot but does not define tools or infer loaded capabilities from event
history. Desktop and Mobile construct separate registries for their own
supported tools. Both reuse the same capability plugin for
`search_capabilities` and `load_capability`; each host filters results through
its own adapter. MCP schemas are not injected at startup: a selected MCP is
added to subsequent model requests only after `load_capability` returns its
tool definitions. Once loaded, that selected MCP remains available to later
Turns in the same Thread; unrelated MCP servers remain absent.

Complete tool outputs remain persisted in Agent events. When an output is too
large for the current model context, the tool message contains a bounded prefix
and a `resultRef` instead of silently preserving only its head and tail. The
shared `read_tool_result` and `search_tool_result` plugins let Desktop and Mobile
retrieve exact pages or matching passages from that persisted result. Initial
preview size is allocated from the remaining context budget across the current
tool results; explicit pages remain independently bounded.

The shared packages depend on ports for model transport, tool execution,
persistence, lifecycle events, and resource cancellation. They must not import
Electron, React Native, Expo, Node built-ins, or application directories;
`pnpm check:boundaries` enforces this boundary.

## Electron desktop host

The Electron host is implemented in
`desktop/electron/runtime/desktop-runtime-host.ts`. It binds the shared Runtime
to Electron IPC, SQLite persistence, desktop tools, terminal ownership, and
remote-run cancellation. `sqlite-event-store.ts` persists state under
Electron's `userData` directory. The host is a module-level singleton inside
Electron main.

Responsibilities:

- Allocate `turnId` and create a Turn in `EventJournal`.
- Translate provider-level SSE events (`ConversationStreamEvent`) into
  `RuntimeEvent` with proper item lifecycles.
- Persist execution metadata (`remoteRunId`, phase, pending tool calls, owned
  terminals) alongside the event journal.
- Invoke the shared Tool Loop and dispatch local capabilities through the
  desktop tool adapter.
- Handle interruption with `interruptTurn()`, which cancels the model stream,
  stops terminals created by that Turn, retries remote cancellation, persists the partial message, and emits
  `turn.interrupted`.
- Publish events to all live Renderer windows on `thread:event:${threadId}`.

Important invariants:

- `turn.completed` / `turn.failed` / `turn.interrupted` is emitted at most once
  per Turn.
- In-progress reasoning or message items are closed before a tool item is
  started.
- Runtime events are committed to local SQLite before publication. Renderer
  reconnection replays them by `sequence`; stale in-progress Turns are marked
  `interrupted(runtime_restarted)` after an Electron process restart.
- A live Electron process retries recoverable HTTP/SSE disconnects. After an
  Electron process restart, stale execution metadata is used to stop owned
  terminals and reconcile the remote run before the Turn is marked interrupted;
  dead PTYs are never presented as resumable processes.
- Durable conversation content remains owned by Flask and PostgreSQL.

## Mobile host

The Expo application lives in `mobile/` and consumes the same protocol, Agent
Runtime contracts, and semantic design tokens. Expo SecureStore owns mobile
credentials. Mobile adapters must never expose desktop filesystem, terminal, or
attachment-analysis tools. Its registry supports task planning, capability
search/load, synchronized Skills, and enabled HTTP MCP servers; stdio MCP stays
desktop-only. Capability search fails closed by removing entries the mobile
adapter cannot execute. Expo Router owns navigation and auth route guards.

## Flask service boundaries

Flask routes live under `api/app/routes/` and are thin. They perform request
parsing, authentication boundary handling, and response serialization only.
Business logic lives under `api/app/services/`.

Main service groups:

| Group | Path | Responsibility |
|-------|------|----------------|
| Agent chat | `api/app/services/agent/` | Prepare context, stream model requests, resume after tools, context compaction. |
| Capability discovery | `api/app/services/capabilities/`, `retrieval/` | Synchronize Skills/MCP metadata, embeddings, vector search, and optional reranking. |
| Multi-Agent | `api/app/services/multi_agents/` | Host scheduling, collaboration tasks, group chat, workspace change tracking. |
| Conversations | `api/app/services/conversations/` | Message CRUD and user prompt preparation. |
| Auth | `api/app/services/auth/` | JWT, registration, login, and token handling. |
| Projects / sessions | `api/app/services/projects/`, `sessions/` | Workspace metadata and agent session lifecycle. |
| Settings | `api/app/services/settings/`, `model_credentials.py` | Model configuration and encrypted credential storage. |
| Object storage | `api/app/services/object_storage.py` | MinIO-backed avatars and synchronized Skill objects. |

Expected failures use `ServiceError` with stable machine-readable codes.
Unexpected failures are logged; streaming endpoints still terminate the SSE
protocol with a `run.failed` event so the client does not receive an invalid
EOF.

## Agent Loop and context compression

The Agent Loop is implemented in `api/app/services/agent/chat.py`.

Flow:

1. `prepare_completion()` creates an `AgentRun`, prepares the context window,
   and returns a `PreparedCompletion` with endpoint, decrypted key, and payload.
2. `provider_stream.py` uses the official OpenAI Python SDK for compatible Chat
   Completions transport, SSE decoding, standard retries, and HTTP errors. It
   automatically retries once without `stream_options` when a provider rejects
   that optional field; this is protocol negotiation, not a user setting.
3. `stream_completion()` consumes structured provider chunks, accumulates
   reasoning/message/tool-call deltas, and yields Runtime events.
4. If tool calls are requested, the run moves to `waiting_tool`. The Runtime
   executes them and calls `resume_completion()`.
5. `resume_completion()` replays tool history since the latest checkpoint,
   rebuilds the model payload, and re-enters the stream.

Context compression in `api/app/services/agent/context.py`:

- `estimate_tokens()` gives a fast, provider-agnostic token estimate.
- `prepare_context()` keeps a recent context window and summarizes older
  messages into a `ContextCheckpoint` when the budget threshold
  (`COMPACTION_RATIO = 0.70`) is exceeded.
- `compact_payload()` creates a checkpoint from tool-history payloads when the
  tool-call transcript grows too large.
- Checkpoints are persisted in `ContextCheckpoint` and reused across turns in
  the same conversation.

The model payload includes:

- Base system instructions.
- Workspace instructions loaded from hierarchical `AGENTS.md` files.
- A summary of any previously cancelled run, to avoid retry loops.
- The Multi-Agent mailbox when the conversation is a collaboration node.
- Recent conversation messages or a checkpoint summary.

## Local tools

Local tools run inside Electron main. `packages/agent-runtime` owns the
model/tool/resume loop, while
`desktop/electron/runtime/desktop-tool-registry.ts` is the desktop adapter for
built-in file, terminal, image, capability, task, collaboration, and dynamic
MCP tools. `conversation-service.ts` only assembles workspace context,
transport, registry, and the shared loop.

Unknown tool names are rejected explicitly. Identical failed operations are
bounded to prevent ineffective retry loops, and write-capable tools keep the
existing workspace lock and change-recording behavior.

### File tools (`desktop/electron/files/file-tools.ts`)

- `read_file`: read UTF-8 text with line numbers, bounded bytes.
- `search_files`: content or filename search inside the workspace.
- `list_directory`: bounded depth/file listing.
- `apply_patch`: strict patch envelope supporting add/update/delete.

Safety mechanisms:

- All paths are resolved under the workspace root.
- `apply_patch` requires that every target file has been previously inspected
  with `read_file` in the same Turn (`inspectedPaths`).
- Hierarchical `AGENTS.md` instructions are loaded and returned with results.
- Binary files are rejected by `read_file` and `search_files`.

### Terminal (`desktop/electron/terminal/terminal-manager.ts`)

- Persistent PTY terminals via `node-pty`.
- Supports `start`, `read`, `write`, `stop`, and `list`.
- `read` waits until the process exits or `yieldMs` elapses.
- Multi-Agent workspaces acquire a write lock around terminal start and patch
  operations so `WorkspaceChange` records can be captured.

## Multi-Agent collaboration

Multi-Agent uses the same Runtime, Turn, tool, context, and event model as
ordinary chat. It does not maintain a separate execution framework.

Concepts:

- `MultiAgent`: a reusable collaboration template with a team definition.
- `MultiAgentTask`: one concrete task spawned from a template.
- `MultiAgentNode`: a member of the task, linked to a `Conversation` and a
  `ModelConfiguration`.
- `MultiAgentMessage`: the group-chat mailbox, ordered by `sequence`.
- `WorkspaceChange`: filesystem changes made by a node during a task.

Execution model:

- Only one node has the active Turn at a time.
- The host node can use `finish_collaboration` to end the task.
- Each task persists an execution limit and the number of node Turns started.
  At the limit, delegation stops and the host receives one final Turn that can
  only summarize the available results with `finish_collaboration`.
- Any node can use `agent_message` to post to the mailbox and hand the active
  Turn to another node by exact UUID.
- The mailbox is injected as a system message into the model payload.
- Workspace write locks and change snapshots are managed by
  `workspace-write-lock.ts` and `workspace-changes.ts`.

## Persistence model

PostgreSQL tables are defined under `api/app/models/`.

Core tables:

- `users`: accounts and password hashes.
- `projects`: workspace roots, linked to users.
- `conversations`: threads, linked to projects.
- `messages`: user and assistant messages, linked to conversations and runs.
- `model_configurations`: provider URL, model name, encrypted API key.
- `agent_runs`: turns with status, token usage, and error code.
  Each Run also persists the latest Runtime-supplied tool snapshot for auditing
  and recovery consistency.
- `agent_events`: events inside a run, ordered by `(run_id, sequence)`.
- `context_checkpoints`: conversation summaries used for context compression.
- `agent_sessions`: persisted agent session state.
- `mcp_servers`: user MCP configuration and synchronized metadata.
- `retrieval_documents`: Capability search documents and pgvector embeddings.
- `multi_agents`, `multi_agent_tasks`, `multi_agent_nodes`,
  `multi_agent_messages`, `workspace_changes`: collaboration state.

Redis is used for service health checks, Celery broker/result transport, and
distributed locks around scheduled capability-index reconciliation.
MinIO owns binary/object payloads such as avatars and synchronized Skills;
PostgreSQL remains the source of truth for their metadata.

## Environment boundary

Host processes connect to `localhost`. Containers connect to Compose service
names (`postgres` and `redis`). Electron itself is not containerized.

Remote deployments expose only Nginx on the configured HTTP/HTTPS ports. Nginx
proxies `/api` to Flask on the internal Compose network and disables buffering
for streaming responses. Flask, PostgreSQL, Redis, and MinIO are not published
to the host. The production API validates that `SECRET_KEY` and
`JWT_SECRET_KEY` are independent, random, and at least 32 characters. Release
clients should connect via HTTPS; the current plain-HTTP default remains a
release blocker tracked below.

## Remaining work

The major architecture layers are implemented. The next structural priorities
are tracked in [`issues.md`](issues.md):

1. **Diff review and approval**: `apply_patch` currently writes immediately
   after inspection. High-risk changes need a pending-patch model, review UI,
   and explicit approve/reject actions before mutation.
2. **Durable execution coordination**: a live Electron host can recover bounded
   transport failures, but long-running model execution still depends on the
   Flask request/process lifecycle. A persistent queue or execution service
   should own leases, retries, cancellation, and idempotent resume.
3. **Release security**: production HTTPS, desktop code signing/notarization,
   secret rotation, dependency scanning, and backup/restore procedures need a
   documented release gate.
4. **Cross-host end-to-end coverage**: add automated Desktop/API and Mobile/API
   flows for streaming, tool resume, interruption/recovery, capability loading,
   and migrations. Current coverage is strongest at unit and smoke-test level.
