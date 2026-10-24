import { beforeEach, expect, it, vi } from "vitest";
import { createAndroidPlugin, AndroidHost } from "../../../packages/android-use/src/index";
import { actionArguments } from "../../../packages/android-use/src/command";
import { listDevices, networkAddress } from "../../../packages/android-use/src/adb";
import { compactSnapshot } from "../../../packages/android-use/src/snapshot";
import type { ToolCall } from "@ohmycode/tool-contracts";

const host = new AndroidHost("/test-data", vi.fn());
const environment = { sdkPath: "/sdk", emulator: "/sdk/emulator", adb: "/sdk/adb", imagePath: "/sdk/image", imageName: "android-35/default/x86_64" };
const call = (tool: string, args: unknown = {}): ToolCall => ({ tool, arguments: args, callId: "call", runId: "turn" });

it("设备发现保留授权和离线状态，网络地址不能注入参数", async () => {
  const run = vi.fn().mockResolvedValue(Buffer.from("List of devices attached\nusb-one device usb:1-2 model:Pixel_9 transport_id:1\n127.0.0.1:5555 offline\nphone unauthorized\n"));
  expect(await listDevices("adb", run)).toEqual([
    { serial: "usb-one", name: "Pixel 9", status: "device", transport: "usb" },
    { serial: "127.0.0.1:5555", name: "127.0.0.1:5555", status: "offline", transport: "network" },
    { serial: "phone", name: "phone", status: "unauthorized", transport: "local" },
  ]);
  expect(networkAddress(" [::1]:5555 ")).toBe("[::1]:5555");
  for (const value of ["host", "host:0", "host:65536", "host:5555 --help", "host:5555;stop"]) expect(() => networkAddress(value)).toThrow("android_invalid_address");
});

it("快照压缩去掉空布局，但保留可操作祖先、禁用状态与解码后的文本", () => {
  const xml = `<hierarchy rotation="1"><node class="Layout" bounds="[0,0][800,600]" package="example">
    <node class="Row" clickable="true" bounds="[0,0][300,100]" enabled="false">
      <node class="Wrapper"><node class="Text" text="保存 &amp; &#x8FD4;&#22238;" resource-id="example:id/save" bounds="[10,10][200,80]"/></node>
    </node><node class="Input" focusable="true" focused="true" password="true" content-desc="密码" bounds="[0,100][300,200]"/>
  </node></hierarchy>`;
  const snapshot = compactSnapshot(xml);
  expect(snapshot.rotation).toBe(1);
  expect(snapshot.packages).toEqual(["example"]);
  expect(snapshot.nodes).toHaveLength(3);
  const [row, label, input] = snapshot.nodes;
  expect(row).toMatchObject({ clickable: true, enabled: false, bounds: "[0,0][300,100]" });
  expect(label).toMatchObject({ text: "保存 & 返回", resourceId: "example:id/save", parentId: row.id, actionableParentId: row.id });
  expect(input).toMatchObject({ focusable: true, focused: true, password: true, description: "密码" });
  expect(label).not.toHaveProperty("enabled");
  expect(label).not.toHaveProperty("editable");
  expect(JSON.stringify(snapshot).length).toBeLessThan(xml.length);
});

it("快照保留开关和禁用状态，省略默认启用与未知编辑能力", () => {
  const nodes = compactSnapshot(`<hierarchy>
    <node text="主题" checkable="true" checked="false" enabled="true"/>
    <node text="主题" checkable="true" checked="true" enabled="false"/>
    <node class="android.widget.EditText" resource-id="search" enabled="true" password="false"/>
    <node resource-id="editable" editable="true" enabled="true"/>
    <node text="说明" editable="false" enabled="true"/>
  </hierarchy>`).nodes;
  expect(nodes).toHaveLength(5);
  expect(nodes[0]).toMatchObject({ checked: false });
  expect(nodes[1]).toMatchObject({ checked: true, enabled: false });
  expect(nodes.every((node, index) => index === 1 || !Object.hasOwn(node, "enabled"))).toBe(true);
  expect(nodes[2]).not.toHaveProperty("editable");
  expect(nodes[2]).not.toHaveProperty("checked");
  expect(nodes[3]).toMatchObject({ editable: true });
  expect(nodes[4]).toMatchObject({ editable: false });
});

