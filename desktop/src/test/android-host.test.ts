import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AndroidHost } from "../../../packages/android-use/src/android-host";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), run: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn() }));
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
  child = new FakeChild();
  mocks.spawn.mockReturnValue(child);
  mocks.run.mockImplementation(async (_file: string, args: string[]) => {
    if (args.includes("getprop")) return Buffer.from("1\n");
    if (args.includes("kill")) child.kill();
    return Buffer.alloc(0);
  });
  host = new AndroidHost("/managed-android", vi.fn());
  host.configure(true, "/sdk", environment);
});
afterEach(async () => { await host.close(); });

it("设备快照走真实 XML 解析链路，保留末尾内容与状态而不是返回截断 XML", async () => {
  await host.start("thread");
  const xml = `<hierarchy>${Array.from({ length: 1000 }, (_, index) => `<node text="Row ${index}" clickable="true" enabled="false" bounds="[0,0][100,100]"/>`).join("")}</hierarchy>`;
  mocks.run.mockImplementation(async (_file: string, args: string[]) => {
    if (args.includes("cat")) return Buffer.from(xml);
    if (args.includes("kill")) child.kill();
    return Buffer.alloc(0);
  });
  const snapshot = await host.snapshot("thread");
  expect(snapshot.nodes).toHaveLength(1000);
  expect(snapshot.nodes.at(-1)).toMatchObject({ text: "Row 999", clickable: true, enabled: false });
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
