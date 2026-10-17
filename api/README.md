# OhMyCode API

OhMyCode API 是基于 Python 3.12、Flask 和 SQLAlchemy 的服务端应用，负责认证、用户与项目
数据、模型配置、对话持久化、上下文构造、流式模型请求、Multi-Agent 调度以及 Capability
检索。PostgreSQL 用于持久化，Redis 为 Celery 提供 Broker 和结果存储，MinIO 保存头像与
同步 Skill 等对象。

## 目录结构

```text
app/
  routes/            HTTP 请求解析、认证边界和响应序列化
  services/          业务逻辑、Agent 服务与领域操作
  models/            SQLAlchemy 持久化模型
  integrations/      外部服务和基础设施适配
  tasks/             Celery 异步与定时任务

migrations/          Flask-Migrate / Alembic 数据库迁移
tests/               pytest 测试
evals/               固定 Harness 任务、运行记录评分与版本对比
manage.py            Flask 开发与迁移入口
celery_app.py        Celery Worker / Beat 入口
wsgi.py              生产 WSGI 入口
```

Flask Route 只处理 HTTP 协议边界，查询、编排与业务判断必须放在 `app/services/`。预期业务
错误通过带有稳定错误码的 `ServiceError` 返回。

## 本地环境

前置要求：Python 3.12、`uv`，以及 PostgreSQL、Redis 和 MinIO。可以从仓库根目录启动依赖：

```bash
cp docker/.env.example docker/.env
docker compose --env-file docker/.env -f docker/docker-compose.dev.yml up -d
```

准备 API 配置并安装依赖：

```bash
cp api/.env.example api/.env
cd api
uv sync
```

`api/.env` 中的 `MINIO_ACCESS_KEY` 和 `MINIO_SECRET_KEY` 必须与 `docker/.env` 中的
`MINIO_ROOT_USER` 和 `MINIO_ROOT_PASSWORD` 保持一致。真实密钥不得提交。

初始化或升级数据库：

```bash
uv run flask --app manage:app db upgrade
```

## 启动服务

API、Celery Worker 和 Celery Beat 应分别在独立终端中运行。

聊天模型请求由 Worker 执行，API 只提交任务并通过 SSE 订阅 PostgreSQL 中的输出。
断开 HTTP 不会终止推理，重连会重放当前请求，客户端按事件 ID 去重。
Beat 每 30 秒补发未执行的任务并检查执行租约；Worker 丢失会明确失败，不会偷偷重跑模型。
因此本地聊天也需要启动下面三个进程，不能只启动 Flask。

API：

```bash
cd api
uv run flask --app manage:app run --host 0.0.0.0 --port 8765 --debug
```

Celery Worker（macOS / Linux）：

```bash
cd api
uv run celery -A celery_app:celery worker --loglevel=info
```

Celery Worker（Windows PowerShell）：

```powershell
cd api
uv run celery -A celery_app:celery worker --loglevel=info --pool=solo
```

Celery Beat：

```bash
cd api
uv run celery -A celery_app:celery beat --loglevel=info
```

Worker 执行异步任务，Beat 负责定时投递存量 Capability Embedding 补偿和 AgentEvent 清理。
两者都依赖 Redis。

健康检查：

```bash
curl http://127.0.0.1:8765/api/health
```

## 关键配置

- `DATABASE_URL`：PostgreSQL SQLAlchemy 连接地址
- `REDIS_URL`：应用使用的 Redis 地址
- `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND`：Celery Redis 数据库
- `SECRET_KEY` / `JWT_SECRET_KEY`：相互独立的应用与 JWT 密钥
- `MINIO_*`：对象存储连接和 Bucket
- `CORS_ORIGINS`：允许访问 API 的 Web 来源
- `EMBEDDING_*` / `RERANK_*`：Capability 语义检索服务，可留空并降级为词法检索

完整字段和默认值以 [`api/.env.example`](./.env.example) 为准。

## 数据库迁移

修改 `app/models/` 下的持久化模型时必须创建并检查迁移：

```bash
cd api
uv run flask --app manage:app db migrate -m "describe the schema change"
uv run flask --app manage:app db upgrade
```

提交前应验证迁移可以从空数据库完整升级，不要用运行时兼容分支代替正式迁移。

## 验证

```bash
cd api
uv run ruff check app tests evals integration
uv run pytest
```

PostgreSQL 并发回归独立运行 `uv run pytest integration`，需配置 `TEST_DATABASE_URL`；
隔离方式、迁移差异检查和报告说明见 [自动化测试](../docs/testing.md)。

涉及认证、持久化、流式协议、迁移或后台任务的改动，应补充并运行对应专项测试。模型供应商
失败时也必须保持 SSE 正常终止，让客户端收到明确错误，而不是无效 EOF。

Harness 评测读取实际 Run / Event，统计调用、重复读取、耗时及真实 token 用量。
用 `uv run python -m evals list` 查看固定任务。评分、独立测试工作区与前后对比方法见
[Harness 评测说明](../docs/harness-evals.md)。CI 检查评分器本身，真实模型完成率需要实际运行任务。

生产 Compose、Nginx 和部署说明见根目录 [README](../README.md) 与
[`docker/README.md`](../docker/README.md)。
