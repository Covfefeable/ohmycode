import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { androidHost, androidInstallation, chooseAndroidInstallRoot, chooseAndroidSdk, getAndroidState, installAndroid, openAndroidGuide, openAndroidLicense, rediscoverAndroidDevices, setAndroidEnabled, startAndroid, selectAndroidTarget, addAndroidConnection, removeAndroidDevice } from "../android/android-service.js";
import type { AndroidAction, AndroidTouch, AndroidInstallMode } from "@ohmycode/android-use";
import { androidDetached, setAndroidDetached, startAndroidVideo, stopAndroidVideo, touchAndroid, typeAndroid } from "../android/android-presentation.js";

function windowFor(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error("android_invalid_sender");
  return window;
}

export function registerAndroidIpc(): void {
  const installMode = (value: unknown): AndroidInstallMode => {
    if (value === undefined) return "runtime";
    if (value !== "runtime" && value !== "tools") throw new Error("android_invalid_configuration");
    return value;
  };
  ipcMain.handle("android:select-target", (event, target: unknown) => { windowFor(event); return selectAndroidTarget(target); });
  ipcMain.handle("android:connect", (event, address: unknown, name: unknown) => { windowFor(event); return addAndroidConnection(address, name); });
  ipcMain.handle("android:remove-device", (event, serial: unknown) => { windowFor(event); return removeAndroidDevice(serial); });
  ipcMain.handle("android:touch", (event, conversationId: string, events: AndroidTouch[]) => { windowFor(event); touchAndroid(event.sender, conversationId, events); });
  ipcMain.handle("android:type", (event, conversationId: string, text: string) => { windowFor(event); typeAndroid(event.sender, conversationId, text); });
  ipcMain.handle("android:detached", (event) => { windowFor(event); return androidDetached(); });
  ipcMain.handle("android:set-detached", (event, value: boolean) => {
    const window = windowFor(event);
    if (typeof value !== "boolean") throw new Error("android_invalid_configuration");
    return setAndroidDetached(window, value);
  });
  ipcMain.handle("android:video-start", (event, id: string) => {
    windowFor(event);
    if (typeof id !== "string" || id.length > 100) throw new Error("android_invalid_configuration");
    return startAndroidVideo(event.sender, id);
  });
  ipcMain.handle("android:video-stop", (event, id: string) => { windowFor(event); return stopAndroidVideo(event.sender, id); });
  ipcMain.handle("android:state", (event) => { windowFor(event); return getAndroidState(); });
  ipcMain.handle("android:refresh", (event) => { windowFor(event); return rediscoverAndroidDevices(); });
  ipcMain.handle("android:choose-sdk", (event) => chooseAndroidSdk(windowFor(event)));
  ipcMain.handle("android:enabled", (event, enabled: boolean) => {
    windowFor(event);
    if (typeof enabled !== "boolean") throw new Error("android_invalid_configuration");
    return setAndroidEnabled(enabled);
  });
  ipcMain.handle("android:guide", (event) => { windowFor(event); return openAndroidGuide(); });
  ipcMain.handle("android:license", (event) => { windowFor(event); return openAndroidLicense(); });
  ipcMain.handle("android:install-plan", async (event, mode: unknown) => { windowFor(event); return (await androidInstallation()).plan(installMode(mode)); });
  ipcMain.handle("android:installation", async (event) => { windowFor(event); return (await androidInstallation()).state(); });
  ipcMain.handle("android:install-root", (event, mode: unknown) => chooseAndroidInstallRoot(windowFor(event), installMode(mode)));
  ipcMain.handle("android:install", (event, consent: boolean, mode: unknown) => { windowFor(event); return installAndroid(consent, installMode(mode)); });
  ipcMain.handle("android:cancel-install", async (event) => { windowFor(event); return (await androidInstallation()).cancel(); });
  ipcMain.handle("android:start", (event, conversationId: string) => { windowFor(event); return startAndroid(conversationId); });
  ipcMain.handle("android:stop", async (event) => { windowFor(event); await androidHost().stop(); return androidHost().state(); });
  ipcMain.handle("android:act", (event, conversationId: string, action: AndroidAction) => { windowFor(event); return androidHost().act(conversationId, action); });
}
