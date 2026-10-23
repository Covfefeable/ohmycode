import type { WebContents } from "electron";
import { NetworkDiagnostics } from "./network-diagnostics.js";
import { ConsoleDiagnostics } from "./console-diagnostics.js";

type PageDialog = { type: string; message: string };

/** Owns page-level CDP events; never attaches to the application's renderer. */
export class PageSession {
  dialog: PageDialog | null = null;
  private opened: (() => void) | undefined;
  readonly network: NetworkDiagnostics;
  readonly console = new ConsoleDiagnostics();

  constructor(private readonly page: WebContents) { this.network = new NetworkDiagnostics(page); }

  async initialize(): Promise<void> {
    this.page.debugger.attach("1.3");
    this.page.debugger.on("message", (_event, method, params) => {
      this.network.handle(method, params);
      this.console.handle(method, params);
      if (method === "Page.javascriptDialogOpening") {
        this.dialog = { type: params.type, message: params.message };
        this.opened?.();
      } else if (method === "Page.javascriptDialogClosed") this.dialog = null;
    });
    await this.page.debugger.sendCommand("Page.enable");
    await this.page.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: true });
    await this.network.initialize();
    await this.page.debugger.sendCommand("Runtime.enable");
  }

  async handleDialog(accept: boolean): Promise<{ handled: boolean }> {
    if (!this.dialog) throw new Error("browser_no_dialog");
    await this.page.debugger.sendCommand("Page.handleJavaScriptDialog", { accept });
    this.dialog = null;
    return { handled: true };
  }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T | { dialog: PageDialog }> {
    if (this.dialog) return { dialog: this.dialog };
    signal?.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const boundary = new Promise<never | { dialog: PageDialog }>((resolve, reject) => {
      this.opened = () => resolve({ dialog: this.dialog! });
      const stop = (error: unknown) => {
        void this.page.debugger.sendCommand("Runtime.terminateExecution").catch(() => undefined);
        reject(error);
      };
      timer = setTimeout(() => stop(new Error("browser_operation_timeout")), 30_000);
      abort = () => stop(signal!.reason);
      signal?.addEventListener("abort", abort, { once: true });
    });
    try { return await Promise.race([operation(), boundary]); }
    finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
      this.opened = undefined;
    }
  }
}
