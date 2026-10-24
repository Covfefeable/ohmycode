import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AndroidHost } from "../../../packages/android-use/src/android-host";
import { actionArguments } from "../../../packages/android-use/src/command";
import { createAndroidPlugin } from "../../../packages/android-use/src/index";
import { ToolRegistry } from "../../../packages/agent-runtime/src/tool-registry";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), run: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn() }));
const automation = vi.hoisted(() => ({ controller: new AbortController(), start: vi.fn(), close: vi.fn(), act: vi.fn(), snapshot: vi.fn(), screen: vi.fn(), invalidate: vi.fn() }));
vi.mock("../../../packages/android-use/src/automation/automation", () => ({ AndroidAutomation: class {
  get signal() { return automation.controller.signal; }
  start = automation.start; close = automation.close; act = automation.act; snapshot = automation.snapshot; screen = automation.screen; invalidate = automation.invalidate;
} }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile }));
vi.mock("../../../packages/android-use/src/command", async (original) => ({ ...await original<object>(), runCommand: mocks.run }));

const environment = { sdkPath: "/sdk", emulator: "/sdk/emulator", adb: "/sdk/adb", imagePath: "/sdk/image", imageName: "android-35/default/x86_64" };
class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn(() => { this.exitCode = 0; this.emit("exit", 0); return true; });
}
let child: FakeChild;
let host: AndroidHost;
beforeEach(() => {
  vi.clearAllMocks();
  automation.controller = new AbortController();
  automation.start.mockResolvedValue(undefined);
  automation.close.mockImplementation(async () => { automation.controller.abort(); });
  automation.act.mockImplementation(async (args, shell) => { await shell(actionArguments(args)); return { executed: true }; });
  child = new FakeChild();
  mocks.spawn.mockReturnValue(child);
  mocks.run.mockImplementation(async (_file: string, args: string[]) => {
    if (args.includes("getprop")) return Buffer.from("1\n");
    if (args.includes("kill")) child.kill();
    return Buffer.alloc(0);
  });
  host = new AndroidHost("/managed-android", vi.fn());
  host.configure({ enabled: true, sdkPath: "/sdk", environment, target: { kind: "managed" }, devices: [] });
});
afterEach(async () => { await host.close(); vi.useRealTimers(); });

it("本轮结束后三分钟释放设备，期间保持独占，新一轮取消旧计时", async () => {
  await host.start("owner");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const other = new ToolRegistry();
  other.register(createAndroidPlugin(host, "other", true));
  await other.close();
  expect(host.state().ownerConversationId).toBe("owner");
  await expect(host.openVideo("other", "/video.jar", vi.fn(), vi.fn(), new AbortController().signal)).rejects.toThrow("android_in_use_by_another_conversation");
  const owner = new ToolRegistry();
  owner.register(createAndroidPlugin(host, "owner", true));
  await owner.close();
  await vi.advanceTimersByTimeAsync(179_999);
  expect(host.state().phase).toBe("running");
  expect(() => host.assertAccess("other")).toThrow("android_in_use_by_another_conversation");
  const next = new ToolRegistry();
  next.register(createAndroidPlugin(host, "owner", true));
  await vi.advanceTimersByTimeAsync(180_000);
  expect(host.state().phase).toBe("running");
  await next.close();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(host.state().phase).toBe("stopped");
  expect(host.state().ownerConversationId).toBeUndefined();
  expect(automation.close).toHaveBeenCalledOnce();
});

it("手动停止立即关闭设备并取消延迟释放，不影响之后的新连接", async () => {
  await host.start("owner");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await host.releaseFor("owner");
  await host.stopFor("owner");
  expect(host.state().phase).toBe("stopped");
  child = new FakeChild();
  mocks.spawn.mockReturnValue(child);
  await host.start("other");
  await vi.advanceTimersByTimeAsync(180_000);
  expect(host.state()).toMatchObject({ phase: "running", ownerConversationId: "other" });
});

