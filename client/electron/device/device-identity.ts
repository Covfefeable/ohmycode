import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type DeviceIdentity = { id: string; name: string };

let identityPromise: Promise<DeviceIdentity> | null = null;

function identityPath(): string {
  return path.join(app.getPath("userData"), "device-identity.json");
}

async function loadOrCreateIdentity(): Promise<DeviceIdentity> {
  const filePath = identityPath();
  try {
    const stored = JSON.parse(await readFile(filePath, "utf8")) as Partial<DeviceIdentity>;
    if (typeof stored.id === "string" && stored.id && typeof stored.name === "string") {
      return { id: stored.id, name: os.hostname() || stored.name || "OhMyCode device" };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[device] failed to read device identity; creating a new one");
    }
  }

  const identity = { id: randomUUID(), name: os.hostname() || "OhMyCode device" };
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(identity), "utf8");
  await rename(temporaryPath, filePath);
  return identity;
}

export function getDeviceIdentity(): Promise<DeviceIdentity> {
  identityPromise ??= loadOrCreateIdentity();
  return identityPromise;
}
