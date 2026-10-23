const assert = require("node:assert/strict");
const { readFile, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const html = `<title>Advanced browser fixture</title>
<style>body{margin:0;width:2000px;height:2000px}button,input{display:block;margin:12px}#drag{width:180px;height:60px;background:#ddd;margin:12px;touch-action:none}</style>
<input aria-label="Editable"><input type="file" aria-label="Upload" multiple>
<button onmouseenter="window.hovered=true" oncontextmenu="event.preventDefault();window.rightClicked=true" ondblclick="window.doubled=true">Hover target</button>
<div id="drag" onpointerdown="this.setPointerCapture(event.pointerId);window.dragStart=event.clientX" onpointerup="window.dragEnd=event.clientX">Drag target</div>
<div class="ad">Advertisement</div>`;

async function eventually(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Browser fixture condition timed out");
}

module.exports = { html, async test(host, base, profile) {
  await host.execute("one", "browser_navigate", { action: "navigate", url: `${base}/advanced` });
  const evaluate = (expression, signal) => host.execute("one", "browser_evaluate", { expression }, signal);
  const act = (args) => host.execute("one", "browser_act", args);
  assert.deepEqual(await evaluate("({ node: typeof require, bridge: typeof window.ohmycode })"), { value: { node: "undefined", bridge: "undefined" } });
  assert.deepEqual(await evaluate("Promise.resolve(42)"), { value: 42 });
  assert.deepEqual(await evaluate("(() => { document.querySelector('.ad').remove(); return document.querySelector('.ad') === null; })()"), { value: true });
  await assert.rejects(evaluate("throw new Error('fixture failure')"), /browser_script_failed.*fixture failure/);
  assert.equal((await evaluate("'a'.repeat(40000)")).truncated, true);
  const tree = await host.execute("one", "browser_snapshot", {});
  const input = tree.nodes.find((node) => node.role === "textbox");
  const target = tree.nodes.find((node) => node.name === "Hover target" && node.role === "button");
  await act({ action: "fill", nodeId: input.nodeId, text: "original" });
  await eventually(async () => (await evaluate("document.hasFocus() && document.activeElement?.getAttribute('aria-label') === 'Editable'")).value);
  await act({ action: "press", key: process.platform === "darwin" ? "Meta+a" : "Control+a" });
  await act({ action: "type", text: "replaced" });
  assert.equal((await evaluate("document.querySelector('input').value")).value, "replaced");
  await act({ action: "hover", nodeId: target.nodeId });
  assert.equal((await evaluate("window.hovered")).value, true);
  await act({ action: "right_click", nodeId: target.nodeId });
  assert.equal((await evaluate("window.rightClicked")).value, true);
  const point = (await evaluate("(() => { const r=document.querySelector('button').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()")).value;
  await act({ action: "double_click", ...point });
  assert.equal((await evaluate("window.doubled")).value, true);
  const drag = (await evaluate("(() => { const r=document.querySelector('#drag').getBoundingClientRect(); return {x:r.x+10,y:r.y+10}; })()")).value;
  await act({ action: "drag", ...drag, targetX: drag.x + 100, targetY: drag.y });
  assert.equal((await evaluate("window.dragEnd-window.dragStart")).value, 100);
  await act({ action: "scroll", deltaX: 100, deltaY: 200 });
  await eventually(async () => (await evaluate("window.scrollX>0 && window.scrollY>0")).value);
  const file = join(profile, "upload.txt");
  await writeFile(file, "fixture upload");
  const uploadTree = await host.execute("one", "browser_snapshot", {});
  const upload = uploadTree.nodes.find((node) => node.name === "Upload" && node.nodeId);
  assert.ok(upload, "file input has a snapshot node id");
  await host.execute("one", "browser_upload", { nodeId: upload.nodeId, paths: [file] });
  assert.equal((await evaluate("document.querySelector('[type=file]').files[0].text()")).value, "fixture upload");
  await assert.rejects(host.execute("one", "browser_upload", { nodeId: upload.nodeId, paths: ["relative.txt"] }), /absolute_file_path/);
  await host.execute("one", "browser_upload", { nodeId: upload.nodeId, paths: [] });
  assert.equal((await evaluate("document.querySelector('[type=file]').files.length")).value, 0);
  console.log("Browser fixture: dialogs");
  const dialog = await evaluate("window.answer=confirm('Continue?')");
  assert.equal(dialog.dialog.type, "confirm");
  assert.equal((await host.execute("one", "browser_dialog", { action: "read" })).dialog.message, "Continue?");
  await host.execute("one", "browser_dialog", { action: "accept" });
  await eventually(async () => (await evaluate("window.answer")).value === true);
  await evaluate("window.confirmed=confirm('Continue?')");
  await host.execute("one", "browser_dialog", { action: "dismiss" });
  assert.equal((await evaluate("window.confirmed")).value, false);
  console.log("Browser fixture: cancellation");
  const controller = new AbortController();
  const pending = evaluate("new Promise(() => {})", controller.signal);
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal((await evaluate("21*2")).value, 42, "stop does not break subsequent page operations");
  const busyController = new AbortController();
  const busy = evaluate("while (true) {}", busyController.signal);
  setTimeout(() => busyController.abort(), 30);
  await assert.rejects(busy, { name: "AbortError" });
  assert.equal((await evaluate("6*7")).value, 42, "stop terminates synchronous page scripts too");
  console.log("Browser fixture: downloads");
  await host.execute("one", "browser_download", { action: "start", url: `${base}/download` });
  const downloaded = await eventually(async () => (await host.execute("one", "browser_download", { action: "list" })).downloads.find((download) => download.state === "completed"));
  assert.equal(await readFile(downloaded.path, "utf8"), "fixture download");
  assert.equal(downloaded.filename, "fixture.txt");
  await evaluate(`(() => { const a=document.createElement('a'); a.href=${JSON.stringify(`${base}/download`)}; document.body.append(a); a.click(); })()`);
  await eventually(async () => (await host.execute("one", "browser_download", { action: "list" })).downloads.filter((download) => download.state === "completed").length === 2);
  await host.execute("one", "browser_download", { action: "start", url: `${base}/slow-download` });
  const slow = await eventually(async () => (await host.execute("one", "browser_download", { action: "list" })).downloads.find((download) => download.filename === "slow.txt"));
  await host.execute("one", "browser_download", { action: "cancel", downloadId: slow.id });
  await eventually(async () => (await host.execute("one", "browser_download", { action: "list" })).downloads.some((download) => download.id === slow.id && download.state === "cancelled"));
  await assert.rejects(evaluate("prompt('Unsupported')"), /prompt\(\) is not supported/);
  await host.execute("other", "browser_tabs", { action: "new" });
  assert.deepEqual(await host.execute("other", "browser_download", { action: "list" }), { downloads: [] });
  await assert.rejects(host.execute("other", "browser_download", { action: "cancel", downloadId: downloaded.id }), /not_found/);
  host.closeSession("other");
} };
