# 自动化测试

测试按运行边界分层，不接真实模型，也不使用个人账号的凭据。修复 bug 时，先补能复现问题的
用例，再改实现；不要为了测试给生产代码添加测试专用分支。

## 后端快速回归

```bash
cd api
uv sync --frozen
uv run ruff check app tests evals integration
uv run pytest --cov=app --cov-report=term-missing --junitxml=test-results/pytest.xml
```

`tests/` 默认使用 SQLite，覆盖认证、设备隔离、模型配置、能力检索、上下文压缩、消息分支、
协作状态和事件保留。需要同步执行 Worker 的 HTTP 用例显式引用 `model_worker_dispatch`
fixture；其他测试不会被全局替换执行方式。真实 Celery 调度另有独立进程测试，使用内存 Broker。
覆盖率用于发现空白，不以任意百分比替代关键行为断言。

## PostgreSQL 集成回归

使用独立测试数据库，不要配置生产数据库。数据库需要已安装 `vector` 扩展，CI 使用
`pgvector/pgvector:pg17`。在 Bash 中设置环境变量：

```bash
export TEST_DATABASE_URL='postgresql+psycopg://ohmycode:password@127.0.0.1:5432/ohmycode_test'
cd api
uv run pytest integration --junitxml=test-results/postgres.xml
```

PowerShell 使用 `$env:TEST_DATABASE_URL='...'`。每个用例创建随机命名的 schema，结束时删除，
应用查询通过 `schema_translate_map` 指向该 schema，不读写 `public` 中的业务表。
未配置数据库时明确失败，不会悄悄退回 SQLite 或跳过测试。

覆盖重复消息并发提交、重复工具回执、Worker 抢占、停止与输出竞争、单调事件序号、
外键级联删除，以及时间字段迁移的空值修复、降级与再次升级。

## 迁移检查

仅在一次性数据库或已备份的测试数据库中执行：

```bash
cd api
uv run flask --app manage:app db upgrade
uv run flask --app manage:app db check
```

CI 从空库升级到最新版本，并检查 SQLAlchemy metadata 与迁移结果一致；不能只用
`db.create_all()` 证明迁移正确。生产数据迁移不属于测试命令的职责。

## CI 与测试约束

- 每个 PR 和 main 推送运行后端回归、客户端检查、迁移及 Compose 配置校验。
- JUnit 和后端覆盖率报告随 CI 上传；失败时可直接定位用例，而非只看整个脚本的退出码。
- 并发测试使用 Barrier/Event 确定执行顺序，不靠长时间 sleep 猜测状态。
- 临时文件只能写入测试临时目录；不要调用真实模型、MCP 服务或用户工作区文件。
- SQLite 与内存 Broker 的快速测试不能替代真实数据库和跨进程边界测试。
