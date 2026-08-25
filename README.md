# OhMyCode

OhMyCode 是一个桌面优先的 Code Agent 工作空间，使用 Electron、React、Flask、
PostgreSQL 和 Redis 构建。它支持 OpenAI-compatible 模型、流式对话、持久终端、
文件工具、上下文压缩以及主持人调度的 Multi-Agent 协作。

## 技术栈

- 客户端：Electron、React、TypeScript、Vite、react-i18next
- Agent Runtime：Electron Main 常驻运行时、PTY 终端、文件工具
- 服务端：Python 3.12、Flask、SQLAlchemy、JWT
- 基础设施：PostgreSQL、Redis、Docker Compose
- 模型协议：OpenAI-compatible Chat Completions，SSE 流式响应

## 目录结构

```text
api/
  app/routes/          HTTP 路由，只处理协议适配
  app/services/        业务逻辑、Agent Loop、上下文与协作调度
  app/models/          PostgreSQL 数据模型
  migrations/          Flask-Migrate / Alembic 迁移
  tests/               服务端测试

client/
  electron/runtime/    常驻 Agent Runtime、事件 Journal
  electron/terminal/   持久 PTY 终端管理
  electron/files/      文件工具与 AGENTS.md 加载
  electron/ipc/        Renderer 与 Electron Main 的窄 IPC 边界
  src/pages/           页面组合
  src/features/        业务功能组件
  src/shared/          通用 UI、国际化与基础能力

docker/                完整与依赖服务 Compose 配置
```

## 整体架构

```mermaid
flowchart LR
    UI[React Renderer<br/>页面与流式时间线]
    IPC[Preload / IPC<br/>受限客户端接口]
    RT[Electron Agent Runtime<br/>Thread / Turn / Item]
    JOURNAL[Event Journal<br/>顺序、订阅与重放]
    TOOLS[本地工具<br/>PTY Terminal / File Tools]
    API[Flask API<br/>Agent Loop 与业务服务]
    MODEL[OpenAI-compatible LLM]
    DB[(PostgreSQL)]
    CACHE[(Redis)]

    UI <--> IPC
    IPC <--> RT
    RT <--> JOURNAL
    RT <--> TOOLS
    RT <-->|HTTP + SSE| API
    API <-->|Streaming| MODEL
    API <--> DB
    API <--> CACHE
```

职责边界：

- React Renderer 只负责展示与用户交互，不拥有正在执行任务的真实状态。
- Electron Agent Runtime 是活动 Turn、工具调用和终端会话的唯一事实源。
- Event Journal 为每个 Turn 分配单调递增序号，支持重新订阅和增量重放。
- Flask 负责认证、配置、项目数据、消息持久化、上下文构造和模型 Agent Loop。
- PostgreSQL 保存用户、项目、会话、消息、运行记录和协作数据；Redis 当前纳入服务健康检查，并为后续缓存和临时协调预留。

## Thread / Turn / Item

运行协议统一使用三个核心概念：

- `Thread`：一段可持续恢复的会话，对应当前持久层的 Conversation。
- `Turn`：一次用户请求到最终完成、失败或停止的完整执行，对应 AgentRun。
- `Item`：Turn 内的原子活动，例如思考、Agent 消息、命令或文件修改，对应 AgentEvent 语义。

```mermaid
stateDiagram-v2
    [*] --> TurnStarted: turn.started
    TurnStarted --> ItemRunning: item.started
    ItemRunning --> ItemRunning: item.delta
    ItemRunning --> ItemCompleted: item.completed
    ItemCompleted --> ItemRunning: 下一项活动
    ItemCompleted --> TurnCompleted: turn.completed
    TurnStarted --> TurnFailed: turn.failed
    ItemRunning --> TurnFailed: turn.failed
    TurnStarted --> TurnInterrupted: turn.interrupted
    ItemRunning --> TurnInterrupted: turn.interrupted
    TurnCompleted --> [*]
    TurnFailed --> [*]
    TurnInterrupted --> [*]
```

所有 Runtime 事件都包含 `threadId`、`turnId` 和 `sequence`。Item 使用
`started → delta → completed` 生命周期，前端不再分别猜测思考、消息和工具的状态。

## Agent 执行流程

```mermaid
sequenceDiagram
    participant U as User
    participant UI as React Renderer
    participant R as Agent Runtime
    participant A as Flask Agent Service
    participant L as LLM Provider
    participant T as Local Tools

    U->>UI: 发送任务
    UI->>R: startTurn(threadId, content)
    R-->>UI: turnId
    R->>A: 创建同 ID 的 AgentRun
    A->>L: 流式模型请求
    L-->>A: reasoning / content / tool call
    A-->>R: SSE 事件
    R-->>UI: Item 事件
    alt 模型请求工具
        R->>T: 执行命令或文件操作
        T-->>R: 工具结果
        R->>A: resume(turnId, results)
        A->>L: 携带工具结果继续推理
    else 模型给出最终回答
        A-->>R: 完成并持久化消息
        R-->>UI: turn.completed
    end
```

Runtime 在 Electron Main 进程中常驻。切换页面或会话只会取消 Renderer 的订阅，
不会取消 Turn。再次进入 Thread 时，客户端先订阅实时频道，再读取 Snapshot，并按
`sequence` 去重和重放，因此不会丢失切换期间产生的事件。

用户停止任务时，Runtime 先将 Turn 标记为正在中断，再取消模型流、停止该 Turn 启动的
终端、通知 Flask 持久化部分输出，最后发布 `turn.interrupted`，避免停止和自然完成互相竞争。

## Multi-Agent

Multi-Agent 使用可复用的协作配置和主持人调度的群聊模型。每次只有一个 Agent 执行，
主持人负责选择下一位成员和结束协作。各成员仍然复用相同的 Agent Runtime、Turn、工具、
上下文和事件时间线，不维护第二套执行框架。

## 开发环境

### 前置要求

- Python 3.12 与 `uv`
- Node.js 22+ 与 pnpm
- Docker Desktop

复制本地环境配置，真实 `.env` 不得提交：

```bash
cp docker/.env.example docker/.env
cp api/.env.example api/.env
cp client/.env.example client/.env
```

启动 PostgreSQL 和 Redis：

```bash
docker compose --env-file docker/.env -f docker/docker-compose.dev.yml up -d
```

初始化 API：

```bash
cd api
uv sync
uv run flask --app manage:app db upgrade
```

单独启动 API：

```bash
cd api
uv run flask --app manage:app run --host 127.0.0.1 --port 8765 --debug
```

启动桌面客户端：

```bash
cd client
pnpm install
pnpm dev
```

开发模式下 Electron 会复用已经运行且能力兼容的 `127.0.0.1:8765` API；如果没有找到，
会尝试启动本仓库中的 Flask 服务。打包后的客户端只连接外部 API，不捆绑 Python 服务端。

Windows 与 WSL 创建的 `.venv` 不能混用。如果切换运行环境，请执行：

```bash
uv venv --clear .venv
uv sync
```

## 验证

```bash
cd api
uv run ruff check app tests
uv run pytest

cd client
pnpm test:runtime
pnpm typecheck
pnpm lint
pnpm build

docker compose --env-file docker/.env.example -f docker/docker-compose.yml config
docker compose --env-file docker/.env.example -f docker/docker-compose.dev.yml config
```

## 开发约束

仓库级开发规则位于 [AGENTS.md](./AGENTS.md)。修改某个目录前，还应继续查找该目录到目标文件
路径上的更深层 `AGENTS.md`，更具体的规则优先。
