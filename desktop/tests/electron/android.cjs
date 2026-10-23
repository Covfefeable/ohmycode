const { app, BrowserWindow } = require("electron");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

app.setPath("userData", process.env.ANDROID_TEST_PROFILE);
app.setAppPath(resolve(__dirname, "../.."));
app.whenReady().then(async () => {
  const moduleUrl = pathToFileURL(resolve(app.getAppPath(), "dist-electron/ipc/register-android-ipc.js"));
  const { registerAndroidIpc } = await import(moduleUrl.href);
  registerAndroidIpc();
  const { androidHost } = await import(pathToFileURL(resolve(app.getAppPath(), "dist-electron/android/android-service.js")).href);
  globalThis.androidTest = { snapshot: (id) => androidHost().snapshot(id) };
  const { registerBrowserIpc } = await import(pathToFileURL(resolve(app.getAppPath(), "dist-electron/ipc/register-browser-ipc.js")).href);
  registerBrowserIpc();
  const { registerWindowIpc } = await import(pathToFileURL(resolve(app.getAppPath(), "dist-electron/ipc/register-window-ipc.js")).href);
  registerWindowIpc();
  const window = new BrowserWindow({ show: false, webPreferences: {
    preload: resolve(app.getAppPath(), "dist-electron/preload.cjs"),
    contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  await window.loadURL("about:blank");
});

let closing = false;
app.on("before-quit", (event) => {
  if (closing) return;
  event.preventDefault(); closing = true;
  import(pathToFileURL(resolve(app.getAppPath(), "dist-electron/android/android-service.js")).href)
    .then(({ closeAndroid }) => closeAndroid()).finally(() => app.quit());
});
