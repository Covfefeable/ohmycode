const { app, BrowserWindow } = require("electron");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

app.setPath("userData", process.env.BROWSER_TEST_PROFILE);
app.setAppPath(resolve(__dirname, "../.."));
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const load = (file) => import(pathToFileURL(resolve(app.getAppPath(), "dist-electron", file)).href);
  const { registerBrowserIpc } = await load("ipc/register-browser-ipc.js");
  const { browserContext } = await load("browser/browser-service.js");
  registerBrowserIpc();
  const owner = new BrowserWindow({ show: false });
  await owner.loadURL("about:blank");
  const context = browserContext(owner);
  await context.host.command("thread", { action: "new", url: process.env.BROWSER_TEST_URL });
  globalThis.browserTest = { owner, context };
});
