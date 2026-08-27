# Architecture

This document describes the high-level architecture of OhMyCode at version 0.1.0.
It is a desktop-first Code Agent workspace: the Electron client is the primary
entry point, and the Python Flask API runs as an independently managed service.

## Table of contents

- [Process boundary](#process-boundary)
- [Data and control flow](#data-and-control-flow)
- [Thread / Turn / Item event model](#thread--turn--item-event-model)
- [Electron Agent Runtime](#electron-agent-runtime)
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
     +--> OpenAI-compatible LLM
```

Key boundaries:

- React Renderer code must not execute OS commands or access Node APIs. Use the
  narrow IPC boundary registered under `client/electron/ipc/`.
- Local tools (terminal, file tools) stay behind the Runtime. Do not expose
  generic terminal or filesystem APIs to the Renderer.
- Secrets and model credentials live in the service or Electron main process and
  must never be exposed to the Renderer, logs, fixtures, or commits.

## Data and control flow

A normal chat turn flows like this:

1. The user sends a message in the React UI.
2. The Renderer calls `startTurn()` on the Agent Runtime through the preload API.
3. The Runtime creates a Turn in `EventJournal` and asks `conversation-service.ts`
   to stream from Flask.
4. `conversation-service.ts` POSTs to `/api/projects/conversations/{id}/stream`,
   which creates an `AgentRun` and starts the model stream.
5. The model may stream reasoning, message content, or tool calls. Flask emits
   SSE events, which the Runtime translates into `Thread/Turn/Item` Runtime
   events and publishes to Renderer listeners.
6. If the model requests a tool, the Runtime executes it locally (terminal or
   file tool), then calls `/api/agent-runs/{id}/resume` to send the result back
   to the model. This loop repeats until the run finishes.
7. When the model returns a final answer, Flask persists an `assistant` Message,
   and the Runtime emits `turn.completed`.

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

## Electron Agent Runtime

The Runtime is implemented in `client/electron/runtime/agent-runtime.ts` and
`event-journal.ts`. It is a module-level singleton inside Electron main.

Responsibilities:

- Allocate `turnId` and create a Turn in `EventJournal`.
- Translate provider-level SSE events (`ConversationStreamEvent`) into
  `RuntimeEvent` with proper item lifecycles.
- Execute tool requests locally or delegate to `conversation-service.ts`.
- Handle interruption with `interruptTurn()`, which cancels the model stream,
  stops terminals, persists the partial message, and emits
  `turn.interrupted`.
- Publish events to all live Renderer windows on `thread:event:${threadId}`.

Important invariants:

- `turn.completed` / `turn.failed` / `turn.interrupted` is emitted at most once
  per Turn.
- In-progress reasoning or message items are closed before a tool item is
  started.
- The Runtime does **not** persist conversation state itself; durable storage
  is handled by Flask and PostgreSQL.

## Flask service boundaries

Flask routes live under `api/app/routes/` and are thin. They perform request
parsing, authentication boundary handling, and response serialization only.
Business logic lives under `api/app/services/`.

Main service groups:

| Group | Path | Responsibility |
|-------|------|----------------|
| Agent chat | `api/app/services/agent/` | Prepare context, stream model requests, resume after tools, context compaction. |
| Local tool models | `api/app/services/agent/tools.py` | Tool schemas for `read_file`, `search_files`, `list_directory`, `apply_patch`, `terminal`, `agent_message`, `finish_collaboration`. |
| Multi-Agent | `api/app/services/multi_agents/` | Host scheduling, collaboration tasks, group chat, workspace change tracking. |
| Conversations | `api/app/services/conversations.py` | Message CRUD, user prompt preparation. |
| Auth / users | `api/app/services/auth.py`, `users.py` | JWT, registration, login. |
| Settings | `api/app/services/settings.py` | Model configuration, encrypted credential storage. |

Expected failures use `ServiceError` with stable machine-readable codes.
Unexpected failures are logged; streaming endpoints still terminate the SSE
protocol with a `run.failed` event so the client does not receive an invalid
EOF.

## Agent Loop and context compression

The Agent Loop is implemented in `api/app/services/agent/chat.py`.

Flow:

1. `prepare_completion()` creates an `AgentRun`, prepares the context window,
   and returns a `PreparedCompletion` with endpoint, decrypted key, and payload.
2. `stream_completion()` streams the OpenAI-compatible Chat Completions
   endpoint, accumulates reasoning/message/tool-call deltas, and yields events.
3. If tool calls are requested, the run moves to `waiting_tool`. The Runtime
   executes them and calls `resume_completion()`.
4. `resume_completion()` replays tool history since the latest checkpoint,
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

Local tools run inside Electron main and are invoked by
`conversation-service.ts`.

### File tools (`client/electron/files/file-tools.ts`)

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

### Terminal (`client/electron/terminal/terminal-manager.ts`)

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
- `agent_events`: events inside a run, ordered by `(run_id, sequence)`.
- `context_checkpoints`: conversation summaries used for context compression.
- `multi_agents`, `multi_agent_tasks`, `multi_agent_nodes`,
  `multi_agent_messages`, `workspace_changes`: collaboration state.

Redis is used for service health checks, Celery broker/result transport, and
distributed locks around scheduled capability-index reconciliation.

## Environment boundary

Host processes connect to `localhost`. Containers connect to Compose service
names (`postgres` and `redis`). Electron itself is not containerized.

Remote deployments expose only Nginx on the configured HTTP/HTTPS ports. Nginx
proxies `/api` to Flask on the internal Compose network and disables buffering
for streaming responses. Flask, PostgreSQL, Redis, and MinIO are not published
to the host. The production API validates that `SECRET_KEY` and
`JWT_SECRET_KEY` are independent, random, and at least 32 characters. Clients
connect via HTTPS in production.

## Remaining work

The major architectural layers described in earlier drafts are implemented.
The remaining item is:

5. **Diff review and approval** before applying high-risk file changes. The
   current `apply_patch` tool executes immediately after the target files have
   been inspected. A future layer should queue pending patches, render a diff
   in the UI, and only write them after explicit user approval.

Additional known areas for future architecture work:

- **Runtime durability**: the EventJournal is currently in-memory only. A crash
  of the Electron main process loses active Turn state. Long-running work may
  eventually move to a dedicated execution service rather than living inside
  HTTP routes.
- **Execution service**: for resilient background tasks, consider extracting
  the Agent Loop from Flask HTTP routes into a worker backed by Redis or a
  persistent queue, with the API acting as coordinator.
- **Diff review UI**: pending patch queue, side-by-side diff rendering, and
  approval/rejection actions in the Renderer.
