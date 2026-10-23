import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { net } from "electron";
import { checkVirtualization, installRuntime, runtimeComponents, REQUIRED_FREE_BYTES, SDK_LICENSE_URL, type AndroidInstallPlan, type AndroidInstallState, type AndroidInstallMode } from "@ohmycode/android-use";

/** App-owned job: IPC acknowledges immediately, progress survives renderer navigation. */
export class AndroidInstallation {
  private current: AndroidInstallState;
  private job?: Promise<void>;
  private controller?: AbortController;

  constructor(root: string, private readonly changed: (state: AndroidInstallState) => void, private readonly installed: (sdkPath: string, mode: AndroidInstallMode) => Promise<void>) {
    this.current = { root, mode: "runtime", phase: "idle", receivedBytes: 0, totalBytes: 0 };
  }
  get active(): boolean { return Boolean(this.job); }
  state(): AndroidInstallState { return { ...this.current }; }
  setRoot(root: string): void {
    if (this.active) throw new Error("android_install_in_progress");
    this.update({ root, phase: "idle", receivedBytes: 0, totalBytes: 0, error: undefined, component: undefined });
  }
  plan(mode: AndroidInstallMode = "runtime"): AndroidInstallPlan {
    const components = this.components(mode);
    return { mode, root: this.current.root, licenseUrl: SDK_LICENSE_URL, requiredFreeBytes: mode === "tools" ? 512 * 1024 ** 2 : REQUIRED_FREE_BYTES, components: components.map(({ id, version, bytes }) => ({ id, version, bytes })), totalBytes: components.reduce((sum, item) => sum + item.bytes, 0) };
  }
  private components(mode: AndroidInstallMode) { return runtimeComponents().filter((component) => mode === "runtime" || component.id === "platformTools"); }
  start(consent: boolean, mode: AndroidInstallMode = "runtime"): AndroidInstallState {
    if (consent !== true) throw new Error("android_install_license_required");
    if (this.job) return this.state();
    const components = this.components(mode);
    this.controller = new AbortController();
    this.update({ mode, phase: "checking", receivedBytes: 0, totalBytes: this.plan(mode).totalBytes, error: undefined, component: undefined });
    this.job = this.perform(components, this.controller.signal).finally(() => { this.job = undefined; this.controller = undefined; });
    return this.state();
  }
  async cancel(): Promise<AndroidInstallState> {
    // Final activation publishes local settings atomically and must finish before app shutdown.
    if (this.current.phase !== "finishing") this.controller?.abort();
    await this.job;
    return this.state();
  }
  private update(change: Partial<AndroidInstallState>): void {
    this.current = { ...this.current, ...change };
    this.changed(this.state());
  }
  private async perform(components: ReturnType<typeof runtimeComponents>, signal: AbortSignal): Promise<void> {
    try {
      if (this.current.mode === "runtime") await checkVirtualization();
      signal.throwIfAborted();
      const sdkPath = await installRuntime({ root: this.current.root, components, signal, requiredFreeBytes: this.plan(this.current.mode).requiredFreeBytes, fetcher: (url, init) => net.fetch(url, init), onProgress: (progress) => this.update(progress) });
      // Receipt records explicit UI consent; it is not an assertion of redistribution rights.
      await mkdir(this.current.root, { recursive: true });
      await writeFile(path.join(this.current.root, "sdk-license.json"), JSON.stringify({ url: SDK_LICENSE_URL, acceptedAt: new Date().toISOString() }));
      await this.installed(sdkPath, this.current.mode);
      this.update({ phase: "completed", component: undefined });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const message = error instanceof Error && error.message.startsWith("android_install_") ? error.message : code === "ENOSPC" ? "android_install_disk_space" : code === "EACCES" || code === "EPERM" ? "android_install_permission" : "android_install_failed";
      this.update({ phase: signal.aborted ? "canceled" : "error", error: signal.aborted ? undefined : message });
    }
  }
}
