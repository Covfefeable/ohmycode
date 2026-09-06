# OhMyCode Mobile

OhMyCode 移动端基于 Expo 和 React Native 构建，提供登录、注册、模型配置和基础 Agent 对话。
它与桌面端复用协议、Agent Runtime 契约、工具定义和 Design Token；网络传输、安全存储与设备
行为仍由移动端适配器独立实现。

## 目录结构

```text
src/app/             Expo Router 路由与导航边界
src/features/        认证、聊天和设置功能
src/shared/api/      API 与流式传输适配
src/shared/capabilities/  移动端允许使用的 Agent 能力
src/shared/i18n/     国际化资源
src/shared/theme/    Design Token 与主题适配
src/shared/ui/       通用移动端组件
```

Expo Router 路由文件只负责页面入口和导航，业务状态与 UI 放在 `src/features/`，原生存储、传输
和设备行为放在 `src/shared/` 适配器中。

## 开发

从仓库根目录安装依赖并启动 Expo：

```bash
pnpm install --frozen-lockfile
pnpm --filter @ohmycode/mobile start
```

也可以按目标平台启动：

```bash
pnpm --filter @ohmycode/mobile android
pnpm --filter @ohmycode/mobile ios
pnpm --filter @ohmycode/mobile web
```

开发模式会从 Expo 开发服务器地址推导电脑的局域网 IP，并使用 `8765` 端口连接 API。可通过
`EXPO_PUBLIC_API_URL` 显式覆盖：

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:8765 pnpm --filter @ohmycode/mobile start
```

使用真机调试时：

- API 必须监听 `0.0.0.0`，不能只监听 `127.0.0.1`。
- 手机与开发电脑应处于同一网络。
- `127.0.0.1` 指向手机自身，应改为开发电脑的局域网 IP。
- 确保系统防火墙允许手机访问 API 端口。

需要清理 Metro 缓存时执行：

```bash
pnpm --dir mobile exec expo start --clear
```

## 能力边界

- 不提供桌面文件附件、文件系统工具、持久终端或任意命令执行。
- 认证 Token 使用 Expo SecureStore 保存，不写入普通本地存储。
- 页面样式使用共享的 `@ohmycode/design-tokens`。
- 移动端只注册明确实现且适合移动设备的 Agent 工具，能力不可用时默认拒绝。
- 平台适配器可以依赖共享包，共享包不得反向依赖 Expo 或应用代码。
- HTTP MCP 与 Skills 必须经过移动端 Runtime Registry，不复制 Electron IPC 或 Node API。

## 界面规范

- 所有用户可见文本使用 react-i18next locale key。
- 组件专属样式与组件放在同一目录，以 `*.styles.ts` 命名。
- 同时支持明暗主题、安全区域、键盘避让和无障碍点击尺寸。
- 优先复用共享 Design Token，不散落硬编码主题颜色和间距。

## 验证

```bash
pnpm --filter @ohmycode/mobile typecheck
pnpm --filter @ohmycode/mobile lint
pnpm --filter @ohmycode/mobile exec expo install --check
```

完整仓库架构、API 启动和服务端部署方式见根目录 [README](../README.md)。
