import { afterEach, beforeEach, expect, it, vi } from "vitest";
import path from "node:path";
import { checkEnvironment } from "../../../packages/android-use/src/environment";

const fs = vi.hoisted(() => ({ stat: vi.fn(), readdir: vi.fn() }));
vi.mock("node:fs/promises", () => fs);
const root = path.resolve("test-android-sdk");
const run = vi.fn().mockResolvedValue(Buffer.from("ok"));
const image = path.join(root, "system-images", "android-35", "default", "x86_64");
beforeEach(() => {
  vi.stubGlobal("process", new Proxy(process, { get: (target, key) => key === "platform" ? "win32" : key === "arch" ? "x64" : Reflect.get(target, key) }));
  run.mockReset().mockResolvedValue(Buffer.from("ok"));
  fs.stat.mockImplementation(async (target: string) => {
    if ([root, path.join(root, "emulator", "emulator.exe"), path.join(root, "platform-tools", "adb.exe"), ...["system.img", "ramdisk.img", "kernel-ranchu"].map((name) => path.join(image, name))].includes(target)) return { isFile: () => target !== root, isDirectory: () => target === root };
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
  fs.readdir.mockImplementation(async (target: string) => {
    const names = target === path.join(root, "system-images") ? ["android-35"] : target === path.join(root, "system-images", "android-35") ? ["default"] : [];
    return names.map((name) => ({ name, isDirectory: () => true }));
  });
});
afterEach(() => vi.unstubAllGlobals());

it("检查程序、原生架构镜像和硬件加速，不启动模拟器", async () => {
  const result = await checkEnvironment(root, run);
  expect(result.environment?.imagePath).toBe(image);
  expect(run.mock.calls.map((call) => call[1])).toEqual([["version"], ["-version"], ["-accel-check"]]);
});
it("Mac M 系列使用 arm64 镜像和无 exe 后缀的程序", async () => {
  vi.stubGlobal("process", new Proxy(process, { get: (target, key) => key === "platform" ? "darwin" : key === "arch" ? "arm64" : Reflect.get(target, key) }));
  fs.stat.mockResolvedValue({ isFile: () => true, isDirectory: () => true });
  const result = await checkEnvironment(root, run);
  expect(result.environment?.imagePath).toBe(path.join(root, "system-images", "android-35", "default", "arm64-v8a"));
  expect(result.environment?.adb).toBe(path.join(root, "platform-tools", "adb"));
});
it.each(["sdk_missing", "emulator_missing", "adb_missing"])("缺少 %s 时不执行不完整的环境", async (issue) => {
  const index = { sdk_missing: root, emulator_missing: path.join(root, "emulator", "emulator.exe"), adb_missing: path.join(root, "platform-tools", "adb.exe") };
  const original = fs.stat.getMockImplementation()!;
  fs.stat.mockImplementation(async (file: string) => { if (file === index[issue as keyof typeof index]) throw new Error("missing"); return original(file); });
  expect((await checkEnvironment(root, run)).issue).toBe(issue);
  expect(run).not.toHaveBeenCalled();
});
it("无对应镜像或虚拟化不可用时不标记为已安装", async () => {
  fs.readdir.mockResolvedValueOnce([]);
  expect((await checkEnvironment(root, run)).issue).toBe("image_missing");
  run.mockImplementation(async (_file, args) => { if (args[0] === "-accel-check") throw new Error("no hypervisor"); return Buffer.alloc(0); });
  const result = await checkEnvironment(root, run);
  expect(result.issue).toBe("acceleration_unavailable");
  expect(result.environment).toBeUndefined();
});
