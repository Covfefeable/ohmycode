const assert = require("node:assert/strict");
const { BrowserWindow } = require("electron");

module.exports = async function detached(host, owner, base) {
  const id = "detached";
  const bounds = { x: 0, y: 100, width: 700, height: 500 };
  host.layout(id, bounds);
  await host.command(id, { action: "new", url: base });
  const tabId = host.state(id).selectedId;
  const view = owner.contentView.children.find((view) => view.webContents !== owner.webContents && view.getVisible());
  const page = view.webContents;
  await page.executeJavaScript("window.detachedState = 'preserved'");
  const window = new BrowserWindow({ show: false, width: 900, height: 700 });
  const baseChildren = window.contentView.children.length;
  try {
    host.setDetachedWindow(id, window);
    host.layoutDetached(id, bounds);
    assert.equal(host.state(id).detached, true);
    assert.equal(owner.contentView.children.includes(view), false);
    assert.equal(window.contentView.children.includes(view), true);
    assert.equal(view.getVisible(), true);
    host.layout(null, null);
    assert.equal(view.getVisible(), true, "switching conversations must not hide a detached page");
    assert.equal(await page.executeJavaScript("window.detachedState"), "preserved");
    await host.execute(id, "browser_evaluate", { expression: "window.detachedState = 'agent updated'" });
    await host.command(id, { action: "new", url: base });
    assert.equal(window.contentView.children.length, baseChildren + 2, "new tabs belong to the presentation window");
    await host.command(id, { action: "select", tabId });
    host.layoutDetached(id, null);
    assert.equal(view.getVisible(), false, "overlays also mask detached views");
    host.setDetachedWindow(id, null);
    host.layout(id, bounds);
    assert.equal(host.state(id).detached, false);
    assert.equal(host.state(id).tabs.length, 2);
    assert.equal(view.getVisible(), true);
    assert.equal(window.contentView.children.length, baseChildren);
    assert.equal(await page.executeJavaScript("window.detachedState"), "agent updated");
    host.setDetachedWindow(id, window);
    host.layoutDetached(id, bounds);
    host.closeSession(id);
    assert.equal(host.state(id).tabs.length, 0);
    assert.equal(host.state(id).detached, false);
  } finally {
    host.closeSession(id);
    if (!window.isDestroyed()) window.destroy();
  }
};
