# @ohmycode/android-use

本机 Android 设备集成，支持通过 ADB 连接真机、已有模拟器及内置模拟器。包不依赖桌面应用目录、React 或 Flask；使用 Node 进程和文件能力，声明为 Electron 平台包，不提供给 mobile。

## 设备选择

设置 → 实验室中刷新并选择当前设备。USB 手机需要开启 USB 调试并在手机上授权；Windows 可能需要厂商驱动。网络设备需先开启 ADB 网络调试，再填写地址和端口连接；仅支持已有可连接端点，不自动配置无线配对。

Agent 只操作设置中选择的设备，没有选择设备的工具参数。开始操作后由当前会话独占，使用期间不能切换；设备断线会报错，不自动换设备。外部设备只需 ADB，可单独安装 Platform Tools，无需下载系统镜像。内置模拟器是需手动选择的兜底方案。

外部设备的断开只释放 OhMyCode 的视频、控制及会话占用，不关闭手机、其他模拟器或共享 ADB。内置模拟器仍由应用管理完整生命周期。外部设备的视频与输入兼容性需要按设备实际验证，不能保证所有第三方模拟器可用。

## 当前范围

- 支持 Windows 和 macOS，检测本机 SDK 中的 Emulator、Platform Tools、原生 CPU 架构手机镜像和硬件加速。
- 内置模拟器只管理 OhMyCode 创建的一台 AVD，使用独立 ADB server 端口；外部设备使用共享 ADB 并显式指定 serial。
- 支持启动、停止、UI 层级、截图、点击、滑动、导航按键、ASCII 输入。中文输入尚不支持，不会悄悄转换或丢字。
- 截图使用现有 Runtime 图像结果结构；只有视觉模型能获得截图工具，文本模型可读取 UI 层级。
- 用户鼠标走独立的 scrcpy 控制通道，实时传递按下、每段移动轨迹和抬起，支持长按、拖动、曲线和绘图；失焦、取消、收起或切换窗口会释放按压。仅支持单指鼠标，不把复杂手势扩展为 Agent 工具。
- 工具仅在环境检查通过且用户启用后注册；执行时再次检查启用状态。关闭面板不停止设备，停止设备不删除应用数据。

## 安装和数据

支持从 Google 官方源按需安装，也可选择已有 SDK。安装前由用户明确确认许可，不自动代为接受；不镜像分发 SDK。默认检测 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 及系统常用 SDK 目录。

`install/manifest.ts` 固定 Emulator、Platform Tools、Android 15 基础镜像的版本、大小和官方 SHA-1 校验值（来自官方 SDK 仓库清单），不在安装时解析 latest。下载直接流式落盘，使用宿主注入的网络实现；桌面端注入 Electron `net.fetch` 以遵循系统代理。解压也使用流式处理，保留 Unix 可执行权限，不传播 Windows 只读属性；拒绝越界路径和外部符号链接。

安装器只替换带本应用组件凭据的目录，以临时目录校验、解压后原子发布单个组件，失败不会覆盖现有安装。重试复用已完成组件，未完成 ZIP 不做字节级断点续传。安装文件默认位于 `<userData>/android/sdk/`，自选位置则使用该位置的 `OhMyCodeAndroid/sdk/`；临时下载成功后清理。

桌面宿主保存本机设置到 `<userData>/android.json`，设备数据位于 `<userData>/android/avd/OhMyCode.avd/`，不修改 SDK 自带镜像或用户已有 AVD。设置不随账号同步。

Android 面板通过 scrcpy 3.3.4 的设备端服务输出 H.264，客户端使用 Chromium WebCodecs 解码，不使用截图轮询。首次打开画面从官方 GitHub Release 下载约 91KB 服务文件，验证固定 SHA-256 后缓存到 `<userData>/android/video/`，后续可离线使用；无需安装桌面版 scrcpy、Java 或 FFmpeg。该服务采用 Apache-2.0 许可，来源见 https://github.com/Genymobile/scrcpy/tree/v3.3.4 。

面板支持拖动左侧边界、切换独立窗口和返回面板，均操作同一台模拟器。隐藏面板或切换会话只关闭视频连接，不停止设备；Agent 截图工具独立按需执行。启动必须指定会话 ID，设备启动期间和运行期间均由该会话独占；所有 Android 工具检查所有权，其他会话不能读取、操作或关闭它。所属 Agent 关闭或用户点击面板底部关机按钮后释放占用；启动失败和设备异常退出也释放占用。首次启动最长等待约两分钟，可通过对话面板关机按钮取消。退出应用会先停止自有模拟器，再关闭自有 ADB server。

## 模块

`android_snapshot` 返回紧凑的结构化节点而非 XML，保留文字、resourceId、bounds 和状态。`parentId` 指向最近保留的祖先，`actionableParentId` 指向支持点击、长按、滚动或聚焦的祖先；ID 仅用于当前快照内关联，执行操作仍使用当前坐标。空布局被省略，大结果不在工具内部截断，由现有 `resultRef` 分页与检索读取。快照不能证明元素未被键盘或弹窗遮挡，必要时用截图核实。

操作说明要求按当前目标观察，不预先遍历所有应用；操作无变化时先诊断再重试，保存后回读，缺少必需应用时报告而不擅自换成其他数据写入位置。

- `environment.ts`：SDK 和加速能力检查。
- `android-host.ts`：目标连接、会话所有权及设备操作。
- `adb.ts`：设备发现、网络连接与目标参数。
- `managed-emulator.ts`：自有 AVD、模拟器进程及独立 ADB 生命周期。
- `command.ts`：受控子进程和 Android shell 输入转义。
- `snapshot.ts`：UI XML 解析、空布局过滤与操作祖先关联。
- `index.ts`：Runtime 工具插件。
- `install/`：固定版本清单、虚拟化预检、流式下载与解压、组件安装；不依赖 Electron UI。

模拟器真实启动、应用兼容性及 Windows/macOS 画面操作需要在安装 SDK 的设备上验收。单元测试不代替这部分验收。
