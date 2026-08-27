import path from "node:path";
import { app, BrowserWindow, shell } from "electron";

function openExternalWebUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  void shell.openExternal(url);
  return true;
}

export async function createMainWindow(): Promise<BrowserWindow> {
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(app.getAppPath(), "build/icon.png"));
  }

  const window = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 760,
    minHeight: 640,
    icon: path.join(app.getAppPath(), "build/icon.png"),
    backgroundColor: "#0b0d10",
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.removeMenu();

  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[renderer] failed to load ${url}: ${code} ${description}`);
  });
  window.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const blocked = key === "f12"
      || (input.control && input.shift && key === "i")
      || (input.meta && input.alt && key === "i");
    if (blocked) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalWebUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL() && openExternalWebUrl(url)) event.preventDefault();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(app.getAppPath(), "dist/index.html"));
  }
  return window;
}
