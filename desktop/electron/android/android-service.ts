import { app, BrowserWindow, dialog, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AndroidHost, checkEnvironment, sdkCandidates, type AndroidState } from "@ohmycode/android-use";
import { AndroidInstallation } from "./android-installation.js";

type Configuration = { enabled: boolean; sdkPath: string; installRoot?: string };
let host: AndroidHost | undefined;
let configuration: Configuration = { enabled: false, sdkPath: "" };
let initialization: Promise<void> | undefined;
let refreshing: Promise<AndroidState> | undefined;
let installation: AndroidInstallation | undefined;
const configPath = () => path.join(app.getPath("userData"), "android.json");

export function androidHost(): AndroidHost {
  return host ??= new AndroidHost(path.join(app.getPath("userData"), "android"), (state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("android:state", state);
  });
}

export function initializeAndroid(): Promise<void> {
  return initialization ??= (async () => {
    try {
      const saved: unknown = JSON.parse(await readFile(configPath(), "utf8"));
      if (!saved || typeof saved !== "object" || !("enabled" in saved) || typeof saved.enabled !== "boolean" || !("sdkPath" in saved) || typeof saved.sdkPath !== "string") throw new Error("android_invalid_configuration");
      const installRoot = "installRoot" in saved && typeof saved.installRoot === "string" ? saved.installRoot : undefined;
      configuration = { enabled: saved.enabled, sdkPath: saved.sdkPath, installRoot };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        androidHost().configure(false, "", undefined, "configuration_invalid");
        return;
      }
    }
    try { await refreshAndroid(); }
    catch { androidHost().configure(false, configuration.sdkPath, undefined, "tools_invalid"); }
  })();
}

export async function refreshAndroid(): Promise<AndroidState> {
  if (installation?.active) throw new Error("android_install_in_progress");
  if (refreshing) return refreshing;
  if (["starting", "running", "stopping"].includes(androidHost().state().phase)) return androidHost().state();
  refreshing = (async () => {
    const candidates = configuration.sdkPath ? [configuration.sdkPath] : sdkCandidates();
    let check = await checkEnvironment(candidates[0] ?? "");
    for (const candidate of candidates.slice(1)) {
      if (check.environment) break;
      const next = await checkEnvironment(candidate);
      if (next.issue !== "sdk_missing") check = next;
    }
    androidHost().configure(configuration.enabled, check.sdkPath, check.environment, check.issue);
    return androidHost().state();
  })();
  try { return await refreshing; }
  finally { refreshing = undefined; }
}

export async function getAndroidState(): Promise<AndroidState> {
  await initializeAndroid();
  return androidHost().state();
}

export async function chooseAndroidSdk(window: BrowserWindow): Promise<AndroidState> {
  await initializeAndroid();
  if (installation?.active) throw new Error("android_install_in_progress");
  if (["starting", "running", "stopping"].includes(androidHost().state().phase)) throw new Error("android_stop_before_configure");
  const selection = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
  if (selection.canceled) return androidHost().state();
  configuration = { ...configuration, sdkPath: selection.filePaths[0] };
  await writeFile(configPath(), JSON.stringify(configuration));
  return refreshAndroid();
}

export async function setAndroidEnabled(enabled: boolean): Promise<AndroidState> {
  await initializeAndroid();
  if (installation?.active) throw new Error("android_install_in_progress");
  if (refreshing) await refreshing;
  if (["starting", "running", "stopping"].includes(androidHost().state().phase)) throw new Error("android_stop_before_configure");
  configuration = { ...configuration, enabled };
  await writeFile(configPath(), JSON.stringify(configuration));
  return refreshAndroid();
}

export const openAndroidGuide = () => shell.openExternal("https://developer.android.com/studio/run/emulator");
export const openAndroidLicense = () => shell.openExternal("https://developer.android.com/studio/terms");

export async function androidInstallation(): Promise<AndroidInstallation> {
  await initializeAndroid();
  return installation ??= new AndroidInstallation(configuration.installRoot ?? path.join(app.getPath("userData"), "android"), (state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("android:installation", state);
  }, async (sdkPath) => {
    const check = await checkEnvironment(sdkPath);
    configuration = { ...configuration, sdkPath, enabled: Boolean(check.environment) };
    await writeFile(configPath(), JSON.stringify(configuration));
    androidHost().configure(configuration.enabled, sdkPath, check.environment, check.issue);
    if (!check.environment) throw new Error(check.issue === "acceleration_unavailable" ? "android_install_acceleration_unavailable" : "android_install_validation_failed");
  });
}

export async function chooseAndroidInstallRoot(window: BrowserWindow) {
  const job = await androidInstallation();
  if (job.active) throw new Error("android_install_in_progress");
  const selected = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
  if (!selected.canceled) {
    configuration = { ...configuration, installRoot: path.join(selected.filePaths[0], "OhMyCodeAndroid") };
    await writeFile(configPath(), JSON.stringify(configuration));
    job.setRoot(configuration.installRoot!);
  }
  return job.plan();
}

export async function installAndroid(consent: boolean) {
  const job = await androidInstallation();
  if (refreshing) await refreshing;
  if (androidHost().state().phase !== "stopped" && androidHost().state().phase !== "error") throw new Error("android_stop_before_configure");
  if (androidHost().state().installed) throw new Error("android_install_already_installed");
  return job.start(consent);
}

export async function startAndroid(conversationId: string): Promise<AndroidState> {
  await getAndroidState();
  if (installation?.active) throw new Error("android_install_in_progress");
  await androidHost().start(conversationId);
  return androidHost().state();
}

export async function closeAndroid(): Promise<void> {
  await installation?.cancel();
  await host?.close();
}
