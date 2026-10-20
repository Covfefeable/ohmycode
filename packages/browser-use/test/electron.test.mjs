import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import electron from "electron";

test("real Electron browser integration", { timeout: 60_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), "ohmycode-browser-test-"));
  const env = { ...process.env, BROWSER_USE_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  let output = "";
  try {
    const child = spawn(electron, [fileURLToPath(new URL("./electron.cjs", import.meta.url))], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    assert.equal(code, 0, output);
    assert.match(output, /PASS: browser tools/);
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});
