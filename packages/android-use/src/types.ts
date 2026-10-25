export type AndroidIssue = "unsupported_platform" | "sdk_missing" | "emulator_missing" | "adb_missing" | "image_missing" | "acceleration_unavailable" | "tools_invalid" | "configuration_invalid";
export type AndroidEnvironment = {
  sdkPath: string;
  emulator: string;
  adb: string;
  imagePath: string;
  imageName: string;
};
export type AndroidTarget = { kind: "none" } | { kind: "managed" } | { kind: "external"; serial: string; name: string };
export type AndroidDevice = { serial: string; name: string; status: "device" | "offline" | "unauthorized" | "unavailable"; transport: "usb" | "network" | "local" };
export type AdbTarget = { adb: string; serial: string; serverPort?: number };
export type AndroidInstallMode = "runtime" | "tools";
export type AndroidState = {
  operation?: import("@ohmycode/tool-contracts").OperationFeedback;
  enabled: boolean;
  installed: boolean;
  sdkPath: string;
  imageName?: string;
  issue?: AndroidIssue;
  phase: "stopped" | "starting" | "running" | "stopping" | "error";
  error?: string;
  ownerConversationId?: string;
  target: AndroidTarget;
  devices: AndroidDevice[];
  adbReady: boolean;
  adbPath?: string;
  managedInstalled: boolean;
};
export type AndroidSelector = { resourceId?: string; text?: string; textContains?: string; description?: string; className?: string; packageName?: string; focused?: boolean };
export type AndroidNodeTarget = { selector: AndroidSelector; snapshotId?: never; nodeId?: never } | { selector?: never; snapshotId: string; nodeId: number };
export type AndroidAction =
  | ({ action: "tap"; timeoutMs?: number } & (AndroidNodeTarget | { x: number; y: number }))
  | { action: "swipe"; x: number; y: number; endX: number; endY: number; durationMs?: number }
  | ({ action: "text"; text: string; timeoutMs?: number } & Partial<AndroidNodeTarget>)
  | { action: "key"; key: "back" | "home" | "recent" | "enter" | "delete" }
  | { action: "wait"; selector: AndroidSelector; state: "present" | "absent"; timeoutMs?: number };

/** User pointer input through the mirroring control channel, not an Agent tool. */
export type AndroidTouch = { action: "down" | "move" | "up"; x: number; y: number; width: number; height: number };

export type AndroidInstallState = {
  mode: AndroidInstallMode;
  phase: "idle" | "checking" | "downloading" | "verifying" | "extracting" | "finishing" | "completed" | "canceled" | "error";
  root: string;
  component?: "emulator" | "platformTools" | "systemImage";
  receivedBytes: number;
  totalBytes: number;
  error?: string;
};
export type AndroidInstallPlan = {
  mode: AndroidInstallMode;
  root: string;
  licenseUrl: string;
  requiredFreeBytes: number;
  components: { id: "emulator" | "platformTools" | "systemImage"; version: string; bytes: number }[];
  totalBytes: number;
};
