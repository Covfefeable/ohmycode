import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import electron from "electron";
import { _electron } from "playwright";
import { createServer } from "vite";

// Opt in with an installed SDK and hardware acceleration. No device/download in CI.
test("真实 Android 视频、操作、拖拽与独立窗口共用一台设备", { skip: !process.env.ANDROID_TEST_SDK, timeout: 240_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), "ohmycode-android-device-"));
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  let application;
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    await writeFile(join(profile, "android.json"), JSON.stringify({ enabled: true, sdkPath: process.env.ANDROID_TEST_SDK }));
    const env = { ...process.env, ANDROID_TEST_PROFILE: profile, VITE_DEV_SERVER_URL: url };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: electron, args: [fileURLToPath(new URL("./android.cjs", import.meta.url))], env });
    const page = await application.firstWindow();
    page.on("pageerror", (error) => console.error("Android renderer:", error.message));
    const initial = await page.evaluate(() => window.ohmycode.android.state());
    assert.equal(initial.installed, true, initial.issue);
    await page.evaluate(() => window.ohmycode.android.start("thread"));
    await page.goto(`${url}/tests/browser/android.html`);
    await page.waitForFunction(() => document.querySelector("canvas")?.width === 720, { timeout: 90_000 });
    assert.equal(await page.locator("canvas").isVisible(), true);
    const handle = page.getByRole("separator", { name: "Resize Android panel" });
    const bounds = await handle.boundingBox();
    const width = (await page.getByRole("complementary", { name: "Android", exact: true }).boundingBox()).width;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
    await page.mouse.down(); await page.mouse.move(bounds.x - 100, bounds.y + 100); await page.mouse.up();
    assert.ok((await page.getByRole("complementary", { name: "Android", exact: true }).boundingBox()).width > width);
    await page.evaluate(() => window.ohmycode.android.act("thread", { action: "key", key: "home" }));
    const beforeHold = await application.evaluate(() => globalThis.androidTest.snapshot("thread"));
    const screen = await page.locator("canvas").boundingBox();
    await page.mouse.move(screen.x + screen.width * 0.5, screen.y + screen.height * 0.4);
    await page.mouse.down();
    await page.waitForTimeout(900); // Actual duration of the user-held finger, not a loading wait.
    await page.mouse.up();
    const afterHold = await application.evaluate(() => globalThis.androidTest.snapshot("thread"));
    assert.notDeepEqual(afterHold.nodes, beforeHold.nodes, "Holding wallpaper must open a system menu, not become a tap on release");
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.evaluate(() => window.ohmycode.android.act("thread", { action: "key", key: "back" }));
    await page.mouse.move(screen.x + screen.width * 0.5, screen.y + screen.height * 0.05);
    await page.mouse.down();
    await page.mouse.move(screen.x + screen.width * 0.25, screen.y + screen.height * 0.35, { steps: 10 });
    await page.mouse.move(screen.x + screen.width * 0.75, screen.y + screen.height * 0.6, { steps: 10 });
    await page.mouse.up();
    await page.evaluate(() => window.ohmycode.android.act("thread", { action: "key", key: "home" }));
    const [detached] = await Promise.all([
      application.waitForEvent("window"),
      page.getByRole("button", { name: "Open in separate window" }).click(),
    ]);
    await detached.waitForURL((url) => url.hash === "#/android?conversationId=thread");
    detached.on("pageerror", (error) => console.error("Android detached renderer:", error.message));
    await detached.waitForFunction(() => document.querySelector("canvas")?.width === 720, { timeout: 30_000 }).catch(async (error) => {
      console.error("Detached state:", await detached.locator("body").innerText());
      throw error;
    });
    await detached.getByRole("button", { name: /Return to panel|返回面板/ }).click();
    await page.waitForFunction(() => document.querySelector("canvas")?.width === 720, { timeout: 30_000 });
    assert.equal((await page.evaluate(() => window.ohmycode.android.state())).phase, "running");
    await page.getByRole("button", { name: "Power off emulator" }).click();
    await page.getByRole("button", { name: "Start emulator" }).waitFor();
    assert.equal((await page.evaluate(() => window.ohmycode.android.state())).phase, "stopped");
    assert.equal((await page.evaluate(() => window.ohmycode.android.state())).ownerConversationId, undefined);
    assert.equal(await page.getByRole("alert").count(), 0);
  } finally {
    await application?.close(); await server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
