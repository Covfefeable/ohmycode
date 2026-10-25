import { beforeEach, expect, it, vi } from "vitest";
import { AndroidAutomation } from "../../../packages/android-use/src/automation/automation";
import { parseSelector, rpcSelector } from "../../../packages/android-use/src/automation/selector";

const mocks = vi.hoisted(() => ({ call: vi.fn(), start: vi.fn(), close: vi.fn() }));
vi.mock("../../../packages/android-use/src/automation/server", () => ({ UiAutomatorServer: class { call = mocks.call; start = mocks.start; close = mocks.close; } }));
let automation: AndroidAutomation;
let value: string;
const xml = '<hierarchy rotation="1"><node resource-id="app:id/row" package="app" clickable="true" enabled="true" bounds="[0,0][200,100]"><node text="搜索" class="TextView" bounds="[10,10][100,50]"/></node></hierarchy>';
beforeEach(() => {
  vi.clearAllMocks();
  value = "";
  mocks.call.mockImplementation(async (method, args) => {
    if (method === "deviceInfo") return { displayWidth: 1920, displayHeight: 1080, displayRotation: 1 };
    if (method === "dumpWindowHierarchy") return xml.replace("</hierarchy>", `<node resource-id="app:id/input" focused="true" text="${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"/></hierarchy>`);
    if (method === "waitForExists" || method === "waitUntilGone") return true;
    if (method === "setText") { value = args[1]; return true; }
    if (method === "objInfo") return { text: value, enabled: true, resourceName: "app:id/row", bounds: { left: 0, top: 0, right: 200, bottom: 100 } };
    if (method === "click") return true;
    throw new Error(`unexpected method: ${method}`);
  });
  automation = new AndroidAutomation({ adb: "adb", serial: "selected" }, "/cache");
});

it("快照输出坐标系，nodeId 复用当前选择器并在操作后失效", async () => {
  const snapshot = await automation.snapshot();
  expect(snapshot.screen).toEqual({ width: 1920, height: 1080, rotation: 1, coordinates: "screen-pixels" });
  const result = await automation.act({ action: "tap", snapshotId: snapshot.snapshotId, nodeId: 2 }, vi.fn());
  expect(result).toMatchObject({ executed: true, selector: { resourceId: "app:id/row" } });
  expect(result).not.toHaveProperty("verified");
  expect(mocks.call).toHaveBeenCalledWith("click", [expect.objectContaining({ resourceId: "app:id/row" })], undefined);
  await expect(automation.act({ action: "tap", snapshotId: snapshot.snapshotId, nodeId: 2 }, vi.fn())).rejects.toThrow("android_snapshot_expired");
});

it("操作反馈携带设备屏幕尺寸，复用节点 bounds 和命令坐标且不进入结果", async () => {
  const feedback = vi.fn();
  const result = await automation.act({ action: "tap", selector: { resourceId: "app:id/row" } }, vi.fn(), undefined, feedback);
  expect(feedback).toHaveBeenCalledWith([{ x: 100, y: 50 }], undefined, { width: 1920, height: 1080 });
  expect(result).not.toHaveProperty("pointer");
  expect(mocks.call.mock.calls.map(([method]) => method)).toEqual(["waitForExists", "dumpWindowHierarchy", "objInfo", "deviceInfo", "click"]);
  const shell = vi.fn();
  await automation.act({ action: "swipe", x: 10, y: 20, endX: 90, endY: 120, durationMs: 400 }, shell, undefined, feedback);
  expect(feedback).toHaveBeenLastCalledWith([{ x: 10, y: 20 }, { x: 90, y: 120 }], 400, { width: 1920, height: 1080 });
  expect(shell).toHaveBeenCalledWith(["shell", "input", "swipe", "10", "20", "90", "120", "400"]);
});

