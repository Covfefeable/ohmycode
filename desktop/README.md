# OhMyCode Desktop

OhMyCode 桌面客户端基于 Electron、React、TypeScript 和 Vite 构建。Electron Main 中的
Desktop Runtime Host 负责运行 Agent、维护终端与本地工具状态；React Renderer 只负责界面展示
和用户交互，通过受限的 Preload/IPC 接口访问桌面能力。

## 主要能力

- OpenAI-compatible 模型的流式 Agent 对话
- 基于 Thread / Turn / Item 的事件记录、订阅与重放
- 持久 PTY 终端和跨平台文件工具
- Markdown、Monaco Diff、MCP、Skills 与上下文压缩
- 主持人调度的 Multi-Agent 群聊协作
- Windows 与 macOS 桌面安装包

## 目录结构

```text
electron/
  api/              Flask API 客户端
  capabilities/     MCP 与 Skill 的本地加载和执行
  files/            文件工具与图片查看
  ipc/              Renderer 可访问的窄 IPC 接口
  runtime/          Desktop Runtime Host、事件存储和工具插件
  terminal/         持久 PTY 终端管理
  window/           Electron 窗口创建与平台行为

src/
  app/              应用入口、路由与全局样式
  pages/            页面组合
  widgets/          页面级复合区域
  features/         独立业务功能
  shared/           通用 UI、国际化、布局与基础工具
```

平台无关的 Runtime、协议、工具契约和 Design Token 位于仓库根目录的 `packages/`，桌面端
通过 workspace 依赖复用。共享包不得反向依赖 Electron 或 `desktop/`。

## 开发

前置要求：Node.js 22+、pnpm，以及已经运行且版本兼容的 OhMyCode API。

从仓库根目录安装依赖：

```bash
pnpm install --frozen-lockfile
```

开发环境默认连接 `http://127.0.0.1:8765`。如需临时覆盖，在启动 Electron 的同一终端设置
`OHMYCODE_API_URL`：

```bash
OHMYCODE_API_URL=http://127.0.0.1:8765 pnpm --dir desktop dev
```

Windows PowerShell：

```powershell
$env:OHMYCODE_API_URL = "http://127.0.0.1:8765"
pnpm --dir desktop dev
```

桌面端不会在 API 不可用时自行启动 Flask。打包版本还可以通过隐藏调试面板保存运行时 API
地址，该配置写入 Electron 用户数据目录，不进入仓库。

启动 Vite 和 Electron：

```bash
pnpm --dir desktop dev
```

## 验证

```bash
pnpm --dir desktop test:runtime
pnpm --dir desktop test:file-tools
pnpm --dir desktop typecheck
pnpm --dir desktop lint
pnpm --dir desktop build
```

涉及 Runtime、IPC、终端或文件工具的修改，应运行对应专项测试和完整构建。

## 打包

客户端包含 `node-pty` 原生模块，应在目标操作系统上安装依赖并打包，不要跨系统复制
`node_modules`。

Windows x64：

```powershell
pnpm --dir desktop dist:win
```

产物位于 `desktop/release/OhMyCode-Setup-<version>-x64.exe`。

macOS Apple Silicon：

```bash
pnpm --dir desktop dist:mac
```

产物位于 `desktop/release/OhMyCode-Setup-<version>-arm64.dmg`。

当前安装包尚未配置 Windows 代码签名或 Apple Developer ID 签名与公证。正式分发前应配置
平台证书，且不得将证书、密码或发布凭据提交到仓库。

## 开发约束

- Renderer 不得直接访问 Node API 或执行操作系统命令。
- 本地工具必须注册到 Runtime，并通过受限 IPC 暴露状态和操作。
- 用户可见文本必须使用 react-i18next locale key。
- 组件及其专属 CSS Module 应位于同一目录。
- 复用 `desktop/src/app/tokens.css` 中的 Design Token，不在组件中重复定义主题值。
- 同时支持 Windows 与 macOS 的路径、Shell 和文件管理器行为。

完整仓库架构和部署方式见根目录 [README](../README.md) 与
[架构文档](../docs/architecture.md)。
