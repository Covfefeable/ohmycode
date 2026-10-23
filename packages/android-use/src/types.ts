export type AndroidIssue = "unsupported_platform" | "sdk_missing" | "emulator_missing" | "adb_missing" | "image_missing" | "acceleration_unavailable" | "tools_invalid" | "configuration_invalid";
export type AndroidEnvironment = {
  sdkPath: string;
  emulator: string;
  adb: string;
  imagePath: string;
  imageName: string;
};
export type AndroidState = {
  enabled: boolean;
  installed: boolean;
  sdkPath: string;
  imageName?: string;
  issue?: AndroidIssue;
  phase: "stopped" | "starting" | "running" | "stopping" | "error";
  error?: string;
  ownerConversationId?: string;
};
export type AndroidAction =
  | { action: "tap"; x: number; y: number }
  | { action: "swipe"; x: number; y: number; endX: number; endY: number; durationMs?: number }
  | { action: "text"; text: string }
  | { action: "key"; key: "back" | "home" | "recent" | "enter" | "delete" };

/** User pointer input through the mirroring control channel, not an Agent tool. */
export type AndroidTouch = { action: "down" | "move" | "up"; x: number; y: number; width: number; height: number };

export type AndroidInstallState = {
  phase: "idle" | "checking" | "downloading" | "verifying" | "extracting" | "finishing" | "completed" | "canceled" | "error";
  root: string;
  component?: "emulator" | "platformTools" | "systemImage";
  receivedBytes: number;
  totalBytes: number;
  error?: string;
};
export type AndroidInstallPlan = {
  root: string;
  licenseUrl: string;
  requiredFreeBytes: number;
  components: { id: "emulator" | "platformTools" | "systemImage"; version: string; bytes: number }[];
  totalBytes: number;
};