it("选择器歧义或禁用控件不执行点击，失败不自动换坐标", async () => {
  mocks.call.mockImplementation(async (method) => method === "waitForExists" ? true : method === "dumpWindowHierarchy" ? '<hierarchy><node text="发送"/><node text="发送"/></hierarchy>' : undefined);
  expect(await automation.act({ action: "tap", selector: { text: "发送" } }, vi.fn())).toMatchObject({ executed: false, error: "android_node_ambiguous", totalMatches: 2, truncated: false, snapshotId: expect.any(String), candidates: [{ id: 1, text: "发送" }, { id: 2, text: "发送" }] });
  expect(mocks.call.mock.calls.some(([method]) => method === "click")).toBe(false);
  mocks.call.mockImplementation(async (method) => method === "waitForExists" ? true : method === "dumpWindowHierarchy" ? '<hierarchy><node text="发送"/></hierarchy>' : { enabled: false });
  await expect(automation.act({ action: "tap", selector: { text: "发送" } }, vi.fn())).rejects.toThrow("android_node_disabled");
});

it("Unicode 文本设置共用控件通道，回读不再绑定旧文本", async () => {
  value = "旧值";
  const shell = vi.fn();
  expect(await automation.act({ action: "text", text: "中文 %s ' 😀", selector: { resourceId: "app:id/input", text: "旧值" } }, shell)).toMatchObject({ executed: true, text: "中文 %s ' 😀", textMatched: true });
  expect(await automation.act({ action: "text", text: "新值" }, shell)).toMatchObject({ text: "新值", textMatched: true });
  expect(shell).not.toHaveBeenCalled();
  expect(mocks.call).toHaveBeenLastCalledWith("objInfo", [expect.objectContaining({ focused: true })], undefined);
  expect(await automation.act({ action: "text", text: "" }, shell)).toMatchObject({ text: "", textMatched: true });
});

it("等待返回命中或超时，取消和读取失败不伪装成控件消失", async () => {
  expect(await automation.act({ action: "wait", selector: { text: "完成" }, state: "present", timeoutMs: 30000 }, vi.fn())).toMatchObject({ matched: true, timedOut: false });
  expect(mocks.call).toHaveBeenLastCalledWith("waitForExists", [expect.anything(), expect.any(Number)], undefined);
  expect(mocks.call.mock.calls.filter(([method]) => method === "waitForExists").every(([, args]) => args[1] <= 500)).toBe(true);
  mocks.call.mockResolvedValue(false);
  expect(await automation.act({ action: "wait", selector: { text: "不存在" }, state: "present", timeoutMs: 0 }, vi.fn())).toMatchObject({ matched: false, timedOut: true });
  const controller = new AbortController(); controller.abort();
  await expect(automation.act({ action: "wait", selector: { text: "完成" }, state: "absent" }, vi.fn(), controller.signal)).rejects.toThrow();
  mocks.call.mockRejectedValue(new Error("android_automation_unavailable"));
  await expect(automation.act({ action: "wait", selector: { text: "完成" }, state: "absent" }, vi.fn())).rejects.toThrow("android_automation_unavailable");
});

it("手动操作使节点引用失效，旋转期间不返回混合坐标快照", async () => {
  const snapshot = await automation.snapshot();
  automation.invalidate();
  await expect(automation.act({ action: "tap", snapshotId: snapshot.snapshotId, nodeId: 1 }, vi.fn())).rejects.toThrow("android_snapshot_expired");
  mocks.call.mockImplementation(async (method) => method === "dumpWindowHierarchy" ? xml : { displayWidth: 1080, displayHeight: 1920, displayRotation: 0 });
  await expect(automation.snapshot()).rejects.toThrow("android_layout_changed");
});

