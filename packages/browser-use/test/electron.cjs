const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync } = require("node:fs");
const { join } = require("node:path");
const advanced = require("./advanced.cjs");
const lifecycle = require("./lifecycle.cjs");

process.on("uncaughtException", (error) => { console.error(error); app.exit(1); });

// Real Chromium regression test. No provider, external site, or installed Chrome needed.
async function main() {
  app.setName("Browser Agent Fixture");
  app.on("window-all-closed", () => {});
  app.setPath("userData", process.env.BROWSER_USE_TEST_PROFILE);
  const downloads = join(process.env.BROWSER_USE_TEST_PROFILE, "downloads");
  mkdirSync(downloads);
  app.setPath("downloads", downloads);
  const server = createServer((req, res) => {
    if (require("./user-agent.cjs").respond(req, res)) return;
    if (require("./network.cjs").respond(req, res)) return;
    if (req.url === "/slow-download") {
      res.setHeader("Content-Disposition", 'attachment; filename="slow.txt"');
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", "100000");
      res.write(Buffer.alloc(1024));
      const timer = setTimeout(() => res.end("remaining"), 5000);
      res.once("close", () => clearTimeout(timer));
      return;
    }
    if (req.url === "/download") {
      res.setHeader("Content-Disposition", 'attachment; filename="fixture.txt"');
      res.end("fixture download");
      return;
    }
    res.setHeader("Content-Type", "text/html");
    if (req.url === "/snapshot") {
      res.end(`<title>Snapshot fixture</title><main aria-label="Actions">${Array.from({ length: 650 }, (_, index) => `<div><button>Action ${index}</button></div>`).join("")}</main><input aria-label="Outside"><div tabindex="0"></div><input type="checkbox" aria-label="Option" checked disabled>`);
      return;
    }
    if (req.url === "/advanced") { res.end(advanced.html); return; }
    res.end(`<title>Browser fixture</title><h1>Local browser test</h1><input aria-label="Name"><button onclick="document.querySelector('h1').textContent=document.querySelector('input').value">Apply</button><a target="_blank" href="/popup">Popup</a>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await app.whenReady();
  const { BrowserHost, createBrowserPlugin } = await import("../dist/index.js");
  const window = new BrowserWindow({ width: 1000, height: 700, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  await window.loadURL("about:blank");
  const baseChildren = window.contentView.children.length;
  const visiblePages = () => window.contentView.children.filter((view) => view.getVisible());
  const events = [];
  const host = new BrowserHost(window, (id, state) => events.push({ id, state }));
  try {
    host.layout("one", { x: 400, y: 100, width: 600, height: 600 });
    const base = `http://127.0.0.1:${server.address().port}`;
    const plugin = createBrowserPlugin(host, "one", true);
    const textPlugin = createBrowserPlugin(host, "one", false);
    assert.equal(plugin.handles("browser_network"), true);
    assert.equal(textPlugin.handles("browser_screenshot"), false);
    console.log("Browser fixture: initial navigation");
    await host.execute("one", "browser_navigate", { action: "navigate", url: base });
    await require("./user-agent.cjs").test(host);
    assert.equal(host.state("one").tabs.length, 1);
    assert.equal(window.contentView.children.length, baseChildren + 1);
    assert.equal(window.webContents.debugger.isAttached(), false, "app renderer is not exposed");
    const snapshot = await host.execute("one", "browser_snapshot", {});
    const input = snapshot.nodes.find((node) => node.role === "textbox");
    const button = snapshot.nodes.find((node) => node.role === "button");
    assert.ok(input.nodeId);
    await host.execute("one", "browser_act", { action: "fill", nodeId: input.nodeId, text: "Changed through tool" });
    await host.execute("one", "browser_act", { action: "click", nodeId: button.nodeId });
    const changed = await host.execute("one", "browser_snapshot", {});
    assert.ok(changed.nodes.some((node) => node.role === "heading" && node.name === "Changed through tool"));
    const image = await host.execute("one", "browser_screenshot", {});
    assert.match(image.dataUrl, /^data:image\/png;base64,/);
    assert.ok(image.width > 0);
    await host.execute("one", "browser_navigate", { action: "navigate", url: `${base}/snapshot` });
    const compact = await host.execute("one", "browser_snapshot", {});
    assert.equal(compact.nodes.filter((node) => node.role === "button").length, 650, "No hard truncation loses actionable elements");
    assert.equal(compact.nodes.some((node) => node.role === "generic" && !node.name && !node.focusable), false);
    assert.ok(compact.nodes.some((node) => node.role === "generic" && !node.name && node.focusable), "Unnamed keyboard targets are not removed as empty containers");
    assert.ok(compact.nodes.some((node) => node.role === "checkbox" && node.checked === "true" && node.disabled === true));
    assert.equal(compact.nodes.some((node) => node.role === "InlineTextBox"), false);
    const main = compact.nodes.find((node) => node.role === "main");
    const scoped = await host.execute("one", "browser_snapshot", { nodeId: main.nodeId, query: "action 649" });
    assert.ok(scoped.nodes.some((node) => node.role === "button" && node.name === "Action 649"));
    assert.equal(scoped.nodes.some((node) => node.name === "Outside"), false);
    assert.equal((await host.execute("one", "browser_snapshot", { query: "not on this page" })).nodes.length, 0);
    await assert.rejects(host.execute("one", "browser_snapshot", { nodeId: -1 }), /browser_snapshot_node_not_found/);
    console.log("Browser fixture: advanced interactions");
    window.focus();
    visiblePages().at(-1).webContents.focus();
    await advanced.test(host, base, process.env.BROWSER_USE_TEST_PROFILE);
    await host.execute("one", "browser_navigate", { action: "navigate", url: base });
    await assert.rejects(host.execute("one", "browser_navigate", { action: "navigate", url: "file:///etc/passwd" }));
    assert.equal(host.state("one").tabs[0].url, `${base}/`);
    const firstId = host.state("one").selectedId;
    await host.command("one", { action: "new", url: `${base}/second` });
    assert.equal(host.state("one").tabs.length, 2);
    await host.command("one", { action: "select", tabId: firstId });
    assert.equal(host.state("one").selectedId, firstId);
    host.layout("two", { x: 400, y: 100, width: 600, height: 600 });
    assert.equal(visiblePages().length, baseChildren, "inactive conversation browser is hidden");
    assert.equal(host.state("two").tabs.length, 0);
    assert.equal(host.state("one").tabs.length, 2, "switching conversation preserves tabs");
    const backgroundImage = await host.execute("one", "browser_screenshot", {});
    assert.ok(backgroundImage.width > 0, "background browser tools keep working after leaving a conversation");
    host.layout("one", null);
    assert.equal(visiblePages().length, baseChildren, "modal masking hides native view");
    host.layout("one", { x: 400, y: 100, width: 600, height: 600 });
    assert.equal(visiblePages().length, baseChildren + 1);
    const page = visiblePages().at(-1).webContents;
    assert.equal(await page.executeJavaScript("typeof window.require"), "undefined");
    assert.equal(await page.executeJavaScript("typeof window.ohmycode"), "undefined");
    assert.equal(page.getLastWebPreferences().sandbox, true);
    await page.executeJavaScript("window.open('/popup'); undefined");
    await new Promise((resolve) => {
      const poll = setInterval(() => { if (host.state("one").tabs.length === 3) { clearInterval(poll); resolve(); } }, 20);
    });
    host.closeSession("one");
    assert.equal(host.state("one").tabs.length, 0);
    assert.equal(window.contentView.children.length, baseChildren);
    await lifecycle(host, window, base, baseChildren);
    await require("./detached.cjs")(host, window, base);
    await require("./network.cjs").test(host, base);
    await require("./console.cjs")(host, base);
    await require("./wait.cjs")(host, window, base);
    host.layout(null, null);
    await host.execute("background", "browser_navigate", { action: "navigate", url: base });
    await assert.rejects(host.execute("background", "browser_screenshot", {}), /browser_page_not_presented/);
    const backgroundSnapshot = await host.execute("background", "browser_snapshot", {});
    assert.ok(backgroundSnapshot.nodes.some((node) => node.name === "Local browser test"));
    await assert.rejects(host.execute("background", "browser_tabs", { action: "new" }, AbortSignal.abort()), { name: "AbortError" });
    const queued = host.execute("closed", "browser_tabs", { action: "new" });
    host.closeSession("closed");
    await assert.rejects(queued, /browser_session_closed/);
    assert.ok(events.length > 3);
    console.log("PASS: browser tools, snapshots, fill/click, screenshot, isolation, tabs, popup, session switching, overlay, cleanup");
  } finally {
    window.destroy(); host.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const timeout = setTimeout(() => { console.error("Browser integration test timed out"); app.exit(1); }, 45_000);
main().then(() => { clearTimeout(timeout); app.exit(0); }).catch((error) => { console.error(error); clearTimeout(timeout); app.exit(1); });
