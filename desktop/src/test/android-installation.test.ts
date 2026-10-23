import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AndroidInstallation } from "../../electron/android/android-installation";

const mocks = vi.hoisted(() => ({ check: vi.fn(), install: vi.fn(), installed: vi.fn(), changed: vi.fn() }));
vi.mock("electron", () => ({ net: { fetch: vi.fn() } }));
vi.mock("@ohmycode/android-use", () => ({
  checkVirtualization: mocks.check, installRuntime: mocks.install,
  runtimeComponents: () => [{ id: "emulator", version: "test", bytes: 100 }, { id: "platformTools", version: "test", bytes: 10 }],
  REQUIRED_FREE_BYTES: 15 * 1024 ** 3, SDK_LICENSE_URL: "https://developer.android.com/studio/terms",
}));
let root: string;
let job: AndroidInstallation;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ohmycode-install-job-"));
  vi.clearAllMocks();
  mocks.check.mockResolvedValue(undefined);
  mocks.install.mockResolvedValue(path.join(root, "sdk"));
  mocks.installed.mockResolvedValue(undefined);
  job = new AndroidInstallation(root, mocks.changed, mocks.installed);
});
afterEach(async () => { await job.cancel(); await rm(root, { recursive: true, force: true }); });

it("必须显式同意许可，拒绝时不执行任何预检或下载", () => {
  expect(() => job.start(false)).toThrow("android_install_license_required");
  expect(mocks.check).not.toHaveBeenCalled();
  expect(job.active).toBe(false);
});
it("立即返回安装状态，重复点击不会并发下载，完成后才激活 SDK", async () => {
  const state = job.start(true);
  expect(state.phase).toBe("checking");
  expect(job.active).toBe(true);
  job.start(true);
  await vi.waitFor(() => expect(job.state().phase).toBe("completed"));
  expect(mocks.install).toHaveBeenCalledOnce();
  expect(mocks.installed).toHaveBeenCalledWith(path.join(root, "sdk"), "runtime");
  const receipt = JSON.parse(await readFile(path.join(root, "sdk-license.json"), "utf8"));
  expect(receipt.url).toBe(job.plan().licenseUrl);
});
it("取消会等待下载清理，随后可以重试", async () => {
  mocks.install.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));
  job.start(true);
  await vi.waitFor(() => expect(mocks.install).toHaveBeenCalledOnce());
  expect((await job.cancel()).phase).toBe("canceled");
  expect(mocks.installed).not.toHaveBeenCalled();
  expect(job.active).toBe(false);
  job.start(true);
  await vi.waitFor(() => expect(job.state().phase).toBe("completed"));
});
it("安装中不能更换目录，回显快照不会被调用方篡改", async () => {
  job.start(true);
  expect(() => job.setRoot("/other")).toThrow("android_install_in_progress");
  const snapshot = job.state();
  snapshot.phase = "completed";
  expect(job.state().phase).toBe("checking");
  await vi.waitFor(() => expect(job.state().phase).toBe("completed"));
});
it("虚拟化预检失败不下载，最终运行检查失败不报成功", async () => {
  mocks.check.mockRejectedValueOnce(new Error("android_install_virtualization"));
  job.start(true);
  await vi.waitFor(() => expect(job.state().error).toBe("android_install_virtualization"));
  expect(mocks.install).not.toHaveBeenCalled();
  mocks.installed.mockRejectedValueOnce(new Error("android_install_acceleration_unavailable"));
  job.start(true);
  await vi.waitFor(() => expect(job.state().error).toBe("android_install_acceleration_unavailable"));
  expect(job.state().phase).toBe("error");
});

it("仅安装连接组件不检测虚拟化，也不下载模拟器和镜像", async () => {
  mocks.check.mockRejectedValue(new Error("android_install_virtualization"));
  const plan = job.plan("tools");
  expect(plan.components.map((component) => component.id)).toEqual(["platformTools"]);
  job.start(true, "tools");
  await vi.waitFor(() => expect(job.state().phase).toBe("completed"));
  expect(mocks.check).not.toHaveBeenCalled();
  expect(mocks.install.mock.calls[0][0].components).toEqual([expect.objectContaining({ id: "platformTools" })]);
  expect(mocks.installed).toHaveBeenCalledWith(path.join(root, "sdk"), "tools");
});
