import { runCommand, type CommandRunner } from "./command.js";
import type { AdbTarget, AndroidDevice } from "./types.js";

export function adbArguments(target: AdbTarget): string[] {
  return [...(target.serverPort === undefined ? [] : ["-P", String(target.serverPort)]), "-s", target.serial];
}

export async function listDevices(adb: string, run: CommandRunner = runCommand): Promise<AndroidDevice[]> {
  const output = (await run(adb, ["devices", "-l"])).toString();
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^(\S+)\s+(device|offline|unauthorized|no permissions)\b(.*)$/.exec(line.trim());
    if (!match) return [];
    const [, serial, status, details] = match;
    const model = /\bmodel:(\S+)/.exec(details)?.[1];
    return [{ serial, name: model?.replaceAll("_", " ") ?? serial,
      status: status === "no permissions" ? "unavailable" as const : status as AndroidDevice["status"],
      transport: /\busb:/.test(details) ? "usb" as const : serial.includes(":") || serial.includes("._tcp") ? "network" as const : "local" as const }];
  });
}

/** Only an explicit host:port is accepted; no arbitrary ADB flags or shell commands. */
export function networkAddress(value: unknown): string {
  if (typeof value !== "string") throw new Error("android_invalid_address");
  const address = value.trim();
  const match = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?|\[[a-fA-F0-9:]+\]):([0-9]{1,5})$/.exec(address);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw new Error("android_invalid_address");
  return address;
}

export async function connectDevice(adb: string, address: unknown): Promise<AndroidDevice> {
  const endpoint = networkAddress(address);
  await runCommand(adb, ["connect", endpoint]);
  const device = (await listDevices(adb)).find((device) => device.serial === endpoint);
  if (!device || device.status !== "device") throw new Error(device?.status === "unauthorized" ? "android_device_unauthorized" : "android_device_connect_failed");
  return device;
}
