import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { startAndroidVideo, stopAndroidVideo } from "../../electron/android/android-presentation";
import { ScrcpyProtocol } from "../../../packages/android-use/src/video/protocol";
import { encodeTouch } from "../../../packages/android-use/src/video/touch";

const mocks = vi.hoisted(() => ({ ensureServer: vi.fn(), openVideo: vi.fn() }));
vi.mock("electron", () => ({ app: { getPath: () => "/profile" }, BrowserWindow: {}, net: { fetch: vi.fn() } }));
vi.mock("@ohmycode/android-use", () => ({ ensureVideoServer: mocks.ensureServer }));
vi.mock("../../electron/android/android-service", () => ({ getAndroidState: async () => ({ enabled: true, installed: true, phase: "running" }), androidHost: () => ({ openVideo: mocks.openVideo }) }));
vi.mock("../../electron/window/create-main-window", () => ({ createApplicationWindow: vi.fn() }));

it("切页取消视频初始化属于正常停止，不上报失败；真实初始化错误仍返回", async () => {
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() }) as unknown as WebContents;
  mocks.ensureServer.mockImplementation((_path, _fetch, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
  const starting = startAndroidVideo(sender, "cancelled");
  await vi.waitFor(() => expect(mocks.ensureServer).toHaveBeenCalled());
  await stopAndroidVideo(sender, "cancelled");
  await expect(starting).resolves.toBeUndefined();
  expect(sender.send).not.toHaveBeenCalled();
  expect(mocks.openVideo).not.toHaveBeenCalled();
  mocks.ensureServer.mockRejectedValueOnce(new Error("download failed"));
  await expect(startAndroidVideo(sender, "failed")).rejects.toThrow("download failed");
  expect(sender.send).toHaveBeenCalledWith("android:video", "failed", { error: "android_video_failed" });
  expect(sender.listenerCount("destroyed")).toBe(0);
});

it("投屏协议跨分包还原视频并完整编码触摸轨迹，拒绝无效数据", () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(0x68323634, 1); header.writeUInt32BE(720, 5); header.writeUInt32BE(1280, 9);
  const packet = (pts: bigint, content: Buffer) => {
    const result = Buffer.alloc(12 + content.length);
    result.writeBigUInt64BE(pts); result.writeUInt32BE(content.length, 8); content.copy(result, 12);
    return result;
  };
  const config = Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0, 31]);
  const frame = Buffer.from([0, 0, 0, 1, 0x65, 1, 2, 3]);
  const stream = Buffer.concat([header, packet(1n << 63n, config), packet((1n << 62n) | 12345n, frame)]);
  for (let split = 1; split < stream.length; split++) {
    const received: unknown[] = [];
    const parser = new ScrcpyProtocol((value) => received.push(value));
    parser.push(stream.subarray(0, split)); parser.push(stream.subarray(split));
    expect(received).toEqual([
      { configuration: true, keyframe: false, timestamp: 0, data: Uint8Array.from(config) },
      { configuration: false, keyframe: true, timestamp: 12345, data: Uint8Array.from(frame) },
    ]);
  }
  expect(() => new ScrcpyProtocol(() => {}).push(Buffer.alloc(13))).toThrow("android_video_protocol");
  const path = [
    { action: "down" as const, x: 20, y: 20, width: 720, height: 1280 },
    { action: "move" as const, x: 80, y: 200, width: 720, height: 1280 },
    { action: "move" as const, x: 200, y: 80, width: 720, height: 1280 },
    { action: "up" as const, x: 20, y: 20, width: 720, height: 1280 },
  ];
  const controls = path.map(encodeTouch);
  expect(controls.map((bytes) => [bytes[0], bytes[1], bytes.readInt32BE(10), bytes.readInt32BE(14)])).toEqual([
    [2, 0, 20, 20], [2, 2, 80, 200], [2, 2, 200, 80], [2, 1, 20, 20],
  ]);
  expect(controls[0].readBigInt64BE(2)).toBe(-2n);
  expect(controls[3].readUInt16BE(22)).toBe(0);
  expect(() => encodeTouch({ ...path[0], x: 720 })).toThrow("android_invalid_touch");
});
