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
- 内置浏览器工具及聊天右侧浏览器面板，用户与 Agent 操作同一页面，无需外部 Chrome
- Windows 与 macOS 桌面安装包

浏览器快照过滤空结构容器与重复内联文字，保留可交互元素、状态和 DOM 节点编号。`browser_snapshot` 可传 `nodeId` 限定子树、`query` 筛选文字/角色/值；大结果由现有工具结果存储分页、检索，不再在 500 个节点处直接丢弃后续内容。操作策略以最少必要观察推进，无变化先检查目标、遮挡和加载状态，写入后回读验证。

普通对话运行时，待发送消息显示在输入框上方。点击“引导”后，要求会在下一次模型请求前
加入当前任务，不会强制终止正在执行的工具。停止或失败后队列暂停，需手动继续发送；
重启客户端后也不会自动启动遗留任务。队列按账号、服务地址和会话隔离保存在本机。

## 目录结构

```text
electron/
  browser/          browser-use 包的宿主适配与状态发布
  api/              Flask API 客户端
  capabilities/     MCP 与 Skill 的本地加载和执行
  conversations/    会话消息提交、排队决策与传输
  files/            文件工具、路径打开、粘贴图片与图片预览
  ipc/              按 API、文件、窗口和业务领域注册窄 IPC 接口
  runtime/          Desktop Runtime Host、事件存储和工具插件
  terminal/         持久 PTY 终端管理
  speech/           语音连接、任务及窗口实例生命周期
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

IPC 注册模块只负责通道绑定和参数转交，不持有语音实例等长生命周期资源，也不决定消息是否排队。
语音实例由 `speech-host` 按窗口维护，退出和注销直接调用领域模块；会话操作由 `conversation-actions` 编排。
图片预览属于 `files`，不再依赖 Runtime 作为界面资源查询入口。

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

在会话中键入 `ohmycodedebug`，点击“查看当前会话上下文”可检查最近一次真实模型请求。
窗口固定到触发调试时的会话，提供消息上下文、工具 Schema 和完整请求三个视图，支持
Monaco 搜索、折叠、复制及手动刷新，并显示本次请求模型、token 用量、缓存命中和压缩情况。
每个会话仅保留最新快照，图片 Base64 会省略，不采集请求凭据；读取快照不会触发模型或压缩。
旧请求不会重建快照，更新后发送新消息或执行下一次工具请求才会生成。快照包含会话内容，请勿随意分享。

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
- 聊天标题右侧、搜索图标左侧的音浪按钮切换聊天模式，默认关闭，开关按账号保存。
- 可点击助手消息操作栏的喇叭手动朗读，再次点击停止。
- 朗读包含处理步骤中的自然语言和最终回答，不包含思考、工具原始输出、代码块或图片。
- 普通输入框的录音期间暂停朗读。停止朗读不会停止 Agent 任务。
- 录音中可直接点击发送，客户端会结束识别并等待最后一段文字后提交；识别失败时保留草稿，不自动发送残缺文字。

聊天标题栏的“聊天模式”将底部输入框切换为 Lottie 语音球，不显示识别文字或额外操作按钮。
说话和朗读时球随真实音量缩放；停顿等待发送时收缩、呼吸并降至半速播放，处理期间轻微呼吸。
收到句末识别结果后等待约 1.2 秒自动发送，继续发声或新的中间结果会推迟发送。
此模式持续保留麦克风和识别连接，模型回答会自动朗读；新的有效语音会停止本轮朗读，
提交新语音时若上一轮仍在执行，会先走现有停止流程再提交。再次点击标题栏按钮退出聊天模式。
中间识别结果需同时满足持续发声条件才能打断；最终识别结果不受本地音量门槛阻挡。
退出模式、切换会话或离开页面会释放麦克风；识别/发送失败不自动重试。
关闭模式后恢复原文字草稿。聊天模式复用服务端现有 `autoPlay` 偏好，不新增数据库字段。
服务端只对开启模式的普通会话追加简洁、口语化的输出要求，不改变工具协议或生成文件的内容。
持续开麦依赖系统回声消除，扬声器环境仍可能出现回声误识别，建议使用耳机验证打断效果。

凭据加密保存在服务端，页面只得到是否已配置的标记。Electron 主进程使用凭据连接百炼
WebSocket，Renderer 仅采集麦克风和播放音频。关闭窗口或退出账号会释放语音连接。
升级服务端时需执行数据库迁移，新增 `speech_settings` 和 `speech_voices` 表。
语音调用及音色复刻另计供应商费用；当前仅桌面端提供语音界面。

音色下拉框提供默认音色，以及乔小娇、白清岚、龙安洋、安迪四款内置音色。
点击“音色 ID”旁的加号可创建自定义音色，填写名称，选择中文或英文，
朗读示例文字录制 10–30 秒；可试听、重录，满 30 秒自动停止。
确认声音使用授权后创建，客户端将 WAV 录音上传到服务端，由百炼通过短期签名链接读取。
录音不会在点击创建之前上传，创建失败时仍可试听并重试。
自定义音色记录保存在服务端的 `speech_voices` 表，按账号、业务空间和目标模型隔离。
创建后自动检查审核状态，通过后可选择该音色，再点击页头“保存”用于后续朗读。

## 实验室：本机 Android

在“设置 → 实验室”点击“立即安装”，确认组件、安装位置和 Android SDK 许可后，自动从 Google 官方源下载、校验并解压 Emulator、Platform Tools（ADB）和 Android 15 基础镜像。Windows 使用 x86_64 镜像，Mac M 系列使用 arm64-v8a 镜像；首次下载约 1.2–1.3GB，安装前要求至少 15GiB 可用空间。无需 Android Studio、Java 或 Docker。

安装进度由主进程管理，切换页面不会中断。支持取消和失败重试，已完整安装的同版本组件会复用；不支持未完成压缩包的字节级断点续传。下载使用系统网络设置，不切换到第三方镜像。系统硬件虚拟化仍需用户开启：不会自动提权、启用 Windows 功能或修改 BIOS。

环境检查通过并启用后，会话标题栏的浏览器图标旁显示 Android 图标，Runtime 才会提供 Android 工具。截图工具仅向视觉模型开放。模拟器只能从对话面板或 Agent 工具启动，启动时按会话独占；其他会话调用 Android 工具会报占用错误，直到所属会话关闭设备或用户点击面板底部关机按钮。实验室只管理环境安装和配置，运行期间不能更换 SDK 或停用。右侧面板使用 H.264 视频流，支持左侧拖动调整宽度、独立窗口与返回面板，以及点击、滑动、导航和 ASCII 输入；当前不支持中文输入。首次打开画面会从官方 GitHub Release 下载并校验约 91KB 的 scrcpy 设备端服务，后续使用本机缓存，不需要另装桌面版 scrcpy。

设备设置和数据仅保存在当前电脑：`<userData>/android.json` 与 `<userData>/android/avd/`。停止保留设备数据，退出应用会停止自有模拟器和独立 ADB server，不操作用户其他模拟器。

默认运行环境保存在 `<userData>/android/sdk/`，也可选择其他位置（创建 `OhMyCodeAndroid` 子目录）；临时下载位于同级 `downloads/`。原始 ZIP 在组件安装成功后清理。原有 SDK 选择入口保留，安装器不会覆盖非 OhMyCode 管理的 SDK。正式公开分发前仍需确认 SDK 的适用许可，用户确认许可不等于取得再分发权。包结构和限制见 [android-use](../packages/android-use/README.md)。

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
pnpm --dir desktop test:electron
```

