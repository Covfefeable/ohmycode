import { app, type DownloadItem, type Session, type WebContents } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { browserUrl } from "./types.js";

type Download = { id: string; pageId: string; filename: string; path: string; state: string; receivedBytes: number; totalBytes: number; error?: string };

/** Track only this host's pages, including downloads initiated by page clicks. */
export class BrowserDownloads {
  private readonly records = new Map<string, { owner: string; item?: DownloadItem; info: Download }>();

  constructor(private readonly session: Session, private readonly owner: (page: WebContents) => { conversationId: string; pageId: string } | undefined) {
    session.on("will-download", this.onDownload);
  }

  private readonly onDownload = (_event: Electron.Event, item: DownloadItem, page: WebContents) => {
    const owner = this.owner(page);
    if (!owner) return;
    const id = crypto.randomUUID();
    const filename = [...item.getFilename()].map((char) => char.charCodeAt(0) < 32 ? "_" : char).join("").replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/, "") || "download";
    const directory = join(app.getPath("downloads"), "OhMyCode", id);
    const info: Download = { id, pageId: owner.pageId, filename, path: join(directory, filename), state: "progressing", receivedBytes: 0, totalBytes: item.getTotalBytes() };
    const record: { owner: string; item?: DownloadItem; info: Download } = { owner: owner.conversationId, info };
    this.records.set(id, record);
    try { mkdirSync(directory, { recursive: true }); }
    catch (error) { info.state = "failed"; info.error = String(error); item.cancel(); return; }
    item.setSavePath(info.path);
    record.item = item;
    item.on("updated", (_event, state) => { info.state = state; info.receivedBytes = item.getReceivedBytes(); info.totalBytes = item.getTotalBytes(); });
    item.once("done", (_event, state) => { info.state = state; info.receivedBytes = item.getReceivedBytes(); record.item = undefined; });
  };

  execute(id: string, page: WebContents, args: Record<string, unknown>): unknown {
    if (args.action === "list") return { downloads: [...this.records.values()].filter((record) => record.owner === id).map(({ info }) => ({ ...info })) };
    if (args.action === "start") {
      const url = browserUrl(String(args.url));
      if (url === "about:blank") throw new Error("browser_download_url_required");
      page.downloadURL(url);
      return { requested: true, url, message: "Download requested. Query list to check progress and the saved path; this is not a completion confirmation." };
    }
    if (args.action === "cancel") {
      const record = this.records.get(String(args.downloadId));
      if (!record || record.owner !== id) throw new Error("browser_download_not_found");
      record.item?.cancel();
      return { ...record.info };
    }
    throw new Error("browser_invalid_download_action");
  }

  closeSession(id: string): void {
    for (const [key, record] of this.records) {
      if (record.owner !== id) continue;
      record.item?.cancel();
      this.records.delete(key);
    }
  }

  close(): void {
    this.session.removeListener("will-download", this.onDownload);
    for (const record of this.records.values()) this.closeSession(record.owner);
  }
}
