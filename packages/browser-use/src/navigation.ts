import { setImmediate } from "node:timers/promises";
import type { WebContents } from "electron";

/** Wait for an actual loading cycle, not a fixed sleep after every interaction. */
export async function waitForPage(page: WebContents): Promise<void> {
  await setImmediate();
  if (!page.isLoading()) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      page.removeListener("did-stop-loading", loaded);
      page.removeListener("destroyed", closed);
      if (error) reject(error); else resolve();
    };
    const loaded = () => finish();
    const closed = () => finish(new Error("browser_page_closed"));
    const timer = setTimeout(() => { finish(new Error("browser_navigation_timeout")); page.stop(); }, 30_000);
    page.once("did-stop-loading", loaded);
    page.once("destroyed", closed);
  });
}
