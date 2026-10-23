import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { runCommand } from "../command.js";
import { SCRCPY_VERSION } from "./server.js";
import { ScrcpyProtocol, type AndroidVideoPacket } from "./protocol.js";
import { encodeTouch } from "./touch.js";
import type { AndroidTouch } from "../types.js";

export class AndroidVideoStream {
  private child?: ChildProcess;
  private socket?: Socket;
  private control?: Socket;
  private pressed?: AndroidTouch;
  private closing?: Promise<void>;
  private ending = false;
  private port?: string;
  private readonly controller = new AbortController();
  constructor(private readonly adb: string, private readonly args: string[]) {}
  private command(args: string[]) { return runCommand(this.adb, [...this.args, ...args], this.controller.signal); }

  async start(server: string, packet: (packet: AndroidVideoPacket) => void, failed: () => void): Promise<void> {
    const id = randomBytes(4).readUInt32BE() & 0x7fffffff;
    const remote = `/data/local/tmp/ohmycode-scrcpy-${id}.jar`;
    try {
      await this.command(["push", server, remote]);
      this.port = (await this.command(["forward", "tcp:0", `localabstract:scrcpy_${id.toString(16).padStart(8, "0")}`])).toString().trim();
      this.child = spawn(this.adb, [...this.args, "shell", `CLASSPATH=${remote}`, "app_process", "/", "com.genymobile.scrcpy.Server", SCRCPY_VERSION, `scid=${id.toString(16)}`, "audio=false", "control=true", "clipboard_autosync=false", "tunnel_forward=true", "send_device_meta=false", "video_codec=h264", "max_size=1280", "max_fps=30", "video_bit_rate=4000000", "video_codec_options=i-frame-interval=1"], { windowsHide: true, stdio: "ignore" });
      this.child.once("error", () => { if (!this.ending) failed(); });
      this.child.once("exit", () => { if (!this.ending) failed(); });
      const protocol = new ScrcpyProtocol(packet);
      // adb forward may accept TCP before the device-side socket is listening.
      const deadline = Date.now() + 10_000;
      while (true) {
        this.controller.signal.throwIfAborted();
        try {
          await new Promise<void>((resolve, reject) => {
            const socket = createConnection({ host: "127.0.0.1", port: Number(this.port) });
            socket.setTimeout(10_000, () => socket.destroy(new Error("android_video_connect_timeout")));
            this.socket = socket;
            const abort = () => socket.destroy(new Error("android_video_stopped"));
            this.controller.signal.addEventListener("abort", abort, { once: true });
            socket.once("close", () => this.controller.signal.removeEventListener("abort", abort));
            socket.once("error", reject);
            socket.once("data", (data) => {
              socket.removeListener("error", reject);
              socket.setTimeout(0);
              socket.on("data", (bytes) => { if (!this.ending) { try { protocol.push(Buffer.from(bytes)); } catch { failed(); } } });
              socket.on("error", () => { if (!this.ending) failed(); });
              socket.once("close", () => { if (!this.ending) failed(); });
              try { protocol.push(Buffer.from(data)); resolve(); } catch (error) { reject(error); }
            });
            socket.once("close", () => reject(new Error("android_video_connect_failed")));
          });
          break;
        } catch (error) {
          this.socket?.destroy();
          if (Date.now() >= deadline || this.controller.signal.aborted) throw error;
          await delay(100, undefined, { signal: this.controller.signal });
        }
      }
      this.controller.signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const control = createConnection({ host: "127.0.0.1", port: Number(this.port) });
        this.control = control;
        control.once("error", reject);
        control.once("connect", () => {
          control.removeListener("error", reject);
          control.on("error", () => { if (!this.ending) failed(); });
          control.on("data", () => {});
          control.once("close", () => { if (!this.ending) failed(); });
          resolve();
        });
      });
      this.controller.signal.throwIfAborted();
    } catch (error) { await this.close(); throw error; }
  }
  touch(events: AndroidTouch[]): void {
    if (!this.control?.writable || this.controller.signal.aborted) throw new Error("android_video_not_connected");
    if (!Array.isArray(events) || events.length > 256) throw new Error("android_invalid_touch");
    const packets = events.map(encodeTouch);
    for (let index = 0; index < events.length; index++) {
      this.control.write(packets[index]);
      this.pressed = events[index].action === "up" ? undefined : events[index];
    }
  }
  close(): Promise<void> {
    return this.closing ??= this.dispose();
  }
  private async dispose(): Promise<void> {
    this.ending = true;
    if (this.control) {
      const control = this.control; this.control = undefined;
      const release = this.pressed ? encodeTouch({ ...this.pressed, action: "up" }) : Buffer.alloc(0);
      this.pressed = undefined;
      if (!control.destroyed) await new Promise<void>((resolve) => {
        control.once("close", resolve);
        control.setTimeout(500, () => control.destroy());
        control.end(release);
      });
    }
    this.controller.abort();
    this.socket?.destroy();
    this.child?.kill();
    if (this.port) {
      const port = this.port; this.port = undefined;
      await runCommand(this.adb, [...this.args, "forward", "--remove", `tcp:${port}`]).catch(() => {});
    }
  }
}
