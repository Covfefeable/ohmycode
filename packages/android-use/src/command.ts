import { execFile } from "node:child_process";

export type CommandRunner = (file: string, args: string[], signal?: AbortSignal) => Promise<Buffer>;

export const runCommand: CommandRunner = (file, args, signal) => new Promise((resolve, reject) => {
  execFile(file, args, { encoding: "buffer", windowsHide: true, timeout: 15_000, maxBuffer: 16 * 1024 * 1024, signal }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

const keys = { back: "KEYCODE_BACK", home: "KEYCODE_HOME", recent: "KEYCODE_APP_SWITCH", enter: "KEYCODE_ENTER", delete: "KEYCODE_DEL" };
function coordinate(value: unknown): string {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 16384) throw new Error("android_invalid_coordinates");
  return String(value);
}

export function screenPoint(input: Record<string, unknown>): { x: number; y: number } {
  return { x: Number(coordinate(input.x)), y: Number(coordinate(input.y)) };
}

export function gestureDuration(value: unknown, fallback: number): number {
  const duration = value ?? fallback;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 10000) throw new Error("android_invalid_duration");
  return duration;
}

/** Coordinate gestures and navigation only. Widget actions belong to UIAutomator. */
export function actionArguments(input: unknown): string[] {
  if (!input || typeof input !== "object") throw new Error("android_invalid_action");
  const args = input as Record<string, unknown>;
  if (args.action === "key") {
    if (typeof args.key !== "string" || !Object.hasOwn(keys, args.key)) throw new Error("android_invalid_key");
    return ["shell", "input", "keyevent", keys[args.key as keyof typeof keys]];
  }
  if (args.action === "tap") return ["shell", "input", "tap", coordinate(args.x), coordinate(args.y)];
  if (args.action === "swipe") {
    const duration = gestureDuration(args.durationMs, 300);
    return ["shell", "input", "swipe", coordinate(args.x), coordinate(args.y), coordinate(args.endX), coordinate(args.endY), String(duration)];
  }
  throw new Error("android_invalid_action");
}
