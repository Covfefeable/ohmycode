import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UiAutomatorServer } from "../../../packages/android-use/src/automation/server";
import { ensureAutomationServer } from "../../../packages/android-use/src/automation/artifact";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), run: vi.fn(), artifact: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../../../packages/android-use/src/command", () => ({ runCommand: mocks.run }));
// Exercise the real artifact function separately; server lifecycle tests do not download binaries.
vi.mock("../../../packages/android-use/src/automation/artifact", async (original) => ({ ...await original<object>(), ensureAutomationServer: mocks.artifact }));

class Child extends EventEmitter {
  stdout = new PassThrough();
  kill = vi.fn(() => { this.emit("exit", 0); return true; });
}
let http: Server, child: Child, server: UiAutomatorServer, root: string;
let requests: { method: string; params: unknown[] }[], bodies: string[];
let reply: (method: string) => unknown;
beforeEach(async () => {
  vi.clearAllMocks(); requests = []; bodies = [];
  root = await mkdtemp(path.join(tmpdir(), "ohmycode-uia2-test-"));
  reply = () => true;
  http = createServer(async (req, res) => {
    if (req.url === "/ping") { res.end("pong"); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    bodies.push(body);
    const parsed = JSON.parse(body); requests.push(parsed);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, ...await reply(parsed.method) as object }));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;
  child = new Child();
  mocks.spawn.mockImplementation(() => { queueMicrotask(() => child.stdout.write("4321\n")); return child; });
  mocks.run.mockImplementation(async (_file, args) => Buffer.from(args.includes("forward") && args.includes("tcp:0") ? String(port) : ""));
  mocks.artifact.mockResolvedValue(path.join(root, "server.jar"));
  server = new UiAutomatorServer({ adb: "adb", serial: "chosen" }, root);
});
afterEach(async () => { await server.close(); http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); await rm(root, { recursive: true, force: true }); });

it("部署与 RPC 只走选中设备，中文使用 ASCII JSON，停止只清理自有进程和端口", async () => {
  reply = () => ({ result: true });
  await server.start();
  await expect(server.call("setText", [{ text: "中文😀" }])).resolves.toBe(true);
  expect(requests.at(-1)?.params).toEqual([{ text: "中文😀" }]);
  expect(bodies.at(-1)).not.toContain("中文");
  await server.close();
  expect(mocks.run.mock.calls.every(([, args]) => args[0] === "-s" && args[1] === "chosen")).toBe(true);
  expect(mocks.run.mock.calls.some(([, args]) => args.includes("kill") && args.includes("4321"))).toBe(true);
  expect(mocks.run.mock.calls.some(([, args]) => args.includes("kill-server") || args.includes("pkill"))).toBe(false);
  expect(mocks.run.mock.calls.some(([, args]) => args.includes("--remove"))).toBe(true);
});

it("控件未命中返回稳定错误，不自动重启或重复点击", async () => {
  reply = (method) => method === "click" ? { error: { code: -32001, message: "androidx.test.uiautomator.UiObjectNotFoundException" } } : { result: true };
  await server.start();
  await expect(server.call("click", [{}])).rejects.toThrow("android_node_not_found");
  expect(requests.filter((r) => r.method === "click")).toHaveLength(1);
  expect(mocks.spawn).toHaveBeenCalledOnce();
});

it("停止中断进行中的请求，已取消的请求不再发送并清理自有转发", async () => {
  reply = () => ({ result: true });
  await server.start();
  let entered!: () => void, release!: (value: unknown) => void;
  const receiving = new Promise<void>((resolve) => { entered = resolve; });
  reply = () => { entered(); return new Promise((resolve) => { release = resolve; }); };
  const running = server.call("waitForExists", [{}, 500]);
  const rejected = expect(running).rejects.toThrow();
  await receiving;
  await server.close();
  await rejected;
  release({ result: false });
  const controller = new AbortController(); controller.abort();
  await expect(server.call("waitForExists", [{}, 500], controller.signal)).rejects.toThrow();
  await server.close();
  await expect(server.call("deviceInfo")).rejects.toThrow();
  expect(requests.filter((r) => r.method === "waitForExists")).toHaveLength(1);
});

it("下载校验失败不发布缓存，也不把损坏缓存当作安装成功", async () => {
  const actual = await vi.importActual<typeof import("../../../packages/android-use/src/automation/artifact")>("../../../packages/android-use/src/automation/artifact");
  const file = path.join(root, "uiautomator-3.7.1.jar");
  await writeFile(file, "corrupt");
  const fetcher = vi.fn().mockResolvedValue(new Response("not the pinned wheel"));
  await expect(actual.ensureAutomationServer(root, fetcher, new AbortController().signal)).rejects.toThrow("android_automation_checksum_failed");
  expect(await readFile(file, "utf8")).toBe("corrupt");
  expect(ensureAutomationServer).toBe(mocks.artifact);
});
