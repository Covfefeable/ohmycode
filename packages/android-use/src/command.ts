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

/** ADB joins shell arguments remotely; quote text for the Android shell, not the host shell. */
export function actionArguments(input: unknown): string[] {
  if (!input || typeof input !== "object") throw new Error("android_invalid_action");
  const args = input as Record<string, unknown>;
  if (args.action === "key") {
    if (typeof args.key !== "string" || !Object.hasOwn(keys, args.key)) throw new Error("android_invalid_key");
    return ["shell", "input", "keyevent", keys[args.key as keyof typeof keys]];
  }
  if (args.action === "text") {
    if (typeof args.text !== "string" || !args.text || args.text.length > 2000 || /[^\x20-\x7e]/.test(args.text)) throw new Error("android_text_ascii_only");
    if (args.text.includes("%s")) throw new Error("android_text_percent_s_unsupported");
    const text = args.text.replaceAll(" ", "%s").replaceAll("'", "'\\''");
    return ["shell", "input", "text", `'${text}'`];
  }
  if (args.action === "tap") return ["shell", "input", "tap", coordinate(args.x), coordinate(args.y)];
  if (args.action === "swipe") {
    const duration = args.durationMs ?? 300;
    if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 10000) throw new Error("android_invalid_duration");
    return ["shell", "input", "swipe", coordinate(args.x), coordinate(args.y), coordinate(args.endX), coordinate(args.endY), String(duration)];
  }
  throw new Error("android_invalid_action");
}
