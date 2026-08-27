import { constants, accessSync, chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function unpackedPath(value: string): string {
  return value
    .replace("app.asar", "app.asar.unpacked")
    .replace("node_modules.asar", "node_modules.asar.unpacked");
}

export function ensureNodePtyHelperExecutable(): void {
  if (process.platform === "win32") return;
  const entry = require.resolve("node-pty");
  const packageRoot = path.resolve(path.dirname(entry), "..");
  const candidates = [
    path.join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    path.join(packageRoot, "build", "Release", "spawn-helper"),
  ].map(unpackedPath);
  const helper = candidates.find((candidate) => {
    try {
      statSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!helper) throw new Error("node_pty_spawn_helper_missing");
  try {
    accessSync(helper, constants.X_OK);
  } catch {
    const mode = statSync(helper).mode & 0o777;
    chmodSync(helper, mode | 0o111);
    accessSync(helper, constants.X_OK);
  }
}
