import { app, BrowserWindow, dialog, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AndroidHost, checkEnvironment, checkAdb, sdkCandidates, listDevices, connectDevice, networkAddress, type AndroidDevice, type AndroidTarget, type AndroidState, type AndroidInstallMode } from "@ohmycode/android-use";
import { AndroidInstallation } from "./android-installation.js";

type Configuration = { enabled: boolean; sdkPath: string; installRoot?: string; target: AndroidTarget; connections: { address: string; name: string }[]; removedDevices: string[] };
let host: AndroidHost | undefined;
let configuration: Configuration = { enabled: false, sdkPath: "", target: { kind: "managed" }, connections: [], removedDevices: [] };
let initialization: Promise<void> | undefined;
let refreshing: Promise<AndroidState> | undefined;
let installation: AndroidInstallation | undefined;
const configPath = () => path.join(app.getPath("userData"), "android.json");

export function androidHost(): AndroidHost {
  return host ??= new AndroidHost(path.join(app.getPath("userData"), "android"), (state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("android:state", state);
  });
}
function targetFrom(value: unknown): AndroidTarget {
  if (!value || typeof value !== "object" || !("kind" in value)) throw new Error("android_invalid_configuration");
  if (value.kind === "managed") return { kind: "managed" };
  if (value.kind === "none") return { kind: "none" };
  if (value.kind === "external" && "serial" in value && typeof value.serial === "string" && value.serial.trim() && "name" in value && typeof value.name === "string") return { kind: "external", serial: value.serial, name: value.name };
  throw new Error("android_invalid_configuration");
}
function assertIdle(): void {
  if (installation?.active) throw new Error("android_install_in_progress");
  if (["starting", "running", "stopping"].includes(androidHost().state().phase)) throw new Error("android_stop_before_configure");
}
export function initializeAndroid(): Promise<void> {
  return initialization ??= (async () => {
    try {
      const saved = JSON.parse(await readFile(configPath(), "utf8")) as Partial<Configuration>;
      if (typeof saved.enabled !== "boolean" || typeof saved.sdkPath !== "string") throw new Error("android_invalid_configuration");
      configuration = { enabled: saved.enabled, sdkPath: saved.sdkPath, installRoot: saved.installRoot,
        target: saved.target === undefined ? { kind: "managed" } : targetFrom(saved.target), connections: saved.connections ?? [], removedDevices: saved.removedDevices ?? [] };
      for (const connection of configuration.connections) networkAddress(connection.address);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        androidHost().configure({ ...configuration, devices: [], issue: "configuration_invalid" }); return;
      }
    }
    try { await refreshAndroid(); }
    catch { androidHost().configure({ ...configuration, devices: [], issue: "tools_invalid" }); }
  })();
}
export async function refreshAndroid(next: Configuration = configuration): Promise<AndroidState> {
  if (installation?.active) throw new Error("android_install_in_progress");
  if (refreshing) return refreshing;
  if (["starting", "running", "stopping"].includes(androidHost().state().phase)) return androidHost().state();
  refreshing = configure(next);
  try { return await refreshing; } finally { refreshing = undefined; }
}
async function configure(next: Configuration): Promise<AndroidState> {
    const candidates = next.sdkPath ? [next.sdkPath] : [path.join(next.installRoot ?? path.join(app.getPath("userData"), "android"), "sdk"), ...sdkCandidates()];
    let check = await checkEnvironment(candidates[0]);
    let adb = check.environment?.adb;
    for (const candidate of candidates) {
      if (!adb) adb = (await checkAdb(candidate)).adb;
      if (!check.environment) {
        const alternative = await checkEnvironment(candidate);
        if (alternative.environment || check.issue === "sdk_missing") check = alternative;
      }
    }
    if (!adb && !next.sdkPath) adb = (await checkAdb("")).adb;
    const devices = adb ? (await listDevices(adb)).filter((device) => !next.removedDevices.includes(device.serial)) : [];
    for (const connection of next.connections) {
      const device = devices.find((device) => device.serial === connection.address);
      if (device) device.name = connection.name || device.name;
      else devices.push({ serial: connection.address, name: connection.name || connection.address, transport: "network", status: "offline" });
    }
    if (next.target.kind === "external") {
      const selected = next.target;
      if (!devices.some((device) => device.serial === selected.serial)) devices.push({ serial: selected.serial, name: selected.name, transport: "local", status: "offline" });
    }
    androidHost().configure({ ...next, sdkPath: next.sdkPath || check.sdkPath, adb, environment: check.environment, devices,
      issue: next.target.kind === "managed" ? check.issue : adb ? undefined : "adb_missing" });
    configuration = next;
    return androidHost().state();
}

