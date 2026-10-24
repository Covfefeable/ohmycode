import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { runCommand } from "./command.js";
import { adbArguments, listDevices } from "./adb.js";
import { ManagedEmulator } from "./managed-emulator.js";
import { AndroidAutomation } from "./automation/automation.js";
import type { AdbTarget, AndroidDevice, AndroidEnvironment, AndroidState, AndroidTarget, AndroidTouch } from "./types.js";
import { AndroidVideoStream } from "./video/stream.js";
import type { AndroidVideoPacket } from "./video/protocol.js";

export type AndroidSetup = {
  enabled: boolean; sdkPath: string; adb?: string; environment?: AndroidEnvironment;
  target: AndroidTarget; devices: AndroidDevice[]; issue?: AndroidState["issue"];
};

/** A single settings-selected target. Tools cannot choose or replace it. */
export class AndroidHost {
  private setup?: AndroidSetup;
  private target?: AdbTarget;
  private managed?: ManagedEmulator;
  private boot?: Promise<void>;
  private bootController?: AbortController;
  private stopping?: Promise<void>;
  private monitor?: AbortController;
  private video?: AndroidVideoStream;
  private automation?: AndroidAutomation;
  private releasing?: Promise<void>;
  private pendingAction: Promise<unknown> = Promise.resolve();
  private current: AndroidState = {
    enabled: false, installed: false, sdkPath: "", phase: "stopped",
    target: { kind: "managed" }, devices: [], adbReady: false, managedInstalled: false,
  };

