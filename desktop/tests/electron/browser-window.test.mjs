import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import electron from "electron";
import { _electron } from "playwright";
import { createServer as createViteServer } from "vite";

for (const mode of ["production", "development"]) test(`${mode}：独立浏览器复用页面，返回面板和关闭窗口都保留标签，主窗口关闭后清理`, { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), "ohmycode-browser-window-"));
  const server = createServer((_request, response) => response.end("<title>Browser test</title><input value='preserved'>"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = { ...process.env, BROWSER_TEST_PROFILE: profile, BROWSER_TEST_URL: `http://127.0.0.1:${server.address().port}` };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let vite;
  if (mode === "development") {
    vite = await createViteServer({ server: { host: "127.0.0.1", port: 0 } });
    await vite.listen();
    env.VITE_DEV_SERVER_URL = `http://127.0.0.1:${vite.httpServer.address().port}`;
  }
  let application;
  try {
    application = await _electron.launch({ executablePath: electron, args: [fileURLToPath(new URL("./browser-window.cjs", import.meta.url))], env });
    await application.firstWindow();
    await application.evaluate(async () => {
      while (!globalThis.browserTest) await new Promise((resolve) => setTimeout(resolve, 10));
      await globalThis.browserTest.context.controller.detach("thread");
    });
    const page = application.windows().find((page) => page.url().includes("#/browser/"));
    await page.waitForSelector("aside input[name=url]");
    assert.equal(await page.locator("aside input[name=url]").inputValue(), env.BROWSER_TEST_URL + "/");
    await application.evaluate(async () => {
      const { context } = globalThis.browserTest;
      await context.host.execute("thread", "browser_evaluate", { expression: `document.title = ${JSON.stringify("南京房产网，南京二手房，租房，新房，房产信息网–南京58安居客".repeat(3))}` });
    });
    await page.getByRole("button", { name: /南京房产网/ }).waitFor();
    const tabGeometry = await page.getByRole("button", { name: /南京房产网/ }).evaluate((title) => {
      const tab = title.parentElement;
      const close = tab.querySelector("span button");
      const bounds = tab.getBoundingClientRect();
      const icon = close.getBoundingClientRect();
      return { width: bounds.width, closeWidth: icon.width, closeInside: icon.right <= bounds.right && icon.left >= bounds.left, ellipsis: getComputedStyle(title).textOverflow, truncated: title.scrollWidth > title.clientWidth };
    });
    assert.equal(tabGeometry.width <= 170, true);
    assert.equal(tabGeometry.closeWidth, 28);
    assert.equal(tabGeometry.closeInside, true);
    assert.equal(tabGeometry.ellipsis, "ellipsis");
    assert.equal(tabGeometry.truncated, true);
    await Promise.all([
      page.waitForEvent("close"),
      page.evaluate(() => document.querySelector("[aria-label='Return to panel'], [aria-label='返回面板']").click()),
    ]);
    assert.equal(await application.evaluate(() => globalThis.browserTest.context.host.state("thread").detached), false);
    await application.evaluate(() => globalThis.browserTest.context.controller.detach("thread"));
    assert.equal(await application.evaluate(({ BrowserWindow }) => {
      const { owner, context } = globalThis.browserTest;
      const detached = BrowserWindow.getAllWindows().find((window) => window !== owner);
      detached.close();
      return context.host.state("thread").tabs.length;
    }), 1);
    assert.equal(await application.evaluate(() => globalThis.browserTest.context.host.state("thread").detached), false);
    await application.evaluate(() => globalThis.browserTest.context.controller.detach("thread"));
    assert.equal(await application.evaluate(({ BrowserWindow }) => {
      const { owner, context } = globalThis.browserTest;
      owner.destroy();
      return context.host.state("thread").tabs.length === 0 && BrowserWindow.getAllWindows().length === 0;
    }), true);
  } finally {
    await application?.close();
    await vite?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