export async function getAndroidState(): Promise<AndroidState> { await initializeAndroid(); return androidHost().state(); }
async function save(next: Configuration): Promise<AndroidState> {
  if (refreshing) await refreshing;
  assertIdle();
  const state = await refreshAndroid(next);
  await writeFile(configPath(), JSON.stringify(configuration));
  return state;
}
export async function chooseAndroidSdk(window: BrowserWindow): Promise<AndroidState> {
  await initializeAndroid(); assertIdle();
  const selection = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
  if (selection.canceled) return androidHost().state();
  const check = await checkAdb(selection.filePaths[0]);
  if (!check.adb) throw new Error(check.issue === "tools_invalid" ? "android_install_validation_failed" : "android_adb_missing");
  return save({ ...configuration, sdkPath: selection.filePaths[0] });
}
export async function setAndroidEnabled(enabled: boolean): Promise<AndroidState> {
  await initializeAndroid();
  return save({ ...configuration, enabled });
}
export async function selectAndroidTarget(value: unknown): Promise<AndroidState> {
  await initializeAndroid();
  if (refreshing) await refreshing;
  assertIdle();
  const requested = targetFrom(value);
  let target = requested;
  if (requested.kind === "external") {
    const device = androidHost().state().devices.find((device) => device.serial === requested.serial);
    if (!device || device.status !== "device") throw new Error(device?.status === "unauthorized" ? "android_device_unauthorized" : "android_device_offline");
    target = { kind: "external", serial: device.serial, name: device.name };
  }
  return save({ ...configuration, target });
}
export async function addAndroidConnection(address: unknown, name: unknown): Promise<AndroidState> {
  await initializeAndroid(); assertIdle();
  if (typeof name !== "string" || name.length > 100) throw new Error("android_invalid_configuration");
  const endpoint = networkAddress(address);
  const adb = (await checkAdb(configuration.sdkPath)).adb ?? (await checkAdb(androidHost().state().sdkPath)).adb;
  if (!adb) throw new Error("android_adb_missing");
  const device: AndroidDevice = await connectDevice(adb, endpoint);
  return save({ ...configuration, removedDevices: configuration.removedDevices.filter((serial) => serial !== endpoint), connections: [...configuration.connections.filter((item) => item.address !== endpoint), { address: endpoint, name: name.trim() || device.name }] });
}
export async function removeAndroidDevice(serial: unknown): Promise<AndroidState> {
  await initializeAndroid(); assertIdle();
  if (typeof serial !== "string" || !androidHost().state().devices.some((device) => device.serial === serial)) throw new Error("android_device_offline");
  return save({ ...configuration,
    target: configuration.target.kind === "external" && configuration.target.serial === serial ? { kind: "none" } : configuration.target,
    connections: configuration.connections.filter((item) => item.address !== serial),
    removedDevices: [...new Set([...configuration.removedDevices, serial])],
  });
}
export async function rediscoverAndroidDevices(): Promise<AndroidState> {
  await initializeAndroid();
  return save({ ...configuration, removedDevices: [] });
}
export const openAndroidGuide = () => shell.openExternal("https://developer.android.com/studio/run/device");
export const openAndroidLicense = () => shell.openExternal("https://developer.android.com/studio/terms");
export async function androidInstallation(): Promise<AndroidInstallation> {
  await initializeAndroid();
  return installation ??= new AndroidInstallation(configuration.installRoot ?? path.join(app.getPath("userData"), "android"), (state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("android:installation", state);
  }, async (sdkPath, mode) => {
    const check = mode === "runtime" ? await checkEnvironment(sdkPath) : undefined;
    const adb = await checkAdb(sdkPath);
    if (!adb.adb || mode === "runtime" && !check?.environment) throw new Error(check?.issue === "acceleration_unavailable" ? "android_install_acceleration_unavailable" : "android_install_validation_failed");
    await configure({ ...configuration, sdkPath, enabled: true });
    await writeFile(configPath(), JSON.stringify(configuration));
  });
}
export async function chooseAndroidInstallRoot(window: BrowserWindow, mode: AndroidInstallMode = "runtime") {
  const job = await androidInstallation();
  assertIdle();
  const selected = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
  if (!selected.canceled) {
    configuration = { ...configuration, installRoot: path.join(selected.filePaths[0], "OhMyCodeAndroid") };
    await writeFile(configPath(), JSON.stringify(configuration)); job.setRoot(configuration.installRoot!);
  }
  return job.plan(mode);
}
export async function installAndroid(consent: boolean, mode: AndroidInstallMode = "runtime") {
  const job = await androidInstallation();
  if (refreshing) await refreshing;
  if (job.active) return job.state();
  assertIdle();
  const state = androidHost().state();
  if (mode === "runtime" ? state.managedInstalled : state.adbReady) throw new Error("android_install_already_installed");
  return job.start(consent, mode);
}
export async function startAndroid(conversationId: string): Promise<AndroidState> {
  await getAndroidState();
  if (installation?.active) throw new Error("android_install_in_progress");
  await androidHost().start(conversationId); return androidHost().state();
}
export async function closeAndroid(): Promise<void> { await installation?.cancel(); await host?.close(); }
