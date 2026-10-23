import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runCommand } from "./command.js";
import type { AdbTarget, AndroidEnvironment } from "./types.js";

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


/** Lifecycle ownership is limited to the emulator and ADB server created here. */
export class ManagedEmulator {
  private process?: ChildProcess;
  private serial = "";
  private adbPort = 0;
  constructor(private readonly dataRoot: string, private readonly environment: AndroidEnvironment, private readonly exited: () => void) {}
  async start(signal: AbortSignal): Promise<AdbTarget> {
    const environment = this.environment!;
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
          this.exited();
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
        if (result.toString().trim() === "1") return { adb: environment.adb, serial: this.serial, serverPort: this.adbPort };
        await delay(1000, undefined, { signal });
      }
      throw new Error("android_boot_timeout");
    } catch (error) {
      if (child && this.process === child) { this.process = undefined; await this.stopChild(child); }
      throw error;
    }
  }
  private adb(args: string[], signal?: AbortSignal): Promise<Buffer> {
    return runCommand(this.environment!.adb, ["-P", String(this.adbPort), "-s", this.serial, ...args], signal);
  }
  private async stopChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await this.adb(["emu", "kill"]).catch(() => { child.kill(); });
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }

  async close(): Promise<void> {
    const child = this.process;
    if (child) { await this.stopChild(child); this.process = undefined; }
    if (this.adbPort) {
      await runCommand(this.environment.adb, ["-P", String(this.adbPort), "kill-server"]).catch(() => undefined);
      this.adbPort = 0;
    }
  }
}
