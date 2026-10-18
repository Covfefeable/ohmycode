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

## 共享 Runtime 与本地工具

```bash
pnpm --dir desktop test:runtime
pnpm --dir desktop test:file-tools
```

Runtime 使用 Node 内置 test runner，不引入另一套测试框架。测试覆盖 SSE 任意字节分包、
中文解码、重放去重、完整工具批次、工具结果回执丢失，以及协议结束、异常时的连接释放。
`[DONE]` 是协议终点，不能继续等待 HTTP 连接关闭，也不能再交付后续内容。
已有 EventJournal、SQLite 恢复和文件工具 smoke 测试继续执行。

## 界面组件回归

```bash
pnpm --dir desktop test:ui
pnpm test:clients
```

Vitest + Testing Library 在 jsdom 中运行真实 React 组件，复用应用的 Vite 配置和多语言资源。
测试环境使用 Node.js 22.12 及以上版本。
覆盖编辑器提交、输入法、外部清空、禁用状态，选择框、确认弹窗、图标按钮、tooltip 和 Markdown
代码保真。优先通过角色、可见文案和用户操作断言，不给组件增加测试专用属性，不使用大量快照。
JUnit 输出在 `desktop/test-results/ui.xml`。`pnpm test` 是全部客户端测试入口，后端可执行
`pnpm test:api` 或直接使用上述 uv 命令。

jsdom 不验证真实布局、Electron 标题栏拖拽区域、GPU 动效或手机原生键盘；这些仍需要对应设备的
冒烟验证，不能把组件测试通过等同于整机行为已经验证。

## 单 Agent 聊天回归

消息一致性与任务状态测试沿用 Vitest，不连接 API：通过可手动返回的 IPC Promise 和可手动刷新
的动画帧，控制发送回执、流式事件、历史读取的先后顺序。覆盖：

- 发送回执晚到时不清空已输出内容、不重复用户消息，已结束任务不被回执重新开启。
- 卸载会话不停止后台执行；重新打开通过快照恢复，快照与实时事件重叠时不重复应用。
- 加载历史不覆盖流式内容；旧会话的回显和发送回执不写入新会话。
- 排队失败不改变当前任务状态；完成、失败、停止不等待历史读取才更新运行状态。
- 停止保存已有输出，IPC 失败有提示；引导被接收、撤销后，旧快照不恢复已移除的排队条。

Runtime 的故障注入覆盖连接意外 EOF 后重放去重、工具回执断网后携带原结果恢复、退避期间
停止不再重连，以及服务商明确失败时不当作网络错误重试。无真实模型调用。

真实布局使用 Node 内置 test runner + Playwright，加载独立测试页面中的实际 MessageList、
MarkdownContent 和展开状态逻辑，不启动完整应用，不设置生产代码测试分支：

```bash
pnpm --dir desktop exec playwright install chromium
pnpm --dir desktop test:browser
```

覆盖千条消息虚拟化、正文和输入框避让、轻微上滑解除贴底、新消息不抢滚动、回到底部恢复跟随、
历史前插锚点，以及虚拟行卸载后的展开状态。测试自行启动随机端口的 Vite，并在结束后关闭，
不占用开发环境的 5173 端口。CI 的 clients 作业运行这些用例。

本机也可使用已安装的浏览器，例如 PowerShell：

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'
pnpm --dir desktop test:browser
```

这些用例不是整机端到端测试：Electron 真实 IPC、窗口拖拽区、系统剪贴板以及供应商真实流式
行为仍需桌面冒烟验证。浏览器测试页不会打入桌面正式包。

## CI 与测试约束

- 每个 PR 和 main 推送运行后端回归、客户端检查、迁移及 Compose 配置校验。
- JUnit 和后端覆盖率报告随 CI 上传；失败时可直接定位用例，而非只看整个脚本的退出码。
- 并发测试使用 Barrier/Event 确定执行顺序，不靠长时间 sleep 猜测状态。
- 临时文件只能写入测试临时目录；不要调用真实模型、MCP 服务或用户工作区文件。
- SQLite 与内存 Broker 的快速测试不能替代真实数据库和跨进程边界测试。
