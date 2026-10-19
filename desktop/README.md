# OhMyCode Desktop

OhMyCode 桌面客户端基于 Electron、React、TypeScript 和 Vite 构建。Electron Main 中的
Desktop Runtime Host 负责运行 Agent、维护终端与本地工具状态；React Renderer 只负责界面展示
和用户交互，通过受限的 Preload/IPC 接口访问桌面能力。

## 主要能力

- OpenAI-compatible 模型的流式 Agent 对话
- 运行中消息默认排队，当前任务完成后逐条发送；支持引导当前任务和撤销回草稿
- 基于 Thread / Turn / Item 的事件记录、订阅与重放
- 持久 PTY 终端和跨平台文件工具
- Markdown、Monaco Diff、MCP、Skills 与上下文压缩
- 主持人调度的 Multi-Agent 群聊协作
- Windows 与 macOS 桌面安装包

普通对话运行时，待发送消息显示在输入框上方。点击“引导”后，要求会在下一次模型请求前
加入当前任务，不会强制终止正在执行的工具。停止或失败后队列暂停，需手动继续发送；
重启客户端后也不会自动启动遗留任务。队列按账号、服务地址和会话隔离保存在本机。

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

## 会话搜索

左侧搜索会话后，点击正文命中的结果会定位到对应消息；仅标题命中时正常打开会话。
在聊天页按 `Ctrl+F`（macOS 为 `Cmd+F`）或点击标题旁的搜索图标，可搜索当前会话已保存的
消息正文，包括尚未加载的历史和代码。`Enter` 查找下一条匹配消息，`Shift+Enter` 查找上一条，
`Escape` 关闭搜索栏。计数以消息为单位，同一条消息内的多个命中一起高亮。

定位时只加载目标附近的历史，可以向前翻页或加载较新消息；点击“返回最新消息”恢复实时视图。
搜索期间后台任务继续运行。尚未落库的流式片段在本轮保存后可被搜索。

## 语音输入与朗读

在“设置 → 语音配置”填写阿里云百炼北京地域的业务空间 ID、API Key 和音色 ID。
一期采用 `qwen-audio-3.1-asr-flash-message` 实时识别和 `qwen-audio-3.1-tts-flash`
流式合成，默认音色为 `longanhuan_v3.1`。账号需具备相应模型的调用权限。

- 点击发送按钮左侧的麦克风开始输入，识别文字实时显示；再次点击结束后可编辑、发送。
- 聊天标题右侧、搜索图标左侧的喇叭切换自动朗读，默认关闭，开关按账号保存。
- 可点击助手消息操作栏的喇叭手动朗读，再次点击停止。
- 朗读包含处理步骤中的自然语言和最终回答，不包含思考、工具原始输出、代码块或图片。
- 录音期间暂停自动朗读，避免扬声器声音被识别。停止朗读不会停止 Agent 任务。

凭据加密保存在服务端，页面只得到是否已配置的标记。Electron 主进程使用凭据连接百炼
WebSocket，Renderer 仅采集麦克风和播放音频。关闭窗口或退出账号会释放语音连接。
升级服务端时需执行数据库迁移，新增 `speech_settings` 和 `speech_voices` 表。
语音调用及音色复刻另计供应商费用；当前仅桌面端提供语音界面。

音色下拉框提供默认音色，以及乔小娇、白清岚、龙安洋、安迪四款内置音色。
点击“音色 ID”旁的加号可创建自定义音色，填写名称、公网参考音频
URL、语言和降噪选项，并确认已获得声音使用授权。参考音频由百炼读取，不会自动上传本地文件。
自定义音色记录保存在服务端的 `speech_voices` 表，按账号、业务空间和目标模型隔离。
创建后自动检查审核状态，通过后可选择该音色，再点击页头“保存”用于后续朗读。

## 验证

```bash
pnpm --dir desktop test:runtime
pnpm --dir desktop test:file-tools
pnpm --dir desktop test:ui
pnpm --dir desktop exec playwright install chromium
pnpm --dir desktop test:browser
pnpm --dir desktop typecheck
pnpm --dir desktop lint
pnpm --dir desktop build
```

涉及 Runtime、IPC、终端或文件工具的修改，应运行对应专项测试和完整构建。
组件测试覆盖输入、禁用状态、弹层交互与 Markdown 原文保真；测试边界和 CI 说明见
[自动化测试](../docs/testing.md)。

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