it("新快照、滚动和外部布局变化都不能复用旧节点引用", async () => {
  const first = await automation.snapshot();
  const second = await automation.snapshot();
  await expect(automation.act({ action: "tap", snapshotId: first.snapshotId, nodeId: 2 }, vi.fn())).rejects.toThrow("android_snapshot_expired");
  await automation.act({ action: "swipe", x: 20, y: 100, endX: 20, endY: 20 }, vi.fn());
  await expect(automation.act({ action: "tap", snapshotId: second.snapshotId, nodeId: 2 }, vi.fn())).rejects.toThrow("android_snapshot_expired");
  const current = await automation.snapshot();
  const call = mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async (method, args) => method === "dumpWindowHierarchy" ? xml.replace("[0,0][200,100]", "[0,100][200,200]") : call(method, args));
  await expect(automation.act({ action: "tap", snapshotId: current.snapshotId, nodeId: 2 }, vi.fn())).rejects.toThrow("android_snapshot_expired");
  expect(mocks.call.mock.calls.some(([method]) => method === "click")).toBe(false);
});

it("歧义返回有上下文的有限候选，使用新引用和唯一属性继续定位", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => `<node text="组 ${index}" bounds="[0,0][200,100]"><node text="发送" resource-id="send-${index}" clickable="true" enabled="true" bounds="[0,0][100,50]"/></node>`).join("");
  const call = mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async (method, args) => method === "dumpWindowHierarchy" ? `<hierarchy rotation="1">${rows}</hierarchy>` : call(method, args));
  const result = await automation.act({ action: "tap", selector: { text: "发送" } }, vi.fn()) as { snapshotId: string; candidates: { id: number }[] };
  expect(result).toMatchObject({ executed: false, error: "android_node_ambiguous", totalMatches: 12, truncated: true });
  expect(result.candidates).toHaveLength(10);
  expect(result.candidates[0]).toMatchObject({ resourceId: "send-0", bounds: "[0,0][100,50]", parent: { text: "组 0" } });
  expect(mocks.call.mock.calls.some(([method]) => method === "click")).toBe(false);
  expect(await automation.act({ action: "tap", snapshotId: result.snapshotId, nodeId: result.candidates[0].id }, vi.fn())).toMatchObject({ executed: true });
});

it("文本只报告控件回读是否匹配，不声称应用接受或业务完成", async () => {
  const result = await automation.act({ action: "text", text: "88*99" }, vi.fn());
  expect(result).toEqual({ executed: true, text: "88*99", textMatched: true });
  value = "旧值";
  const call = mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async (method, args) => method === "setText" ? true : call(method, args));
  expect(await automation.act({ action: "text", text: "新值" }, vi.fn())).toEqual({ executed: true, text: "旧值", textMatched: false });
  let written = false;
  mocks.call.mockImplementation(async (method, args) => {
    if (method === "setText") { written = true; return true; }
    if (method === "dumpWindowHierarchy" && written) return '<hierarchy><node focused="true" text="新值"/><node focused="true" text="其他"/></hierarchy>';
    return call(method, args);
  });
  expect(await automation.act({ action: "text", text: "新值" }, vi.fn())).toMatchObject({ executed: true, textMatched: null, error: "android_node_ambiguous", totalMatches: 2 });
});

it("窄选择器协议拒绝任意 RPC 或多种目标混用，坐标导航仍可用", async () => {
  expect(rpcSelector(parseSelector({ resourceId: "app:id/search", focused: true }))).toMatchObject({ mask: 0x220000, childOrSibling: [], childOrSiblingSelector: [] });
  for (const selector of [{}, { command: "shell" }, { text: "" }, { focused: "true" }]) expect(() => parseSelector(selector)).toThrow("android_invalid_selector");
  await expect(automation.act({ action: "tap", selector: { text: "发送" }, x: 10, y: 10 }, vi.fn())).rejects.toThrow("android_invalid_action");
  const shell = vi.fn().mockResolvedValue(undefined);
  expect(await automation.act({ action: "key", key: "home" }, shell)).toEqual({ executed: true });
  expect(shell).toHaveBeenCalledWith(["shell", "input", "keyevent", "KEYCODE_HOME"]);
});