涉及 Runtime、IPC、终端或文件工具的修改，应运行对应专项测试和完整构建。
`test:electron` 在构建后运行，使用真实 Electron 检查浏览器独立窗口、返回面板、窗口清理以及 Android 的 preload/IPC 与未安装环境隔离，无需启动 API。
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

macOS（Apple Silicon 和 Intel）：

```bash
pnpm --dir desktop dist:mac
```

生成两个 DMG：`desktop/release/OhMyCode-Setup-<version>-arm64.dmg`（M1/M2 等）和
`desktop/release/OhMyCode-Setup-<version>-x64.dmg`（Intel x86_64）。正式包由
`.github/workflows/release.yml` 构建并发布，不再保留临时 macOS 测试工作流。

当前安装包尚未配置 Windows 代码签名或 Apple Developer ID 签名与公证。正式分发前应配置
平台证书，且不得将证书、密码或发布凭据提交到仓库。

### macOS 首次打开提示“已损坏”

仅对从本仓库 Release 下载、已核对 SHA-256 的安装包执行以下操作。先将应用拖入
“应用程序”，然后在终端执行：

```bash
xattr -dr com.apple.quarantine "/Applications/OhMyCode.app"
```

该命令仅移除 OhMyCode 的隔离属性，不关闭系统全局安全检查。如果应用安装在其他位置，
请替换为实际路径；若提示权限不足，可为同一命令加上 `sudo`。若仍无法打开，请重新核对
校验和并下载，不要对整个下载目录或系统目录执行此命令。

## 开发约束

- Renderer 不得直接访问 Node API 或执行操作系统命令。
- 本地工具必须注册到 Runtime，并通过受限 IPC 暴露状态和操作。
- 用户可见文本必须使用 react-i18next locale key。
- 组件及其专属 CSS Module 应位于同一目录。
- 复用 `desktop/src/app/tokens.css` 中的 Design Token，不在组件中重复定义主题值。
- 同时支持 Windows 与 macOS 的路径、Shell 和文件管理器行为。

完整仓库架构和部署方式见根目录 [README](../README.md) 与
[架构文档](../docs/architecture.md)。
