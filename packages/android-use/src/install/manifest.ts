/** Pinned from Google's SDK repositories; never resolve "latest" during installation. */
export type RuntimeComponent = {
  id: "emulator" | "platformTools" | "systemImage";
  version: string;
  url: string;
  bytes: number;
  sha1: string;
  destination: string;
  archiveRoot: string;
  requiredFiles: string[];
};
export const SDK_LICENSE_URL = "https://developer.android.com/studio/terms";
export const REQUIRED_FREE_BYTES = 15 * 1024 ** 3;
const repository = "https://dl.google.com/android/repository/";
const hosts = {
  "win32-x64": {
    emulator: ["emulator-windows_x64-16428233.zip", 455342868, "488ed747e82de7e9bb5247becd1ac043c7e5e85d"],
    tools: ["platform-tools_r37.0.1-win.zip", 8044989, "e03e78b1d80b396f1c3358e31251cb31740e1110"],
    abi: "x86_64", suffix: ".exe",
  },
  "darwin-arm64": {
    emulator: ["emulator-darwin_aarch64-16428233.zip", 416112708, "3af4fe44ce82b3d88ae5678a53735f27ad729c15"],
    tools: ["platform-tools_r37.0.1-darwin.zip", 16110554, "6ae73f4de6452dc57e62ec02b68eed92a4c21661"],
    abi: "arm64-v8a", suffix: "",
  },
  "darwin-x64": {
    emulator: ["emulator-darwin_x64-16428233.zip", 488731099, "0c08fc22f41f2e63976f5503d593f821ff11e30b"],
    tools: ["platform-tools_r37.0.1-darwin.zip", 16110554, "6ae73f4de6452dc57e62ec02b68eed92a4c21661"],
    abi: "x86_64", suffix: "",
  },
} as const;
const images = {
  x86_64: { bytes: 782404023, sha1: "2d857d170c0d1b827149565da34b3383e5306f7f" },
  "arm64-v8a": { bytes: 769099654, sha1: "2026a06409db630b56711afdbffb457c1dbaed49" },
};

export function runtimeComponents(platform: string = process.platform, arch: string = process.arch): RuntimeComponent[] {
  const key = `${platform}-${arch}`;
  if (!Object.hasOwn(hosts, key)) throw new Error("android_install_unsupported_platform");
  const host = hosts[key as keyof typeof hosts];
  const image = images[host.abi];
  return [
    { id: "emulator", version: "37.2.12", url: repository + host.emulator[0], bytes: host.emulator[1], sha1: host.emulator[2], destination: "emulator", archiveRoot: "emulator", requiredFiles: [`emulator${host.suffix}`, "source.properties"] },
    { id: "platformTools", version: "37.0.1", url: repository + host.tools[0], bytes: host.tools[1], sha1: host.tools[2], destination: "platform-tools", archiveRoot: "platform-tools", requiredFiles: [`adb${host.suffix}`, "source.properties"] },
    { id: "systemImage", version: "35-r02", url: `${repository}sys-img/android/${host.abi}-35_r02.zip`, bytes: image.bytes, sha1: image.sha1, destination: `system-images/android-35/default/${host.abi}`, archiveRoot: host.abi, requiredFiles: ["system.img", "ramdisk.img", "kernel-ranchu", "source.properties"] },
  ];
}