  constructor(private readonly dataRoot: string, private readonly changed: (state: AndroidState) => void, private readonly fetcher: typeof fetch = fetch) {}
  state(): AndroidState { return { ...this.current, target: { ...this.current.target }, devices: this.current.devices.map((device) => ({ ...device })) }; }
  get available(): boolean { return this.current.enabled && this.current.installed; }
  private update(change: Partial<AndroidState>): void {
    this.current = { ...this.current, ...change };
    if (change.phase === "stopped" || change.phase === "error") this.current.ownerConversationId = undefined;
    this.changed(this.state());
  }
  assertAccess(conversationId: string): void {
    if (typeof conversationId !== "string" || !conversationId.trim()) throw new Error("android_invalid_conversation");
    if (this.current.ownerConversationId && this.current.ownerConversationId !== conversationId) throw new Error("android_in_use_by_another_conversation");
  }
  configure(setup: AndroidSetup): void {
    if (this.boot || this.stopping || this.current.phase === "running") throw new Error("android_stop_before_configure");
    this.setup = { ...setup, adb: setup.adb ?? setup.environment?.adb, target: { ...setup.target } };
    this.update({ enabled: setup.enabled, sdkPath: setup.sdkPath, target: { ...setup.target }, devices: setup.devices,
      adbReady: Boolean(this.setup.adb), adbPath: this.setup.adb, managedInstalled: Boolean(setup.environment),
      installed: setup.target.kind === "managed" ? Boolean(setup.environment) : setup.target.kind === "external" && Boolean(this.setup.adb),
      imageName: setup.environment?.imageName, issue: setup.issue, error: undefined, phase: "stopped" });
  }
  async start(conversationId: string, signal?: AbortSignal): Promise<void> {
    if (this.stopping) await this.stopping;
    if (this.releasing) await this.releasing;
    if (!this.available) throw new Error("android_not_available");
    signal?.throwIfAborted();
    this.assertAccess(conversationId);
    this.update({ ownerConversationId: conversationId });
    if (this.current.phase === "running") return;
    if (!this.boot) {
      this.bootController = new AbortController();
      const abort = () => this.bootController?.abort();
      signal?.addEventListener("abort", abort, { once: true });
      this.boot = this.connect(this.bootController.signal).finally(() => {
        signal?.removeEventListener("abort", abort);
        this.boot = undefined; this.bootController = undefined;
      });
    }
    await this.boot;
    signal?.throwIfAborted();
  }
  private async connect(signal: AbortSignal): Promise<void> {
    const setup = this.setup!;
    this.update({ phase: "starting", error: undefined });
    try {
      if (setup.target.kind === "managed") {
        await this.managed?.close();
        this.managed = new ManagedEmulator(this.dataRoot, setup.environment!, () => {
          if (this.current.phase === "starting" || this.current.phase === "running") this.disconnected("android_emulator_exited");
        });
        this.target = await this.managed.start(signal);
      } else if (setup.target.kind === "external") {
        const serial = setup.target.serial;
        const selected = (await listDevices(setup.adb!)).find((item) => item.serial === serial);
        if (!selected || selected.status !== "device") throw new Error(selected?.status === "unauthorized" ? "android_device_unauthorized" : "android_device_offline");
        this.target = { adb: setup.adb!, serial };
      }
      this.automation = new AndroidAutomation(this.target!, path.join(this.dataRoot, "automation"), this.fetcher);
      await this.automation.start(signal);
      signal.throwIfAborted();
      this.update({ phase: "running", error: undefined });
      if (setup.target.kind === "external") this.watchTarget();
    } catch (error) {
      await this.automation?.close(); this.automation = undefined;
      await this.managed?.close(); this.managed = undefined; this.target = undefined;
      this.update({ phase: signal.aborted ? "stopped" : "error", error: signal.aborted ? undefined : error instanceof Error ? error.message : "android_start_failed" });
      throw error;
    }
  }
  private disconnected(error: string): void {
    this.monitor?.abort();
    this.target = undefined;
    this.releasing = this.automation?.close(); this.automation = undefined;
    void this.video?.close();
    this.video = undefined;
    this.update({ phase: "error", error });
  }
  private watchTarget(): void {
    const monitor = new AbortController();
    this.monitor = monitor;
    void (async () => {
      try {
        while (!monitor.signal.aborted) {
          await delay(3000, undefined, { signal: monitor.signal });
          if ((await this.adb(["get-state"], monitor.signal)).toString().trim() !== "device") throw new Error("android_device_offline");
        }
      } catch {
        if (!monitor.signal.aborted) this.disconnected("android_device_offline");
      }
    })();
  }
  private adb(args: string[], signal?: AbortSignal, target = this.target): Promise<Buffer> {
    if (!target || target !== this.target) throw new Error("android_not_running");
    return runCommand(target.adb, [...adbArguments(target), ...args], signal);
  }
  async openVideo(server: string, packet: (packet: AndroidVideoPacket) => void, failed: () => void, signal: AbortSignal): Promise<() => Promise<void>> {
    if (!this.available || this.current.phase !== "running" || !this.target) throw new Error("android_not_running");
    const target = this.target;
    await this.video?.close(); signal.throwIfAborted();
    if (this.target !== target || this.current.phase !== "running") throw new Error("android_not_running");
    const stream = new AndroidVideoStream(target.adb, adbArguments(target));
    this.video = stream;
    const abort = () => { void stream.close(); };
    signal.addEventListener("abort", abort, { once: true });
    try { await stream.start(server, packet, failed); }
    catch (error) { signal.removeEventListener("abort", abort); throw error; }
    return async () => { signal.removeEventListener("abort", abort); await stream.close(); };
  }
  touch(conversationId: string, events: AndroidTouch[]): void {
    this.assertAccess(conversationId);
    if (!this.available || this.current.phase !== "running" || !this.video) throw new Error("android_video_not_connected");
    this.automation?.invalidate();
    this.video.touch(events);
  }
  async stopFor(conversationId: string): Promise<void> { this.assertAccess(conversationId); await this.stop(); }
  type(conversationId: string, text: string): void {
    this.assertAccess(conversationId);
    if (!this.available || this.current.phase !== "running" || !this.video) throw new Error("android_video_not_connected");
    this.automation?.invalidate();
    this.video.type(text);
  }
  stop(): Promise<void> { return this.stopping ??= this.disconnect().finally(() => { this.stopping = undefined; }); }
  private async disconnect(): Promise<void> {
    this.monitor?.abort(); this.monitor = undefined;
    this.update({ phase: "stopping", error: undefined });
    this.bootController?.abort();
    if (this.boot) await this.boot.catch(() => undefined);
    await this.releasing; this.releasing = undefined;
    await this.automation?.close(); this.automation = undefined;
    await this.video?.close(); this.video = undefined;
    await this.pendingAction.catch(() => undefined);
    await this.managed?.close(); this.managed = undefined;
    this.target = undefined;
    this.update({ phase: "stopped" });
  }
  async screenshot(conversationId: string, signal?: AbortSignal, delayMs = 0) {
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5000) throw new Error("android_invalid_timeout");
    return this.enqueue(conversationId, async (automation, target) => {
      if (delayMs > 0) await delay(delayMs, undefined, { signal: signal ? AbortSignal.any([signal, automation.signal]) : automation.signal });
      const before = await automation.screen(signal);
      const png = await this.adb(["exec-out", "screencap", "-p"], signal, target);
      if (png.length < 24 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("android_invalid_screenshot");
      const screen = await automation.screen(signal);
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
      if (before.rotation !== screen.rotation || screen.width !== width || screen.height !== height) throw new Error("android_layout_changed");
      return { contentKind: "image" as const, dataUrl: `data:image/png;base64,${png.toString("base64")}`, mimeType: "image/png", byteLength: png.length, width, height, screen };
    }, signal);
  }
  async snapshot(conversationId: string, signal?: AbortSignal) {
    return this.enqueue(conversationId, (automation) => automation.snapshot(signal), signal);
  }
  async act(conversationId: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.enqueue(conversationId, (automation, target) => automation.act(args, (command) => this.adb(command, signal, target), signal), signal);
  }
  private enqueue<T>(conversationId: string, execute: (automation: AndroidAutomation, target: AdbTarget) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertAccess(conversationId);
    const target = this.target;
    const automation = this.automation;
    if (!target || !automation || this.current.phase !== "running") throw new Error("android_not_running");
    const operation = this.pendingAction.then(() => {
      this.assertAccess(conversationId);
      if (!this.available || this.current.phase !== "running" || this.target !== target || this.automation !== automation) throw new Error("android_not_running");
      signal?.throwIfAborted();
      return execute(automation, target);
    });
    this.pendingAction = operation.catch(() => undefined);
    return operation;
  }

  async close(): Promise<void> { await this.stop(); }
}
