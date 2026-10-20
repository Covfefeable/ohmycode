import { nativeImage, session, WebContentsView, type BrowserWindow } from "electron";
import type { BrowserBounds, BrowserCommand, BrowserState } from "./types.js";
import { browserUrl, fitBounds } from "./types.js";
import { pageAction, pageSnapshot } from "./page-tools.js";
import { waitForPage } from "./navigation.js";

type Tab = { id: string; view: WebContentsView; presented: boolean; error?: string };
type BrowserSession = { tabs: Map<string, Tab>; selectedId: string | null; opened: boolean };

/** Owns only browser views. Never attaches a debugger to the application's renderer. */
export class BrowserHost {
  private readonly sessions = new Map<string, BrowserSession>();
  private activeId: string | null = null;
  private bounds: BrowserBounds | null = null;
  private mounted: WebContentsView | null = null;
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(private readonly window: BrowserWindow, private readonly onChange: (id: string, state: BrowserState) => void) {
    const browserSession = session.fromPartition("persist:ohmycode-browser");
    browserSession.setPermissionRequestHandler((_page, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    window.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) this.layout(null, null);
    });
    window.once("closed", () => this.close());
  }

  state(id: string): BrowserState {
    const session = this.sessions.get(id);
    return {
      opened: session?.opened ?? false,
      selectedId: session?.selectedId ?? null,
      tabs: [...(session?.tabs.values() ?? [])].map((tab) => ({
        id: tab.id, title: tab.view.webContents.getTitle(), url: tab.view.webContents.getURL(),
        loading: tab.view.webContents.isLoading(),
        canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
        canGoForward: tab.view.webContents.navigationHistory.canGoForward(),
        ...(tab.error ? { error: tab.error } : {}),
      })),
    };
  }

  layout(id: string | null, bounds: BrowserBounds | null): void {
    this.activeId = id;
    this.bounds = bounds;
    this.syncView();
  }

  setOpened(id: string, opened: boolean): BrowserState {
    this.session(id).opened = opened;
    this.changed(id);
    return this.state(id);
  }

  async command(id: string, command: BrowserCommand): Promise<BrowserState> {
    const session = this.session(id);
    if (command.action === "new") {
      await this.newTab(id, command.url ?? "about:blank");
    } else if (command.action === "select") {
      this.tab(id, command.tabId);
      session.selectedId = command.tabId;
    } else if (command.action === "close") {
      const tab = this.tab(id, command.tabId);
      session.tabs.delete(tab.id);
      if (session.selectedId === tab.id) session.selectedId = session.tabs.keys().next().value ?? null;
      this.syncView();
      this.window.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    } else {
      const tab = this.tab(id);
      if (command.action === "navigate") await this.navigate(tab, command.url);
      else if (command.action === "back" && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
      else if (command.action === "forward" && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
      else if (command.action === "reload") tab.view.webContents.reload();
      await waitForPage(tab.view.webContents);
    }
    this.changed(id);
    return this.state(id);
  }

  /** Serialize tool actions within a conversation, without blocking another conversation. */
  execute(id: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const session = this.session(id);
    const previous = this.pending.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      signal?.throwIfAborted();
      if (this.sessions.get(id) !== session) throw new Error("browser_session_closed");
      const stopLoading = () => { for (const tab of session.tabs.values()) tab.view.webContents.stop(); };
      signal?.addEventListener("abort", stopLoading, { once: true });
      try {
        const result = await this.executeTool(id, tool, args);
        signal?.throwIfAborted();
        return result;
      } finally { signal?.removeEventListener("abort", stopLoading); }
    });
    this.pending.set(id, current);
    void current.finally(() => { if (this.pending.get(id) === current) this.pending.delete(id); }).catch(() => undefined);
    return current;
  }

  closeSession(id: string): void {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    this.syncView();
    for (const tab of session?.tabs.values() ?? []) {
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    }
  }

  close(): void {
    for (const id of this.sessions.keys()) this.closeSession(id);
  }

  private session(id: string): BrowserSession {
    let session = this.sessions.get(id);
    if (!session) {
      session = { tabs: new Map(), selectedId: null, opened: false };
      this.sessions.set(id, session);
    }
    return session;
  }

  private tab(id: string, tabId?: string): Tab {
    const session = this.sessions.get(id);
    const tab = session?.tabs.get(tabId ?? session.selectedId ?? "");
    if (!tab) throw new Error("browser_tab_not_found");
    return tab;
  }

  private async newTab(id: string, url: string): Promise<Tab> {
    const target = browserUrl(url);
    const view = new WebContentsView({ webPreferences: {
      partition: "persist:ohmycode-browser", contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true,
    } });
    const tab: Tab = { id: crypto.randomUUID(), view, presented: false };
    const [width, height] = this.window.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const session = this.session(id);
    session.tabs.set(tab.id, tab);
    session.selectedId = tab.id;
    session.opened = true;
    const page = view.webContents;
    page.setWindowOpenHandler(({ url: popup }) => {
      void this.newTab(id, popup).catch((error: unknown) => { tab.error = String(error); this.changed(id); });
      return { action: "deny" };
    });
    const validateNavigation = (event: Electron.Event, location: string) => {
      try { browserUrl(location); } catch { event.preventDefault(); }
    };
    page.on("will-navigate", validateNavigation);
    page.on("will-redirect", validateNavigation);
    page.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) { tab.error = description; this.changed(id); }
    });
    page.on("did-start-loading", () => { tab.error = undefined; this.changed(id); });
    const changed = () => this.changed(id);
    page.on("did-stop-loading", changed);
    page.on("did-navigate", changed);
    page.on("did-navigate-in-page", changed);
    page.on("page-title-updated", changed);
    this.changed(id);
    await this.navigate(tab, target);
    // Enable background painting after the renderer exists, including never-shown tabs.
    page.setBackgroundThrottling(false);
    return tab;
  }

  private async navigate(tab: Tab, url: string): Promise<void> {
    const target = browserUrl(url);
    const timer = setTimeout(() => tab.view.webContents.stop(), 30_000);
    try { await tab.view.webContents.loadURL(target); }
    finally { clearTimeout(timer); }
  }

  private async executeTool(id: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const pageId = typeof args.pageId === "string" ? args.pageId : undefined;
    if (tool === "browser_tabs") {
      if (args.action === "list") return this.state(id);
      if (args.action === "new") return this.command(id, { action: "new", url: typeof args.url === "string" ? args.url : undefined });
      if ((args.action === "select" || args.action === "close") && pageId) return this.command(id, { action: args.action, tabId: pageId });
      throw new Error("browser_invalid_tab_action");
    }
    if (tool === "browser_navigate" && args.action === "navigate" && !this.state(id).selectedId) {
      return this.command(id, { action: "new", url: String(args.url) });
    }
    const tab = this.tab(id, pageId);
    this.session(id).selectedId = tab.id;
    this.setOpened(id, true);
    await waitForPage(tab.view.webContents);
    if (tool === "browser_navigate") {
      if (args.action === "navigate") return this.command(id, { action: "navigate", url: String(args.url) });
      if (args.action === "back" || args.action === "forward" || args.action === "reload") return this.command(id, { action: args.action });
      throw new Error("browser_invalid_navigation");
    }
    if (tool === "browser_snapshot") return pageSnapshot(tab.view.webContents);
    if (tool === "browser_act") {
      await pageAction(tab.view.webContents, args);
      await waitForPage(tab.view.webContents);
      return this.state(id);
    }
    if (tool === "browser_screenshot") {
      if (!tab.presented) throw new Error("browser_page_not_presented: open this conversation's browser panel before its first screenshot; text snapshots and page actions work without it");
      const page = tab.view.webContents;
      if (!page.debugger.isAttached()) page.debugger.attach("1.3");
      let timer: ReturnType<typeof setTimeout>;
      const capture = page.debugger.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("browser_screenshot_timeout")), 15_000); });
      const { data } = await Promise.race([capture, timeout]).finally(() => clearTimeout(timer)) as { data: string };
      const bytes = Buffer.from(data, "base64");
      const image = nativeImage.createFromBuffer(bytes);
      return { contentKind: "image", source: "browser", dataUrl: `data:image/png;base64,${data}`, mimeType: "image/png", byteLength: bytes.length, ...image.getSize() };
    }
    throw new Error("browser_unknown_tool");
  }

  private changed(id: string): void {
    this.syncView();
    if (this.sessions.has(id) && !this.window.isDestroyed()) this.onChange(id, this.state(id));
  }

  private syncView(): void {
    if (this.window.isDestroyed()) { this.mounted = null; return; }
    const session = this.activeId ? this.sessions.get(this.activeId) : undefined;
    const next = session?.opened && this.bounds && session.selectedId ? session.tabs.get(session.selectedId)?.view ?? null : null;
    if (this.mounted !== next) {
      if (this.mounted) {
        this.mounted.setVisible(false);
        this.mounted.webContents.setBackgroundThrottling(false);
      }
      if (next) {
        next.setVisible(true);
        if (session?.selectedId) session.tabs.get(session.selectedId)!.presented = true;
      }
      this.mounted = next;
    }
    if (next && this.bounds) next.setBounds(fitBounds(this.bounds, this.window.getContentSize()));
  }
}
