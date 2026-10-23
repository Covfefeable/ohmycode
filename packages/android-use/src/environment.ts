import { stat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { runCommand, type CommandRunner } from "./command.js";
import type { AndroidEnvironment, AndroidIssue } from "./types.js";

export type EnvironmentCheck = { environment?: AndroidEnvironment; sdkPath: string; issue?: AndroidIssue };
const isFile = (file: string) => stat(file).then((info) => info.isFile(), () => false);
async function directories(directory: string): Promise<string[]> {
  try { return (await readdir(directory, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export function sdkCandidates(): string[] {
  return [...new Set([
    process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"), "Android", "Sdk") : path.join(homedir(), "Library", "Android", "sdk"),
  ].filter((value): value is string => Boolean(value)))];
}

export async function checkAdb(sdkPath: string, run: CommandRunner = runCommand): Promise<{ adb?: string; issue?: AndroidIssue }> {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const candidates = sdkPath ? [path.join(sdkPath, "platform-tools", `adb${suffix}`), path.join(sdkPath, `adb${suffix}`)] : ["adb"];
  for (const adb of candidates) {
    if (sdkPath && !(await isFile(adb))) continue;
    try { await run(adb, ["version"]); return { adb }; }
    catch { return { issue: "tools_invalid" }; }
  }
  return { issue: "adb_missing" };
}

export async function checkEnvironment(sdkPath: string, run: CommandRunner = runCommand): Promise<EnvironmentCheck> {
  if (process.platform !== "win32" && process.platform !== "darwin") return { sdkPath, issue: "unsupported_platform" };
  const suffix = process.platform === "win32" ? ".exe" : "";
  const emulator = path.join(sdkPath, "emulator", `emulator${suffix}`);
  const adb = path.join(sdkPath, "platform-tools", `adb${suffix}`);
  if (!sdkPath || !(await stat(sdkPath).then((info) => info.isDirectory(), () => false))) return { sdkPath, issue: "sdk_missing" };
  if (!(await isFile(emulator))) return { sdkPath, issue: "emulator_missing" };
  if (!(await isFile(adb))) return { sdkPath, issue: "adb_missing" };
  const imageRoot = path.join(sdkPath, "system-images");
  const architecture = process.arch === "arm64" ? "arm64-v8a" : "x86_64";
  const versions = (await directories(imageRoot)).filter((name) => /^android-\d+$/.test(name)).sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)));
  let imagePath: string | undefined;
  for (const version of versions) {
    for (const tag of (await directories(path.join(imageRoot, version))).filter((tag) => tag === "default" || /^google_apis(?:_playstore|_ps16k)?$/.test(tag)).sort()) {
      const candidate = path.join(imageRoot, version, tag, architecture);
      if ((await Promise.all(["system.img", "ramdisk.img", "kernel-ranchu"].map((file) => isFile(path.join(candidate, file))))).every(Boolean)) { imagePath = candidate; break; }
    }
    if (imagePath) break;
  }
  if (!imagePath) return { sdkPath, issue: "image_missing" };
  try { await run(adb, ["version"]); await run(emulator, ["-version"]); }
  catch { return { sdkPath, issue: "tools_invalid" }; }
  try { await run(emulator, ["-accel-check"]); }
  catch { return { sdkPath, issue: "acceleration_unavailable" }; }
  return { sdkPath, environment: { sdkPath, emulator, adb, imagePath, imageName: path.relative(imageRoot, imagePath) } };
}
