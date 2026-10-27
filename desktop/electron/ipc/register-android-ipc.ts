import { handleInvoke } from "./handle-invoke.js";
import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
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
  handleInvoke("android:select-target", (event, target: unknown) => { windowFor(event); return selectAndroidTarget(target); });
  handleInvoke("android:connect", (event, address: unknown, name: unknown) => { windowFor(event); return addAndroidConnection(address, name); });
  handleInvoke("android:remove-device", (event, serial: unknown) => { windowFor(event); return removeAndroidDevice(serial); });
  handleInvoke("android:touch", (event, conversationId: string, events: AndroidTouch[]) => { windowFor(event); touchAndroid(event.sender, conversationId, events); });
  handleInvoke("android:type", (event, conversationId: string, text: string) => { windowFor(event); typeAndroid(event.sender, conversationId, text); });
  handleInvoke("android:detached", (event) => { windowFor(event); return androidDetached(); });
  handleInvoke("android:set-detached", (event, value: boolean, conversationId: string) => {
    const window = windowFor(event);
    if (typeof value !== "boolean") throw new Error("android_invalid_configuration");
    return setAndroidDetached(window, value, conversationId);
  });
  handleInvoke("android:video-start", (event, id: string, conversationId: string) => {
    windowFor(event);
    if (typeof id !== "string" || id.length > 100) throw new Error("android_invalid_configuration");
    return startAndroidVideo(event.sender, id, conversationId);
  });
  handleInvoke("android:video-stop", (event, id: string) => { windowFor(event); return stopAndroidVideo(event.sender, id); });
  handleInvoke("android:state", (event) => { windowFor(event); return getAndroidState(); });
  handleInvoke("android:refresh", (event) => { windowFor(event); return rediscoverAndroidDevices(); });
  handleInvoke("android:choose-sdk", (event) => chooseAndroidSdk(windowFor(event)));
  handleInvoke("android:enabled", (event, enabled: boolean) => {
    windowFor(event);
    if (typeof enabled !== "boolean") throw new Error("android_invalid_configuration");
    return setAndroidEnabled(enabled);
  });
  handleInvoke("android:guide", (event) => { windowFor(event); return openAndroidGuide(); });
  handleInvoke("android:license", (event) => { windowFor(event); return openAndroidLicense(); });
  handleInvoke("android:install-plan", async (event, mode: unknown) => { windowFor(event); return (await androidInstallation()).plan(installMode(mode)); });
  handleInvoke("android:installation", async (event) => { windowFor(event); return (await androidInstallation()).state(); });
  handleInvoke("android:install-root", (event, mode: unknown) => chooseAndroidInstallRoot(windowFor(event), installMode(mode)));
  handleInvoke("android:install", (event, consent: boolean, mode: unknown) => { windowFor(event); return installAndroid(consent, installMode(mode)); });
  handleInvoke("android:cancel-install", async (event) => { windowFor(event); return (await androidInstallation()).cancel(); });
  handleInvoke("android:start", (event, conversationId: string) => { windowFor(event); return startAndroid(conversationId); });
  handleInvoke("android:stop", async (event, conversationId: string) => { windowFor(event); await androidHost().stopFor(conversationId); return androidHost().state(); });
  handleInvoke("android:act", async (event, conversationId: string, action: AndroidAction): Promise<void> => { windowFor(event); await androidHost().act(conversationId, action); });
}
