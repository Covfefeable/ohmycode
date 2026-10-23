import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { actionArguments, runCommand } from "./command.js";
import { compactSnapshot } from "./snapshot.js";
import type { AndroidEnvironment, AndroidState, AndroidTouch } from "./types.js";
import { AndroidVideoStream } from "./video/stream.js";
import type { AndroidVideoPacket } from "./video/protocol.js";

async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
async function emulatorPort(): Promise<number> {
  for (let port = 5554; port <= 5682; port += 2) {
    if (await portAvailable(port) && await portAvailable(port + 1)) return port;
  }
  throw new Error("android_no_free_port");
}
async function privateAdbPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("android_no_free_port")); return; }
      server.close(() => resolve(address.port));
    });
  });
}

/** One managed emulator, never attaches to or kills the user's other Android devices. */
export class AndroidHost {
  private environment?: AndroidEnvironment;
  private process?: ChildProcess;
  private boot?: Promise<void>;
  private stopping?: Promise<void>;
  private bootController?: AbortController;
  private serial = "";
  private adbPort = 0;
  private video?: AndroidVideoStream;
  async openVideo(server: string, packet: (packet: AndroidVideoPacket) => void, failed: () => void, signal: AbortSignal): Promise<() => Promise<void>> {
    if (!this.available || this.current.phase !== "running") throw new Error("android_not_running");
    await this.video?.close();
    signal.throwIfAborted();
    const stream = new AndroidVideoStream(this.environment!.adb, ["-P", String(this.adbPort), "-s", this.serial]);
    this.video = stream;
    const abort = () => { void stream.close(); };
    signal.addEventListener("abort", abort, { once: true });
    try { await stream.start(server, packet, failed); }
    catch (error) { signal.removeEventListener("abort", abort); throw error; }
    return async () => { signal.removeEventListener("abort", abort); await stream.close(); };
  }
  private pendingAction: Promise<unknown> = Promise.resolve();
  touch(conversationId: string, events: AndroidTouch[]): void {
    this.assertAccess(conversationId);
    if (!this.available || this.current.phase !== "running" || !this.video) throw new Error("android_video_not_connected");
    this.video.touch(events);
  }
  private current: AndroidState = { enabled: false, installed: false, sdkPath: "", phase: "stopped" };

