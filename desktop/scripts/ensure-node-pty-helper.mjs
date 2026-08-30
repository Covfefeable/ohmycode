import { chmodSync, constants, accessSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(require.resolve("node-pty")), "..");
if (process.platform !== "win32") {
  const helper = path.join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
  if (existsSync(helper)) {
    const mode = statSync(helper).mode & 0o777;
    chmodSync(helper, mode | 0o111);
    accessSync(helper, constants.X_OK);
  }
}
