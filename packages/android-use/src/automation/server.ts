import { spawn, type ChildProcess } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { adbArguments } from "../adb.js";
import { runCommand } from "../command.js";
import type { AdbTarget } from "../types.js";
import { ensureAutomationServer } from "./artifact.js";

/** One owned device-side process and ADB forward; never attaches to or kills another server. */
export class UiAutomatorServer {
  private readonly controller = new AbortController();
  private readonly remote = `/data/local/tmp/ohmycode-uia2-${randomUUID()}.jar`;
  private child?: ChildProcess;
  private pid?: string;
  private port?: string;
  private starting?: Promise<void>;
  private closing?: Promise<void>;
  private disposed?: Promise<void>;
  private exited = false;
  private processError?: Error;

  constructor(private readonly target: AdbTarget, private readonly root: string, private readonly fetcher: typeof fetch = fetch) {}

  private command(args: string[], signal?: AbortSignal) {
    return runCommand(this.target.adb, [...adbArguments(this.target), ...args], signal);
  }
  start(signal?: AbortSignal): Promise<void> {
    return this.starting ??= this.initialize(signal).catch(async (error: unknown) => { await this.dispose(); throw error; });
  }
  private async initialize(signal?: AbortSignal): Promise<void> {
    const active = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    const jar = await ensureAutomationServer(this.root, this.fetcher, active);
    await this.command(["push", jar, this.remote], active);
    active.throwIfAborted();
    const devicePort = randomInt(20000, 60000);
    this.child = spawn(this.target.adb, [...adbArguments(this.target), "shell", `echo $$; export CLASSPATH=${this.remote}; exec app_process / com.wetest.uia2.Main -p ${devicePort}`], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    this.child.stdout!.on("data", (bytes: Buffer) => {
      if (this.pid) return;
      output = (output + bytes.toString()).slice(0, 1024);
      const line = /^(\d+)\r?\n/.exec(output);
      if (line) this.pid = line[1];
    });
    this.child.once("error", (error) => { this.processError = error; this.exited = true; });
    this.child.once("exit", () => { this.exited = true; });
    this.port = (await this.command(["forward", "tcp:0", `tcp:${devicePort}`], active)).toString().trim();
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      active.throwIfAborted();
      if (this.exited) throw new Error("android_automation_start_failed", { cause: this.processError });
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/ping`, { signal: AbortSignal.any([active, AbortSignal.timeout(1000)]) });
        if (response.ok && await response.text() === "pong" && this.pid) {
          ready = true;
          break;
        }
      } catch (error) { if (active.aborted) throw error; }
      await delay(500, undefined, { signal: active });
    }
    if (!ready) throw new Error("android_automation_start_failed");
    await this.call("setConfigurator", [{ waitForIdleTimeout: 0, waitForSelectorTimeout: 0 }], active);
  }
  async call<T>(method: string, params: unknown[] = [], signal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
    this.controller.signal.throwIfAborted();
    signal?.throwIfAborted();
    if (!this.port || this.exited) throw new Error("android_automation_unavailable");
    // Matches Python's json.dumps ensure_ascii behavior; some devices decode raw UTF-8 incorrectly.
    const body = JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    const active = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
    let response: Response;
    try { response = await fetch(`http://127.0.0.1:${this.port}/jsonrpc/0`, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body, signal: active }); }
    catch (error) {
      if (this.controller.signal.aborted || signal?.aborted) throw error;
      throw new Error("android_automation_unavailable", { cause: error });
    }
    if (!response.ok) throw new Error("android_automation_unavailable");
    const reply = await response.json() as { result: T; error?: { code: number; message: string } };
    if (reply.error) throw new Error(reply.error.message === "androidx.test.uiautomator.UiObjectNotFoundException" ? "android_node_not_found" : "android_automation_failed");
    return reply.result;
  }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.controller.abort();
      await this.starting?.catch(() => undefined);
      await this.dispose();
    })();
  }
  private dispose(): Promise<void> { return this.disposed ??= this.release(); }
  private async release(): Promise<void> {
    if (this.pid && !this.exited) await this.command(["shell", "kill", this.pid]).catch(() => undefined);
    this.pid = undefined;
    this.child?.kill();
    if (this.port) {
      const port = this.port; this.port = undefined;
      await this.command(["forward", "--remove", `tcp:${port}`]).catch(() => undefined);
    }
    await this.command(["shell", "rm", "-f", this.remote]).catch(() => undefined);
  }
}
