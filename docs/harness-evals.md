# Harness 评测

这里的目标是用相同任务比较两次 Harness 改动，而不是只确认协议测试通过。
固定任务在 [`api/evals/cases.json`](../api/evals/cases.json)，评分读取真实的
`AgentRun / AgentEvent`，不启动另一套 Agent 循环，也不调用模型充当裁判。

## 两种验证的边界

- `pytest` 检查评分器、统计口径、素材和命令入口是否正确，CI 自动执行。
- 任务质量评测需要通过正常 Desktop / Mobile Runtime 运行任务，再对真实记录评分。
  真实模型可能随机失败，应使用相同模型、配置和素材重复试验。
- 修改正确性、是否真正等待用户、是否保留已有输出等要求由人验收。
  不传 `--review passed` 就不会报告任务通过；自动检查失败也不能被人工标记覆盖。

CI 的测试报告不是模型任务完成率。仓库不提供伪造的性能基线。

## 运行一次评测

以下命令均在 `api` 目录执行。使用本地开发数据库与测试工作区，确保 `api/.env`
指向实际运行 API 所用的数据库。评分只查询记录，不迁移、清理或修改业务数据。

列出任务：

```bash
uv run python -m evals list
```

准备一个独立临时目录：

```bash
uv run python -m evals prepare narrow-fix
```

命令会输出目录、需求、前置准备和人工验收标准。在客户端创建该目录对应的项目，
新建会话，按输出的需求执行。每个试验都重新 `prepare`，不要复用已被模型修改的目录。
源码素材和故障覆盖文件按用例声明的顺序复制，不改当前开发仓库。

Run ID 可从流的 `run.started.runId` 获取，也可在本地 Flask shell 中只读查询：

```bash
uv run flask --app manage:app shell
```

```python
from app.extensions import db
from app.models import AgentRun

for run in db.session.scalars(db.select(AgentRun).order_by(AgentRun.started_at.desc()).limit(10)):
    print(run.id, run.conversation_id, run.status, run.started_at)
```

运行结束后检查需求和验证结果，再评分。将 `RUN_UUID` 和工作区替换为真实值：

```bash
uv run python -m evals score narrow-fix --run-id RUN_UUID --label baseline-model-trial1 --workspace "临时工作区绝对路径" --review passed --output eval-results/before/narrow-fix.json
```

没有完成验收时省略 `--review`；验收不通过则传 `--review failed`。
用例涉及文件检查却未提供 `--workspace` 时，文件证据标为不可用，不会默认通过。
报告目录已加入 `.gitignore`。报告只保留 ID、标签、指标与检查结论，不导出凭据、
工具参数、工具正文、思考过程或回答原文。标签也不应填写秘密信息。

退出码：`0` 全部通过，`1` 有失败，`2` 证据或验收未完成（命令参数错误也返回 `2`）。

## 比较前后版本

改动后使用同一用例、模型和环境再次执行，在另一目录保存报告：

```bash
uv run python -m evals score narrow-fix --run-id NEW_RUN_UUID --label candidate-model-trial1 --workspace "新临时工作区绝对路径" --review passed --output eval-results/after/narrow-fix.json
uv run python -m evals compare --before eval-results/before/narrow-fix.json --after eval-results/after/narrow-fix.json
```

可在 `--before` 和 `--after` 后分别列出多份报告，每组每个用例一份，且两组用例必须一致。
每一轮重复试验分别对比，不把多次结果混为一个分数。报告包含需求及素材的摘要哈希；
任务要求、预算或素材发生变化时，拒绝直接比较。

输出包含通过数变化，以及逐用例的模型步数、工具调用、重复调用、耗时和 token 差值。
差值为“改动后减改动前”。先比较是否正确完成，再看成本，提前结束造成的少调用不算优化。

## 统计口径

| 指标 | 来源与含义 |
| --- | --- |
| `model_steps` | `context.prepared` 数量，即逻辑模型请求步数；不包含摘要请求和 SDK 内部重试 |
| `tool_calls` | `tool.requested` 中按工具名统计的实际调用数 |
| `repeated_calls` | 同一 Run 内，工具名与规范化参数完全相同的额外调用；不同 Agent 不互算重复 |
| `tool_failures` | 结果契约中的非空 `error`、MCP `isError: true` 或非零 `exitCode`，按调用 ID 配对 |
| `pending_tools` | 已请求但未记录结果的工具调用，不能直接等同于失败 |
| `compactions` | 已持久化的 `context.compacted` 数量，不把压缩开始算成功 |
| `input_tokens` / `output_tokens` | Run 已记录的真实用量；任何参与 Run 缺失用量时，合计显示 `null` |
| `run_duration_ms` | 各 Run 起止时间之差的合计；未结束的 Run 没有完整耗时 |
| `trace_complete` | 每个 Run 的事件序列完整，尚未被清理；不完整的日志不能得到通过结论 |

重复调用不一定无效：相同参数的终端读取可能是正常等待。因此各用例只对相关指标设预算，
不使用统一“重复一次就失败”的规则。预算集中写在用例数据中，不改变生产 Harness 的行为。
当前没有可靠的价格、缓存或摘要用量记录，不推算货币费用，也不把缺失用量写成零。
基线应使用统一请求准备入口之后产生的记录，以保证每个续跑请求都记录 `context.prepared`。

## 场景与前置条件

20 个任务覆盖：小修复、代码问答、分层指令、测试验证、保留用户改动、跨文件修改、文档、
长命令等待、交互终端、长驻终端、用户停止、失败重试、MCP 发现、缺失能力、Skill、任务内压缩、
结果引用、断线恢复、群聊等待用户和群聊移交。

- MCP 用例使用真实已配置服务，前后试验保持一致；没有服务时先准备环境，不用模拟成功替代。
- Skill 用例把 `api/evals/fixtures/skill/SKILL.md` 放在 ZIP 根目录后，通过现有 Skills 页面安装。
- 压缩用例先运行工作区的 `python make_records.py`。压缩比例、上下文长度按用例要求设置，
  其他用例保持相同模型配置。若模型的必需指令和工具定义本身超出所选窗口，应记录失败原因，
  不为得到通过结论而换掉任务要求。
- 停止、断网和终端交互通过正常客户端操作触发；不在产品中增加评测专用条件分支。
- 群聊用例使用 `--task-id TASK_UUID`，自动汇总该任务各成员的 Run。任务 ID 来自协作详情。
  前后试验保持团队提示词、模型和执行上限一致。
- 自动评分不会执行被评测工作区中的命令。需要实际运行测试、检查变更正确性时，按需求在
  客户端运行并人工验收，避免把模型自己的“已完成”当成正确性证据。

## 维护

新增任务只需添加用例数据和必要素材。指标统计、评分、报告对比和数据库读取分别位于
`api/evals/` 对应模块中，不向 Runtime 或 Flask 路由注入评测逻辑。

```bash
uv run ruff check app tests evals
uv run pytest
```

新增指标或调整预算时补上正反例；应覆盖缺失数据和真实失败，避免评分器总是给出通过。
CI 会保存 pytest 的 JUnit 结果；真实模型任务报告由评测命令生成，二者分开解释。
