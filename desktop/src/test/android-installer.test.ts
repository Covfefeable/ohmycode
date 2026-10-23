import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { zipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installRuntime } from "../../../packages/android-use/src/install/installer";
import { extractArchive } from "../../../packages/android-use/src/install/extract";
import { downloadArchive } from "../../../packages/android-use/src/install/download";
import { runtimeComponents } from "../../../packages/android-use/src/install/manifest";
import { checkVirtualization } from "../../../packages/android-use/src/install/preflight";
import type { RuntimeComponent } from "../../../packages/android-use/src/install/manifest";

const disk = vi.hoisted(() => ({ statfs: vi.fn() }));
vi.mock("node:fs/promises", async (original) => ({ ...await original<object>(), statfs: disk.statfs }));

let root: string;
const archive = zipSync({ "emulator/emulator.exe": [strToU8("test binary"), { attrs: 0o100755 << 16 }], "emulator/source.properties": strToU8("Pkg.Revision=1") });
const component: RuntimeComponent = { id: "emulator", version: "test", url: "https://example.test/runtime.zip", bytes: archive.length, sha1: createHash("sha1").update(archive).digest("hex"), destination: "emulator", archiveRoot: "emulator", requiredFiles: ["emulator.exe", "source.properties"] };
const fetcher = vi.fn(async () => new Response(new Uint8Array(archive)));
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "ohmycode-installer-test-")); fetcher.mockClear(); disk.statfs.mockResolvedValue({ bsize: 4096, bavail: 10_000_000 }); });
afterEach(async () => { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

it("安装流式下载、校验并解压，再次安装复用已完成组件", async () => {
  const progress = vi.fn();
  const options = { root, components: [component], signal: new AbortController().signal, onProgress: progress, fetcher };
  const sdk = await installRuntime(options);
  expect(await readFile(path.join(sdk, "emulator", "emulator.exe"), "utf8")).toBe("test binary");
  expect(JSON.parse(await readFile(path.join(sdk, "emulator", ".ohmycode-component.json"), "utf8")).sha1).toBe(component.sha1);
  expect(await readdir(path.join(root, "downloads"))).toEqual([]);
  if (process.platform !== "win32") expect((await stat(path.join(sdk, "emulator", "emulator.exe"))).mode & 0o111).not.toBe(0);
  disk.statfs.mockResolvedValue({ bsize: 4096, bavail: 0 });
  await installRuntime(options);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "finishing", receivedBytes: component.bytes });
});
it("校验失败不发布组件，部分文件被清理，可正常重试", async () => {
  const bad = vi.fn(async () => new Response("corrupted"));
  await expect(installRuntime({ root, components: [component], signal: new AbortController().signal, onProgress: vi.fn(), fetcher: bad })).rejects.toThrow("android_install_checksum_failed");
  expect(await stat(path.join(root, "sdk", "emulator")).catch(() => undefined)).toBeUndefined();
  expect(await readdir(path.join(root, "downloads"))).toEqual([]);
  await installRuntime({ root, components: [component], signal: new AbortController().signal, onProgress: vi.fn(), fetcher });
  expect(fetcher).toHaveBeenCalledOnce();
});
it("取消下载不会留下半安装目录或 part 文件", async () => {
  const controller = new AbortController();
  const target = path.join(root, "runtime.zip");
  await expect(downloadArchive(component, target, controller.signal, fetcher, () => controller.abort())).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
});
it("磁盘空间不足时不开始下载", async () => {
  disk.statfs.mockResolvedValue({ bsize: 4096, bavail: 1 });
  await expect(installRuntime({ root, components: [component], signal: new AbortController().signal, onProgress: vi.fn(), fetcher })).rejects.toThrow("android_install_disk_space");
  expect(fetcher).not.toHaveBeenCalled();
});
it("不能覆盖用户已有的非托管 SDK", async () => {
  await mkdir(path.join(root, "sdk", "emulator"), { recursive: true });
  const existing = path.join(root, "sdk", "emulator", "user-file");
  await writeFile(existing, "keep");
  await expect(installRuntime({ root, components: [component], signal: new AbortController().signal, onProgress: vi.fn(), fetcher })).rejects.toThrow("android_install_conflict");
  expect(await readFile(existing, "utf8")).toBe("keep");
  expect(fetcher).not.toHaveBeenCalled();
});
it("缺少必要文件的包不发布，旧的托管安装仍保持完整", async () => {
  await installRuntime({ root, components: [component], signal: new AbortController().signal, onProgress: vi.fn(), fetcher });
  const incomplete = zipSync({ "emulator/other": strToU8("incomplete") });
  const next = { ...component, version: "next", bytes: incomplete.length, sha1: createHash("sha1").update(incomplete).digest("hex") };
  await expect(installRuntime({ root, components: [next], signal: new AbortController().signal, onProgress: vi.fn(), fetcher: async () => new Response(incomplete) })).rejects.toThrow("android_install_incomplete_archive");
  expect(await readFile(path.join(root, "sdk", "emulator", "emulator.exe"), "utf8")).toBe("test binary");
});
it("压缩包不能越界或创建指向外部的符号链接", async () => {
  const file = path.join(root, "unsafe.zip");
  await writeFile(file, zipSync({ "emulator/../../escape": strToU8("no") }));
  const staging = path.join(root, "stage");
  await mkdir(staging);
  await expect(extractArchive(file, staging, "emulator", new AbortController().signal)).rejects.toThrow("android_install_unsafe_archive");
  await writeFile(file, zipSync({ "emulator/link": [strToU8("../../outside"), { attrs: 0o120777 << 16 }] }));
  await expect(extractArchive(file, staging, "emulator", new AbortController().signal)).rejects.toThrow("android_install_unsafe_archive");
});
it("固定清单匹配 Windows、Intel Mac 和 M 系列，不下载 latest 或错误架构", () => {
  for (const [platform, arch, abi] of [["win32", "x64", "x86_64"], ["darwin", "x64", "x86_64"], ["darwin", "arm64", "arm64-v8a"]]) {
    const components = runtimeComponents(platform, arch);
    expect(components).toHaveLength(3);
    expect(components[2].destination.endsWith(abi)).toBe(true);
    expect(components.every((item) => item.url.startsWith("https://dl.google.com/android/repository/") && /^[a-f0-9]{40}$/.test(item.sha1))).toBe(true);
  }
  expect(() => runtimeComponents("win32", "arm64")).toThrow("android_install_unsupported_platform");
});
it("虚拟化检查是只读的，失败时不更改系统功能", async () => {
  const run = vi.fn().mockResolvedValue(Buffer.from("1"));
  await checkVirtualization("darwin", run);
  expect(run).toHaveBeenCalledWith("/usr/sbin/sysctl", ["-n", "kern.hv_support"]);
  run.mockRejectedValueOnce(new Error("disabled"));
  await expect(checkVirtualization("win32", run)).rejects.toThrow("android_install_virtualization");
  expect(run.mock.calls.at(-1)?.[1].join(" ")).not.toContain("Enable-WindowsOptionalFeature");
});
