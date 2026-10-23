import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import electron from "electron";
import { _electron } from "playwright";

test("Android 真实 preload / IPC：缺失 SDK 不启动设备，配置与状态事件保持一致", { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), "ohmycode-android-"));
  await writeFile(join(profile, "android.json"), JSON.stringify({ enabled: true, sdkPath: join(profile, "missing-sdk"), connections: [{ address: "127.0.0.1:16555", name: "External emulator" }] }));
  const env = { ...process.env, ANDROID_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await _electron.launch({ executablePath: electron, args: [fileURLToPath(new URL("./android.cjs", import.meta.url))], env });
    const page = await application.firstWindow();
    const state = await page.evaluate(() => window.ohmycode.android.state());
    assert.equal(state.installed, false);
    assert.equal(state.issue, "sdk_missing");
    assert.equal(state.phase, "stopped");
    await application.evaluate(({ dialog }, missing) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [missing] });
    }, join(profile, "another-missing-sdk"));
    assert.equal(await page.evaluate(async () => {
      try { await window.ohmycode.android.chooseSdk(); return false; }
      catch (error) { return error.message.includes("android_adb_missing"); }
    }), true);
    assert.deepEqual(await page.evaluate(() => window.ohmycode.android.state()), state);
    assert.equal(JSON.parse(await readFile(join(profile, "android.json"), "utf8")).sdkPath, join(profile, "missing-sdk"));
    const removed = await page.evaluate(() => window.ohmycode.android.removeDevice("127.0.0.1:16555"));
    assert.equal(removed.devices.length, 0);
    const savedRemoval = JSON.parse(await readFile(join(profile, "android.json"), "utf8"));
    assert.deepEqual(savedRemoval.connections, []);
    assert.deepEqual(savedRemoval.removedDevices, ["127.0.0.1:16555"]);
    const plan = await page.evaluate(() => window.ohmycode.android.installPlan());
    assert.equal(plan.components.length, 3);
    assert.equal(plan.totalBytes > 1_000_000_000, true);
    assert.equal(plan.root, join(profile, "android"));
    const toolsPlan = await page.evaluate(() => window.ohmycode.android.installPlan("tools"));
    assert.equal(toolsPlan.mode, "tools");
    assert.deepEqual(toolsPlan.components.map((component) => component.id), ["platformTools"]);
    assert.equal(toolsPlan.totalBytes < plan.totalBytes, true);
    assert.equal(await page.evaluate(async () => {
      try { await window.ohmycode.android.selectTarget({ kind: "external", serial: "not-connected", name: "Missing" }); return false; }
      catch (error) { return error.message.includes("android_device_offline"); }
    }), true);
    assert.equal(await page.evaluate(async () => {
      try { await window.ohmycode.android.install(false); return false; }
      catch (error) { return error.message.includes("android_install_license_required"); }
    }), true);
    assert.equal((await page.evaluate(() => window.ohmycode.android.installation())).phase, "idle");
    assert.equal(await page.evaluate(async () => {
      try { await window.ohmycode.android.start("thread"); return false; }
      catch (error) { return error.message.includes("android_not_available"); }
    }), true);
    const updated = await page.evaluate(async () => {
      const received = new Promise((resolve) => {
        const off = window.ohmycode.android.onState((state) => { if (!state.enabled && state.phase === "stopped") { off(); resolve(state); } });
      });
      const saved = await window.ohmycode.android.setEnabled(false);
      return { saved, received: await received };
    });
    assert.equal(updated.saved.enabled, false);
    assert.deepEqual(updated.saved, updated.received);
    assert.equal(JSON.parse(await readFile(join(profile, "android.json"), "utf8")).enabled, false);
    assert.equal(await page.evaluate(async () => {
      try { await window.ohmycode.android.setEnabled("invalid"); return false; }
      catch (error) { return error.message.includes("android_invalid_configuration"); }
    }), true);
  } finally {
    await application?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