it("移除选中设备后没有默认目标，不会启动内置模拟器", async () => {
  host.configure({ enabled: true, sdkPath: "/sdk", adb: environment.adb, environment, target: { kind: "none" }, devices: [] });
  expect(host.available).toBe(false);
  await expect(host.start("thread")).rejects.toThrow("android_not_available");
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("外部设备只使用设置中的目标，断开不关闭设备或共享 ADB", async () => {
  mocks.run.mockImplementation(async (_file: string, args: string[]) => {
    if (args[0] === "devices") return Buffer.from("List of devices attached\nphone-a device model:Phone_A\nphone-b device model:Phone_B\n");
    return Buffer.alloc(0);
  });
  host.configure({ enabled: true, sdkPath: "/sdk", adb: environment.adb, target: { kind: "external", serial: "phone-b", name: "Phone B" }, devices: [] });
  await host.start("thread");
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(() => host.configure({ enabled: true, sdkPath: "/sdk", target: { kind: "managed" }, devices: [] })).toThrow("android_stop_before_configure");
  await host.act("thread", { action: "key", key: "home" });
  expect(mocks.run).toHaveBeenLastCalledWith(environment.adb, ["-s", "phone-b", "shell", "input", "keyevent", "KEYCODE_HOME"], undefined);
  await host.stop();
  expect(mocks.run.mock.calls.some(([, args]) => args.includes("kill-server") || args.includes("emu") || args.includes("disconnect"))).toBe(false);
});

it("设置中的设备未授权时不回退到其他在线设备", async () => {
  mocks.run.mockResolvedValue(Buffer.from("phone-a device\nphone-b unauthorized\n"));
  host.configure({ enabled: true, sdkPath: "/sdk", adb: environment.adb, target: { kind: "external", serial: "phone-b", name: "Phone B" }, devices: [] });
  await expect(host.start("thread")).rejects.toThrow("android_device_unauthorized");
  expect(host.state()).toMatchObject({ phase: "error", target: { serial: "phone-b" } });
  expect(host.state().ownerConversationId).toBeUndefined();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("外部设备掉线释放会话占用，不切换目标或继续执行", async () => {
  mocks.run.mockImplementation(async (_file: string, args: string[]) => {
    if (args[0] === "devices") return Buffer.from("phone device\nother device\n");
    throw new Error("device offline");
  });
  host.configure({ enabled: true, sdkPath: "/sdk", adb: environment.adb, target: { kind: "external", serial: "phone", name: "Phone" }, devices: [] });
  await host.start("thread");
  await vi.waitFor(() => expect(host.state().phase).toBe("error"), { timeout: 4500 });
  expect(host.state()).toMatchObject({ error: "android_device_offline", target: { serial: "phone" } });
  expect(host.state().ownerConversationId).toBeUndefined();
  await expect(host.act("thread", { action: "key", key: "home" })).rejects.toThrow("android_not_running");
  expect(mocks.run.mock.calls.filter(([, args]) => args[0] === "-s").every(([, args]) => args[1] === "phone")).toBe(true);
});

it("设备快照交给 UIAutomator，不再通过 ADB dump 或中间 XML 文件读取", async () => {
  await host.start("thread");
  automation.snapshot.mockResolvedValue({ snapshotId: "current", nodes: [{ id: 1, text: "Search" }] });
  expect(await host.snapshot("thread")).toMatchObject({ snapshotId: "current" });
  expect(automation.snapshot).toHaveBeenCalledOnce();
  expect(mocks.run.mock.calls.some(([, args]) => args.includes("uiautomator") || args.includes("cat"))).toBe(false);
  await host.stop();
  expect(automation.close).toHaveBeenCalled();
});

it.each([0, 20])("截图延迟 %ims 后才采集，保持图片和坐标元数据", async (delayMs) => {
  await host.start("thread");
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png);
  png.writeUInt32BE(1080, 16); png.writeUInt32BE(1920, 20);
  const screen = { width: 1080, height: 1920, rotation: 0, coordinates: "screen-pixels" };
  automation.screen.mockResolvedValue(screen);
  mocks.run.mockImplementation(async (_file: string, args: string[]) => {
    if (args.includes("kill")) child.kill();
    return args.includes("screencap") ? png : Buffer.alloc(0);
  });
  const capture = host.screenshot("thread", undefined, delayMs);
  if (delayMs) {
    await Promise.resolve();
    expect(automation.screen).not.toHaveBeenCalled();
  }
  expect(await capture).toMatchObject({ contentKind: "image", width: 1080, height: 1920, screen, dataUrl: `data:image/png;base64,${png.toString("base64")}` });
  expect(mocks.run.mock.calls.filter(([, args]) => args.includes("screencap"))).toHaveLength(1);
});

it.each([-1, 5001, 0.5, NaN, Infinity])("非法截图延迟 %s 不执行设备命令", async (delayMs) => {
  await host.start("thread");
  mocks.run.mockClear();
  await expect(host.screenshot("thread", undefined, delayMs)).rejects.toThrow("android_invalid_timeout");
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each(["turn", "device"])("%s 停止会立即取消截图延迟，不继续采集", async (source) => {
  await host.start("thread");
  const controller = new AbortController();
  const capture = host.screenshot("thread", controller.signal, 5000);
  const rejected = expect(capture).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  if (source === "turn") controller.abort();
  else await host.stop();
  await rejected;
  expect(automation.screen).not.toHaveBeenCalled();
  expect(mocks.run.mock.calls.some(([, args]) => args.includes("screencap"))).toBe(false);
});

it("并发启动只启动一个进程，使用自有 AVD 和独立 ADB server", async () => {
  await Promise.all([host.start("thread"), host.start("thread")]);
  expect(mocks.spawn).toHaveBeenCalledOnce();
  const [file, args, options] = mocks.spawn.mock.calls[0];
  expect(file).toBe(environment.emulator);
  expect(args).toContain("-no-window");
  expect(args).not.toContain("-wipe-data");
  expect(options.env.ANDROID_AVD_HOME).toContain("managed-android");
  expect(Number(options.env.ANDROID_ADB_SERVER_PORT)).not.toBe(5037);
  const adbCalls = mocks.run.mock.calls.map((call) => call[1] as string[]);
  expect(adbCalls.every((call) => call[0] === "-P")).toBe(true);
  expect(host.state().phase).toBe("running");
  expect(host.state().ownerConversationId).toBe("thread");
  await expect(host.start("other")).rejects.toThrow("android_in_use_by_another_conversation");
  await expect(host.stopFor("other")).rejects.toThrow("android_in_use_by_another_conversation");
  await expect(host.screenshot("other")).rejects.toThrow("android_in_use_by_another_conversation");
  await expect(host.snapshot("other")).rejects.toThrow("android_in_use_by_another_conversation");
  await expect(host.act("other", { action: "key", key: "home" })).rejects.toThrow("android_in_use_by_another_conversation");
  await host.stop();
  expect(host.state().ownerConversationId).toBeUndefined();
  expect(() => host.assertAccess("other")).not.toThrow();
  expect(host.state().phase).toBe("stopped");
  expect(child.kill).toHaveBeenCalledOnce();
});
it("启动失败不遗留进行中状态，重新启动会创建新的进程", async () => {
  mocks.spawn.mockImplementationOnce(() => { queueMicrotask(() => child.emit("error", new Error("failed"))); return child; });
  mocks.run.mockImplementationOnce(async () => Buffer.alloc(0));
  mocks.run.mockImplementation(async (_file: string, args: string[]) => {
    if (args.includes("getprop")) { await Promise.resolve(); return Buffer.alloc(0); }
    if (args.includes("kill")) child.kill();
    return Buffer.alloc(0);
  });
  await expect(host.start("thread")).rejects.toThrow("android_emulator_exited");
  expect(host.state().phase).toBe("error");
  child = new FakeChild();
  mocks.spawn.mockReturnValue(child);
  mocks.run.mockImplementation(async (_file: string, args: string[]) => {
    if (args.includes("getprop")) return Buffer.from("1");
    if (args.includes("kill")) child.kill();
    return Buffer.alloc(0);
  });
  await host.start("thread");
  expect(host.state().phase).toBe("running");
});
it("启动期间停止会取消等待，随后可以重新启动", async () => {
  mocks.run.mockImplementation(async (_file: string, args: string[]) => { if (args.includes("kill")) child.kill(); return Buffer.alloc(0); });
  const starting = host.start("thread");
  const settled = starting.catch((error: unknown) => error);
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
  await host.stop();
  expect(await settled).toBeInstanceOf(Error);
  expect(host.state().phase).toBe("stopped");
  expect(child.kill).toHaveBeenCalledOnce();
});
it("关闭只停止自有设备和自有 ADB，不能全局 kill-server", async () => {
  await host.start("thread");
  await host.close();
  const calls = mocks.run.mock.calls.map((call) => call[1]);
  expect(calls.some((args) => args.includes("emu") && args.includes("kill"))).toBe(true);
  expect(calls.find((args) => args.includes("kill-server"))).toEqual(["-P", expect.any(String), "kill-server"]);
});