  constructor(private readonly dataRoot: string, private readonly changed: (state: AndroidState) => void) {}
  state(): AndroidState { return { ...this.current }; }
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
  async stopFor(conversationId: string): Promise<void> {
    this.assertAccess(conversationId);
    await this.stop();
  }
  configure(enabled: boolean, sdkPath: string, environment?: AndroidEnvironment, issue?: AndroidState["issue"]): void {
    if (this.process || this.boot || this.stopping) throw new Error("android_stop_before_configure");
    this.environment = environment;
    this.update({ enabled, sdkPath, installed: Boolean(environment), imageName: environment?.imageName, issue, error: undefined, phase: "stopped" });
  }
  async start(conversationId: string, signal?: AbortSignal): Promise<void> {
    if (this.stopping) await this.stopping;
    if (!this.available) throw new Error("android_not_available");
    signal?.throwIfAborted();
    this.assertAccess(conversationId);
    this.update({ ownerConversationId: conversationId });
    if (this.current.phase === "running") return;
    if (!this.boot) {
      this.bootController = new AbortController();
      const abort = () => this.bootController?.abort();
      signal?.addEventListener("abort", abort, { once: true });
      this.boot = this.launch(this.bootController.signal).finally(() => {
        signal?.removeEventListener("abort", abort);
        this.boot = undefined;
        this.bootController = undefined;
      });
    }
    await this.boot;
    signal?.throwIfAborted();
  }
  private async launch(signal: AbortSignal): Promise<void> {
    const environment = this.environment!;
    this.update({ phase: "starting", error: undefined });
    let child: ChildProcess | undefined;
    try {
      const avdHome = path.join(this.dataRoot, "avd");
      const avdPath = path.join(avdHome, "OhMyCode.avd");
      await mkdir(avdPath, { recursive: true });
      await writeFile(path.join(avdHome, "OhMyCode.ini"), `avd.ini.encoding=UTF-8\npath=${avdPath}\n`);
      await writeFile(path.join(avdPath, "config.ini"), [
        "AvdId=OhMyCode", "avd.ini.displayname=OhMyCode", "hw.device.name=OhMyCode",
        `image.sysdir.1=${environment.imagePath}${path.sep}`,
        `abi.type=${process.arch === "arm64" ? "arm64-v8a" : "x86_64"}`,
        `hw.cpu.arch=${process.arch === "arm64" ? "arm64" : "x86_64"}`,
        "hw.lcd.width=720", "hw.lcd.height=1280", "hw.lcd.density=320",
        "hw.keyboard=yes", "hw.ramSize=2048", "disk.dataPartition.size=4G",
        "hw.gpu.enabled=yes", "hw.gpu.mode=auto", "showDeviceFrame=no",
      ].join("\n") + "\n");
      const port = await emulatorPort();
      this.serial = `emulator-${port}`;
      if (!this.adbPort) this.adbPort = await privateAdbPort();
      await runCommand(environment.adb, ["-P", String(this.adbPort), "start-server"], signal);
      signal.throwIfAborted();
      child = spawn(environment.emulator, ["-avd", "OhMyCode", "-port", String(port), "-no-window", "-no-audio", "-no-snapshot", "-cores", "2"], {
        windowsHide: true, stdio: "ignore",
        env: { ...process.env, ANDROID_AVD_HOME: avdHome, ANDROID_HOME: environment.sdkPath, ANDROID_SDK_ROOT: environment.sdkPath, ANDROID_ADB_SERVER_PORT: String(this.adbPort), ADB_SERVER_SOCKET: `tcp:127.0.0.1:${this.adbPort}` },
      });
      this.process = child;
      let exited = false;
      const onExit = () => {
        exited = true;
        if (this.process === child) {
          this.process = undefined;
          this.update({ phase: this.current.phase === "stopping" ? "stopped" : "error", error: this.current.phase === "stopping" ? undefined : "android_emulator_exited" });
        }
      };
      child.once("error", onExit);
      child.once("exit", onExit);
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (exited) throw new Error("android_emulator_exited");
        const result = await this.adb(["shell", "getprop", "sys.boot_completed"], signal).catch((error) => {
          signal.throwIfAborted();
          if (exited) throw error;
          return Buffer.alloc(0);
        });
        if (result.toString().trim() === "1") { this.update({ phase: "running" }); return; }
        await delay(1000, undefined, { signal });
      }
      throw new Error("android_boot_timeout");
    } catch (error) {
      if (child && this.process === child) { this.process = undefined; await this.stopChild(child); }
      this.update({ phase: signal.aborted ? "stopped" : "error", error: signal.aborted ? undefined : error instanceof Error ? error.message : "android_start_failed" });
      throw error;
    }
  }
  private adb(args: string[], signal?: AbortSignal): Promise<Buffer> {
    return runCommand(this.environment!.adb, ["-P", String(this.adbPort), "-s", this.serial, ...args], signal);
  }
  stop(): Promise<void> {
    return this.stopping ??= this.stopProcess().finally(() => { this.stopping = undefined; });
  }
  private async stopChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await this.adb(["emu", "kill"]).catch(() => { child.kill(); });
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  private async stopProcess(): Promise<void> {
    await this.video?.close();
    this.video = undefined;
    this.update({ phase: "stopping", error: undefined });
    this.bootController?.abort();
    if (this.boot) await this.boot.catch(() => undefined);
    const child = this.process;
    if (child) {
      await this.stopChild(child);
      this.process = undefined;
    }
    this.update({ phase: "stopped" });
  }
  async screenshot(conversationId: string, signal?: AbortSignal) {
    this.assertAccess(conversationId);
    if (!this.available || this.current.phase !== "running") throw new Error("android_not_running");
    const png = await this.adb(["exec-out", "screencap", "-p"], signal);
    if (png.length < 24 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("android_invalid_screenshot");
    return { contentKind: "image" as const, dataUrl: `data:image/png;base64,${png.toString("base64")}`, mimeType: "image/png", byteLength: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  }
  async snapshot(conversationId: string, signal?: AbortSignal) {
    this.assertAccess(conversationId);
    if (!this.available || this.current.phase !== "running") throw new Error("android_not_running");
    await this.adb(["shell", "uiautomator", "dump", "/sdcard/ohmycode-window.xml"], signal);
    const xml = (await this.adb(["exec-out", "cat", "/sdcard/ohmycode-window.xml"], signal)).toString();
    return compactSnapshot(xml);
  }
  async act(conversationId: string, args: unknown, signal?: AbortSignal): Promise<{ ok: true }> {
    this.assertAccess(conversationId);
    const command = actionArguments(args);
    const operation = this.pendingAction.then(() => {
      this.assertAccess(conversationId);
      if (!this.available || this.current.phase !== "running") throw new Error("android_not_running");
      signal?.throwIfAborted();
      return this.adb(command, signal);
    });
    this.pendingAction = operation.catch(() => undefined);
    await operation;
    return { ok: true };
  }
  async close(): Promise<void> {
    await this.stop();
    if (this.environment && this.adbPort) await runCommand(this.environment.adb, ["-P", String(this.adbPort), "kill-server"]).catch(() => undefined);
  }
}