it("大快照不在工具内部截断，畸形 XML 不伪装成空页面", () => {
  const xml = `<hierarchy>${Array.from({ length: 1000 }, (_, index) => `<node text="条目 ${index}" resource-id="id-${index}" bounds="[0,0][100,100]"/>`).join("")}</hierarchy>`;
  expect(compactSnapshot(xml).nodes.at(-1)).toMatchObject({ text: "条目 999" });
  expect(() => compactSnapshot("<hierarchy><node></hierarchy>")).toThrow();
  expect(() => compactSnapshot("<not-a-hierarchy/>")).toThrow("android_invalid_snapshot");
});
beforeEach(() => { host.configure({ enabled: false, sdkPath: "", target: { kind: "managed" }, devices: [] }); });

it("未安装或未启用时无 Android 工具，也无法直接调用", async () => {
  let plugin = createAndroidPlugin(host, "thread", true);
  expect(plugin.definitions()).toEqual([]);
  await expect(plugin.execute(call("android_device", { action: "start" }))).rejects.toThrow("android_not_available");
  host.configure({ enabled: true, sdkPath: "/sdk", target: { kind: "managed" }, devices: [] });
  plugin = createAndroidPlugin(host, "thread", true);
  expect(plugin.definitions()).toEqual([]);
  host.configure({ enabled: false, sdkPath: "/sdk", environment, target: { kind: "managed" }, devices: [] });
  expect(createAndroidPlugin(host, "thread", true).definitions()).toEqual([]);
});
it("安装并启用后注册工具，截图只提供给视觉模型", () => {
  host.configure({ enabled: true, sdkPath: "/sdk", environment, target: { kind: "managed" }, devices: [] });
  expect(createAndroidPlugin(host, "thread", true).definitions().map((item) => item.name)).toEqual(["android_device", "android_snapshot", "android_screenshot", "android_act"]);
  expect(createAndroidPlugin(host, "thread", false).handles("android_screenshot")).toBe(false);
});
it("截图工具透传可选延迟，未填写时保持立即截图", async () => {
  host.configure({ enabled: true, sdkPath: "/sdk", environment, target: { kind: "managed" }, devices: [] });
  const screenshot = vi.spyOn(host, "screenshot").mockResolvedValue({} as Awaited<ReturnType<AndroidHost["screenshot"]>>);
  try {
    const plugin = createAndroidPlugin(host, "thread", true);
    await plugin.execute(call("android_screenshot", { delayMs: 800 }));
    expect(screenshot).toHaveBeenLastCalledWith("thread", undefined, 800);
    await plugin.execute(call("android_screenshot"));
    expect(screenshot).toHaveBeenLastCalledWith("thread", undefined, undefined);
  } finally { screenshot.mockRestore(); }
});
it("注册后停用也立即阻止调用和后续工具快照", async () => {
  host.configure({ enabled: true, sdkPath: "/sdk", environment, target: { kind: "managed" }, devices: [] });
  const plugin = createAndroidPlugin(host, "thread", true);
  host.configure({ enabled: false, sdkPath: "/sdk", environment, target: { kind: "managed" }, devices: [] });
  expect(plugin.definitions()).toEqual([]);
  await expect(plugin.execute(call("android_snapshot"))).rejects.toThrow("android_not_available");
});
it("Android 导航保持窄接口，不允许任意 shell 命令", () => {
  expect(actionArguments({ action: "key", key: "home" })).toEqual(["shell", "input", "keyevent", "KEYCODE_HOME"]);
  expect(() => actionArguments({ action: "key", key: "HOME; rm -rf /" })).toThrow("android_invalid_key");
  expect(() => actionArguments({ action: "shell", command: "ls" })).toThrow("android_invalid_action");
  expect(() => actionArguments({ action: "tap", x: NaN, y: 1 })).toThrow("android_invalid_coordinates");
});
it("文本操作不再走 shell 输入旧路径", () => {
  expect(() => actionArguments({ action: "text", text: "中文" })).toThrow("android_invalid_action");
});
it("停止信号不执行后续设备操作，未启动不读取或操作设备", async () => {
  host.configure({ enabled: true, sdkPath: "/sdk", environment, target: { kind: "managed" }, devices: [] });
  const controller = new AbortController();
  controller.abort();
  await expect(createAndroidPlugin(host, "thread", true, controller.signal).execute(call("android_act", { action: "key", key: "home" }))).rejects.toThrow();
  await expect(host.screenshot("thread")).rejects.toThrow("android_not_running");
  await expect(host.snapshot("thread")).rejects.toThrow("android_not_running");
  await expect(host.act("thread", { action: "key", key: "home" })).rejects.toThrow("android_not_running");
});
