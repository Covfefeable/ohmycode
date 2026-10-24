import { beforeEach, expect, it, vi } from "vitest";
import type { AndroidState } from "@ohmycode/android-use/types";

const mocks = vi.hoisted(() => ({ list: vi.fn(), connect: vi.fn(), read: vi.fn(), write: vi.fn(), state: {} as AndroidState, configure: vi.fn() }));
vi.mock("electron", () => ({ app: { getPath: () => "/profile" }, BrowserWindow: { getAllWindows: () => [] }, dialog: {}, net: { fetch: vi.fn() }, shell: {} }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.read, writeFile: mocks.write }));
vi.mock("@ohmycode/android-use", () => ({
  AndroidHost: class {
    state() { return mocks.state; }
    configure(setup: { devices: AndroidState["devices"]; adb: string }) { mocks.configure(setup); mocks.state = { ...mocks.state, phase: "stopped", devices: setup.devices, adbPath: setup.adb }; }
    setDevices(devices: AndroidState["devices"]) { mocks.state = { ...mocks.state, devices }; }
  },
  checkAdb: async () => ({ adb: "/sdk/adb" }), checkEnvironment: async () => ({ sdkPath: "/sdk", issue: "image_missing" }),
  sdkCandidates: () => [], networkAddress: (value: string) => value, listDevices: mocks.list, connectDevice: mocks.connect,
}));
vi.mock("../../electron/android/android-installation", () => ({ AndroidInstallation: class {} }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.state = { phase: "stopped", enabled: true, installed: true, adbReady: true, managedInstalled: false, sdkPath: "/sdk", target: { kind: "external", serial: "127.0.0.1:5555", name: "Phone" }, devices: [] };
  mocks.read.mockResolvedValue(JSON.stringify({ enabled: true, sdkPath: "/sdk", target: mocks.state.target, connections: [{ address: "127.0.0.1:5555", name: "Phone" }], removedDevices: [] }));
  mocks.list.mockResolvedValue([{ serial: "127.0.0.1:5555", name: "Phone", transport: "network", status: "device" }]);
});

it("运行中刷新仍读取实际设备并恢复保存地址，不重新配置或释放所有者", async () => {
  const service = await import("../../electron/android/android-service");
  await service.initializeAndroid();
  mocks.configure.mockClear(); mocks.list.mockClear();
  mocks.state = { ...mocks.state, phase: "running", ownerConversationId: "owner" };
  mocks.list.mockResolvedValue([]);
  mocks.connect.mockResolvedValue({ serial: "127.0.0.1:5555", name: "Phone", transport: "network", status: "device" });
  const result = await service.rediscoverAndroidDevices();
  expect(mocks.list).toHaveBeenCalledOnce();
  expect(mocks.connect).toHaveBeenCalledExactlyOnceWith("/sdk/adb", "127.0.0.1:5555");
  expect(mocks.configure).not.toHaveBeenCalled();
  expect(result).toMatchObject({ phase: "running", ownerConversationId: "owner", devices: [{ status: "device" }] });
});

it("网络地址无法连接时刷新保留离线条目，不切换所选设备", async () => {
  const service = await import("../../electron/android/android-service");
  await service.initializeAndroid();
  mocks.list.mockResolvedValue([]);
  mocks.connect.mockRejectedValue(new Error("android_device_connect_failed"));
  const result = await service.rediscoverAndroidDevices();
  expect(result.devices).toEqual([{ serial: "127.0.0.1:5555", name: "Phone", transport: "network", status: "offline" }]);
  expect(result.target).toEqual(mocks.state.target);
});
