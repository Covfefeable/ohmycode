import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import electron from "electron";
import { _electron } from "playwright";
import { createServer } from "vite";

test("原生遮罩覆盖页面，CDP 操作不受阻，异常与取消解锁，独立窗口可回收", { timeout: 45_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), "ohmycode-operation-"));
  const vite = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  let application;
  try {
    await vite.listen();
    const env = { ...process.env, BROWSER_TEST_PROFILE: profile, BROWSER_TEST_URL: "about:blank", VITE_DEV_SERVER_URL: `http://127.0.0.1:${vite.httpServer.address().port}` };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: electron, args: [fileURLToPath(new URL("./browser-window.cjs", import.meta.url))], env });
    await application.firstWindow();
    await application.evaluate(async () => {
      while (!globalThis.browserTest) await new Promise((resolve) => setTimeout(resolve, 10));
      await globalThis.browserTest.context.controller.detach("thread");
      await globalThis.browserTest.context.host.execute("thread", "browser_evaluate", { expression: "document.body.innerHTML = '<input id=field><button id=button onclick=\"document.title=123\">Click</button>'" });
      globalThis.operationAbort = new AbortController();
      globalThis.operationPending = globalThis.browserTest.context.host.execute("thread", "browser_act", { action: "wait", condition: "selector", selector: ".never", timeoutMs: 30000 }, globalThis.operationAbort.signal).catch(() => {});
    });
    let state;
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await application.evaluate(async ({ webContents, BrowserWindow }) => {
        const overlay = webContents.getAllWebContents().find((page) => page.getURL().endsWith("#/operation-overlay"));
        if (!overlay) return null;
        const active = await overlay.executeJavaScript("document.querySelector('[data-active]')?.dataset.active");
        const owner = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("#/browser/"));
        const views = owner.contentView.children;
        return { active, top: views.at(-1).webContents.id === overlay.id, bounds: views.at(-1).getBounds(), pageBounds: views[0].getBounds() };
      });
      if (state?.active === "true") break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(state?.active, "true");
    assert.equal(state.top, true);
    assert.deepEqual(state.bounds, state.pageBounds);
    await application.evaluate(async () => { globalThis.operationAbort.abort(); await globalThis.operationPending; });
    assert.equal(await application.evaluate(() => globalThis.browserTest.context.host.state("thread").operating), false);
    let hidden = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      hidden = await application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes("#/browser/"));
        return !window.contentView.children.find((view) => view.webContents.getURL().endsWith("#/operation-overlay"))?.getVisible();
      });
      if (hidden) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(hidden, true, "Renderer fade completion must release the native overlay");
    const coordinates = await application.evaluate(async ({ BrowserWindow, webContents }) => {
      const host = globalThis.browserTest.context.host;
      const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes("#/browser/"));
      const page = window.contentView.children.find((view) => !view.webContents.getURL().endsWith("#/operation-overlay")).webContents;
      const overlay = webContents.getAllWebContents().find((item) => item.getURL().endsWith("#/operation-overlay"));
      const results = [];
      for (const zoom of [1, 0.8, 1.25]) {
        page.setZoomFactor(zoom);
        await page.executeJavaScript("document.onclick = (event) => { window.lastClick = {x: event.clientX, y: event.clientY}; }; undefined");
        await host.execute("thread", "browser_act", { action: "click", x: 100, y: 100 });
        const click = await page.executeJavaScript("window.lastClick");
        const marker = await overlay.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { const b = document.querySelector('circle').getBoundingClientRect(); resolve({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })))");
        results.push({ zoom, click, marker, overlayZoom: overlay.getZoomFactor() });
      }
      page.setZoomFactor(1);
      return results;
    });
    for (const { zoom, click, marker, overlayZoom } of coordinates) {
      assert.ok(Math.abs(marker.x * overlayZoom - click.x * zoom) < 1, `Horizontal marker alignment at zoom ${zoom}`);
      assert.ok(Math.abs(marker.y * overlayZoom - click.y * zoom) < 1, `Vertical marker alignment at zoom ${zoom}`);
    }
    const result = await application.evaluate(async ({ webContents }) => {
      const host = globalThis.browserTest.context.host;
      await host.execute("thread", "browser_act", { action: "click", x: 25, y: 15 });
      await host.execute("thread", "browser_act", { action: "type", text: "Agent input" });
      const value = await host.execute("thread", "browser_evaluate", { expression: "document.querySelector('input').value" });
      try { await host.execute("thread", "browser_act", { action: "click", nodeId: -1 }); } catch { /* Expected invalid target. */ }
      const overlay = webContents.getAllWebContents().find((page) => page.getURL().endsWith("#/operation-overlay"));
      return { value, operating: host.state("thread").operating, error: await overlay.executeJavaScript("document.body.innerText") };
    });
    assert.match(JSON.stringify(result.value), /Agent input/);
    assert.equal(result.operating, false);
    assert.match(result.error, /Agent/);
    await application.evaluate(() => globalThis.browserTest.context.controller.dock("thread"));
    await application.evaluate(async ({ webContents }) => {
      const overlay = webContents.getAllWebContents().find((page) => page.getURL().endsWith("#/operation-overlay"));
      const destroyed = new Promise((resolve) => overlay.once("destroyed", resolve));
      globalThis.browserTest.context.host.closeSession("thread");
      await destroyed;
    });
    assert.equal(await application.evaluate(({ webContents }) => webContents.getAllWebContents().some((page) => page.getURL().endsWith("#/operation-overlay"))), false);
  } finally {
    await application?.close();
    await vite.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
