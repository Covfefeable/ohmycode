# browser-use

`@ohmycode/browser-use` 封装 Electron 内置 Chromium 的浏览器视图、标签页及 Agent 工具。
无需系统 Chrome、Node、npx 或用户配置 MCP 服务，也不携带第二份 Electron。

## 分工

- 包内：`BrowserHost` 管理浏览器 Session、标签页、导航、页面级 CDP 和工具执行。
- Desktop：提供宿主窗口、窄 IPC、右侧面板和 Runtime 插件注册。
- Renderer：只传递面板边界与导航操作，不持有 CDP、工具执行或 Node 接口。
- Flask：沿用既有模型请求及工具结果协议，没有新增浏览器服务。

这是声明 `ohmycode.platform: "electron"` 的平台集成包，不供 Mobile 或平台无关 Runtime 引用。
它不导入任何应用目录，不访问 OhMyCode 的账号凭据。

```ts
import { BrowserHost, createBrowserPlugin } from "@ohmycode/browser-use";

const host = new BrowserHost(window, (conversationId, state) => publish(conversationId, state));
registry.register(createBrowserPlugin(host, conversationId, supportsVision));
host.layout(conversationId, { x: 600, y: 140, width: 600, height: 600 });
```

## 工具

| 工具 | 用途 |
| --- | --- |
| `browser_tabs` | 列出、新建、选择和关闭标签页 |
| `browser_navigate` | HTTP(S) 导航、前进、后退、刷新 |
| `browser_snapshot` | 获取页面文本、无障碍角色和可操作的 nodeId |
| `browser_act` | 元素/坐标点击、双击、右键、悬停、拖拽、填写/输入、组合键和双向滚动 |
| `browser_evaluate` | 执行网页 JavaScript，支持 Promise、提取数据及修改 DOM/样式 |
| `browser_upload` | 通过文件输入元素的 nodeId 设置本地文件，空数组清空选择 |
| `browser_download` | 发起下载、查询进度和文件路径、取消下载；包含点击链接产生的下载 |
| `browser_dialog` | 查看、接受或取消网页 alert/confirm/beforeunload 弹窗 |
| `browser_screenshot` | 返回图片结果，仅向多模态模型开放 |

Schema 与文件工具一样随模型请求的 `tools` 字段提前提供，不需要 search/load。
浏览器使用说明随工具 description 提供；网页内容不是系统指令。
同会话内工具操作按序执行，不同会话不共享标签页。同一页面可以由用户与 Agent 操作。

`browser_act` 的坐标使用网页视口 CSS 像素，不是桌面坐标；优先使用最新快照里的 nodeId。
组合键使用 `Control+a` / macOS 的 `Meta+a` 等形式。滚动可指定元素或视口位置，
便于操作内部滚动容器；拖拽通过真实鼠标按下、移动和释放实现。
脚本结果按值返回，超过 32,000 字符时返回截断预览；应缩小查询，而不是反复请求整页数据。
脚本和页面交互有 30 秒操作超时，支持 Runtime 的停止信号。
遇到网页弹窗时先返回弹窗信息，让模型调用 `browser_dialog`，不会等待弹窗导致工具队列死锁。
Electron 不实现 `prompt()`，不通过替换网页函数来模拟；此限制也写入工具描述。

上传必须使用绝对路径且目标是已有文件，只能上传用户授权给该网站的文件；
设置文件后网站可能自动上传。下载使用系统下载目录下的 `OhMyCode/<唯一ID>/`，
不覆盖已有文件，不自动执行下载内容。`start` 仅表示请求已发起，需查询到 `completed`
才代表成功；`failed`/`interrupted`/`cancelled` 均不应当报告为下载成功。
下载记录按会话隔离，关闭会话会取消未完成下载，已下载文件保留。

## 界面与生命周期

浏览器工具会展开所属会话的右侧面板。手动收起、切换页面或会话只隐藏原生视图，
不会销毁页面；回到会话可继续操作。删除会话、退出账号或关闭宿主时释放浏览器页面。
网页使用独立的持久 partition，不复用应用 Renderer 的存储；标签页列表不跨重启恢复。
应用弹窗打开时面板暂时隐藏原生网页，避免网页覆盖弹窗。隐藏时保留绘制能力，
后台 Agent 的截图不会因为用户切换页面而挂起。
首次截图要求该标签页曾在面板中展示，以初始化 Chromium 的渲染表面。
尚未展示过的后台新页会立即返回明确错误，仍可获取文本快照和执行页面操作，不等待截图超时。

网页没有 preload、Node 集成或 OhMyCode bridge，启用 context isolation、sandbox、web security。
只允许 HTTP(S) 和空白页；拒绝 file、javascript、data 和应用内部协议。
弹出网页作为受管理标签页打开。CDP 仅附着本包创建的网页，不开放远程调试端口，
不枚举或控制主应用 Renderer。

## 检查

```bash
pnpm --filter @ohmycode/tool-contracts build
pnpm --dir packages/browser-use typecheck
pnpm --dir packages/browser-use lint
pnpm --dir packages/browser-use test
```

`contracts.test.mjs` 检查 URL、边界与工具 schema；`electron.test.mjs` 使用真实 Electron、
本地 HTTP 站点和独立临时资料目录，验证导航、快照、填写/点击、截图、标签页、弹窗、
跨会话隔离、原生视图隐藏及释放。测试不访问外部网站或模型，不产生模型费用。

## 从实验到正式实现

初期用原版 Chrome DevTools MCP 连接独立 Electron 探针，发现 Electron 不支持其
`Target.createTarget`，隐藏窗口截图也有兼容问题。正式接入因此采用
`WebContentsView` + `webContents.debugger` 的页面级适配，未修改上游 MCP、未增加全局
CDP 兼容补丁。探针启动器、独立打包配置和审计脚本已移除。

本实现不是 Chrome DevTools MCP 全功能兼容层；暂不提供性能审计、扩展插件安装或系统原生菜单控制。
macOS arm64 使用相同 Electron API，但仍需在 Mac 上做真实交互验证。

参考：[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)、
[Debugger](https://www.electronjs.org/docs/latest/api/debugger)。
