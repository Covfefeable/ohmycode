import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";

let server, browser, page, baseUrl, browserErrors;
before(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
});
after(async () => { await browser?.close(); await server?.close(); });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.goto(`${baseUrl}/tests/browser/chat.html`);
  await page.locator('[data-message="999"]').waitFor();
  await settle();
});
afterEach(async () => {
  try { assert.deepEqual(browserErrors, [], "Browser must not throw uncaught errors"); }
  finally { await page?.close(); }
});

const scroller = () => page.locator('[data-virtuoso-scroller="true"]');

test("Token 日历在不同窗口宽度下均保持正方形，宽屏填满可用宽度", async () => {
  await page.goto(`${baseUrl}/tests/browser/sidebar.html`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const days = page.locator("[data-level]");
  await days.first().waitFor();
  assert.equal(await days.count(), 365);
  for (const width of [1100, 1600, 720]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await days.evaluateAll((cells) => cells.map((cell) => {
      const { width, height } = cell.getBoundingClientRect();
      return { width, height };
    }));
    assert.ok(sizes.every((cell) => cell.width > 0 && Math.abs(cell.width - cell.height) < 0.1), `Cells must stay square at ${width}px`);
    if (width === 1600) {
      const dimensions = await days.first().evaluate((cell) => {
        const calendar = cell.parentElement.parentElement;
        return { calendar: calendar.getBoundingClientRect().width, container: calendar.parentElement.clientWidth };
      });
      assert.ok(Math.abs(dimensions.calendar - dimensions.container) < 1);
    }
  }
});

test("三个页面同步收起侧栏，内容填满可用空间，项目展开状态跨页面保留", async () => {
  await page.goto(`${baseUrl}/tests/browser/sidebar.html`);
  await page.getByRole("button", { name: "Remembered project" }).click();
  await page.getByRole("button", { name: "Remembered chat", exact: true }).waitFor();
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  const theme = page.getByRole("button", { name: /theme/i });
  assert.ok((await collapse.boundingBox()).y < (await theme.boundingBox()).y, "Collapse button is above the theme button");
  await collapse.click();
  assert.equal(await page.getByRole("separator").count(), 0);
  const content = await page.locator('[data-page="Workspace"]').boundingBox();
  assert.equal(content.x, 64);
  assert.equal(content.width, 1036);
  await page.getByRole("button", { name: "Multi-agent", exact: true }).click();
  await page.locator('[data-page="Collaboration"]').waitFor();
  assert.equal(await page.getByRole("button", { name: "Expand sidebar" }).count(), 1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator('[data-page="Settings"]').waitFor();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.getByRole("separator").waitFor();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Remembered chat", exact: true }).waitFor();
});

test("聊天右侧浏览器面板独立开关，标题栏和输入框不被遮挡", async () => {
  await page.goto(`${baseUrl}/tests/browser/search.html`);
  await page.getByText("Live output", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Browser", exact: true });
  await panel.waitFor();
  const bounds = await panel.boundingBox();
  assert.ok(bounds.width >= 280 && bounds.x + bounds.width <= 1100);
  const address = await panel.getByRole("textbox", { name: "Enter a URL" }).boundingBox();
  assert.ok(address.y > 32 && address.x >= bounds.x);
  const handle = page.getByRole("separator", { name: "Resize browser" });
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 100, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  const wider = await panel.boundingBox();
  assert.ok(wider.width > bounds.width + 60, "Dragging left expands the browser");
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  assert.ok((await panel.boundingBox()).width < wider.width, "Keyboard resizing works too");
  assert.ok(await page.getByText("Live output", { exact: true }).isVisible());
  await panel.getByRole("button", { name: "Hide browser" }).click();
  assert.equal(await panel.count(), 0);
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  await panel.waitFor();
  assert.ok((await panel.boundingBox()).width > bounds.width + 40, "Width survives closing and reopening");
  await page.setViewportSize({ width: 1600, height: 900 });
  const wideGrip = await handle.boundingBox();
  await page.mouse.move(wideGrip.x + 4, wideGrip.y + wideGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, wideGrip.y + wideGrip.height / 2, { steps: 8 });
  await page.mouse.up();
  const available = await panel.evaluate((element) => element.parentElement.getBoundingClientRect().width);
  assert.ok((await panel.boundingBox()).width > 720, "Wide screens are not capped at 720px");
  assert.ok(Math.abs((await panel.boundingBox()).width - available * 0.75) < 2);
  const expandedGrip = await handle.boundingBox();
  await page.mouse.move(expandedGrip.x + 4, expandedGrip.y + expandedGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(1590, expandedGrip.y + expandedGrip.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.ok(Math.abs((await panel.boundingBox()).width - available * 0.15) < 2);
});

test("调试上下文使用真实 Monaco 展示请求，可切换 Schema 且弹窗不溢出", async () => {
  await page.goto(`${baseUrl}/tests/browser/search.html`);
  await page.getByText("Live output", { exact: true }).waitFor();
  await page.keyboard.type("ohmycodedebug");
  await page.getByRole("button", { name: "Inspect current conversation context" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("actual-request-model", { exact: true }).waitFor();
  await dialog.locator(".monaco-editor").waitFor();
  await dialog.locator(".view-lines").getByText(/Actual\s+system\s+prompt/).waitFor();
  await dialog.getByRole("tab", { name: "Tool schemas" }).click();
  await dialog.locator(".view-lines").getByText(/read_file/).waitFor();
  await dialog.locator(".monaco-editor textarea").focus();
  await page.keyboard.press("Control+f");
  await dialog.locator(".find-widget.visible").waitFor();
  assert.equal(await page.getByRole("search").count(), 0, "Editor search must not open the conversation search behind the modal");
  await page.keyboard.press("Escape");
  assert.ok(await dialog.isVisible(), "Escape dismisses editor search before the dialog");
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1100 && bounds.y + bounds.height <= 800);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("heading", { name: "Debug settings" }).waitFor();
});
async function settle() {
  await page.evaluate(() => new Promise((resolve) => {
    let remaining = 4;
    const frame = () => { if (--remaining) requestAnimationFrame(frame); else resolve(); };
    requestAnimationFrame(frame);
  }));
}
async function wheel(delta) {
  await scroller().hover();
  const before = await scroller().evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, delta);
  await page.waitForFunction((previous) => document.querySelector('[data-virtuoso-scroller="true"]').scrollTop !== previous, before);
  await scroller().evaluate((element) => new Promise((resolve, reject) => {
    let previous = element.scrollTop, stable = 0, frames = 0;
    const check = () => {
      stable = element.scrollTop === previous ? stable + 1 : 0;
      previous = element.scrollTop;
      if (stable >= 8) resolve();
      else if (++frames > 120) reject(new Error("Scroll did not settle"));
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
  await settle();
}

test("真实布局：千条消息虚拟化，流式增长及输入框变高后正文不被遮挡", async () => {
  assert.ok(await page.locator("article").count() < 30);
  await page.evaluate(() => { window.chatFixture.stream(); window.chatFixture.growComposer(); });
  await settle();
  const last = await page.locator('[data-message="999"]').boundingBox();
  const composer = await page.locator("[data-composer]").boundingBox();
  assert.ok(last.y + last.height <= composer.y, "Last message must remain above the composer");
  const position = await scroller().evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
  assert.ok(position <= 2, `Expected bottom, remaining ${position}px`);
  assert.equal((await page.getByRole("banner").boundingBox()).y, 0);
});

test("轻微向上滚动解除贴底，新消息不打断阅读；回到底部后恢复跟随", async () => {
  await wheel(-160);
  assert.equal(await page.evaluate(() => window.chatFixture.follow()), false);
  const before = await scroller().evaluate((element) => element.scrollTop);
  const anchor = await page.locator("article").evaluateAll((rows) => {
    const row = rows.find((item) => item.getBoundingClientRect().y > 60);
    return { id: row.dataset.message, y: row.getBoundingClientRect().y };
  });
  await page.evaluate(() => { window.chatFixture.append(); window.chatFixture.stream(); });
  await settle();
  const after = await scroller().evaluate((element) => element.scrollTop);
  const y = await page.locator(`[data-message="${anchor.id}"]`).evaluate((row) => row.getBoundingClientRect().y);
  assert.ok(Math.abs(y - anchor.y) < 2, `Anchor moved from ${anchor.y} to ${y}; scroll ${before} -> ${after}`);
  await scroller().evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await settle();
  assert.equal(await page.evaluate(() => window.chatFixture.follow()), true);
  await page.evaluate(() => window.chatFixture.append()); await settle();
  const distance = await scroller().evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
  assert.ok(distance <= 2);
});

test("前插历史保持可见消息位置，虚拟行卸载后保留展开状态", async () => {
  await wheel(-500);
  const anchor = await page.locator("article").evaluateAll((rows) => {
    const row = rows.find((item) => item.getBoundingClientRect().y > 60);
    return { id: row.dataset.message, y: row.getBoundingClientRect().y };
  });
  const row = page.locator(`[data-message="${anchor.id}"]`);
  await row.getByRole("button", { name: "Details" }).click();
  await page.evaluate(() => window.chatFixture.prepend()); await settle();
  assert.equal(await row.count(), 1, JSON.stringify(await scroller().evaluate((element) => ({ top: element.scrollTop, height: element.scrollHeight, html: element.innerHTML.slice(0, 1800) }))));
  assert.ok(Math.abs((await row.boundingBox()).y - anchor.y) < 2, "Prepending must preserve the reading anchor");
  await scroller().evaluate((element) => { element.scrollTop = 0; }); await settle();
  assert.equal(await row.count(), 0);
  await scroller().evaluate((element) => { element.scrollTop = element.scrollHeight; }); await settle();
  await wheel(-500);
  await row.waitFor();
  assert.equal(await row.getByRole("button").getAttribute("aria-expanded"), "true");
});

test("全局搜索定位未加载的命中消息，后台输出继续且不抢回最新位置", async () => {
  await page.goto(`${baseUrl}/tests/browser/search.html`);
  await page.getByText("Live output", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Search conversations", exact: true }).fill("needle");
  await page.getByRole("button", { name: /Fixture conversation.*needle evidence 55/ }).click();
  const hit = page.locator("article p").filter({ hasText: /^needle evidence 55$/ });
  await hit.waitFor(); await settle();
  const before = await hit.boundingBox();
  assert.ok(before.y > 0 && before.y < 600);
  assert.ok(await hit.locator("mark").count() > 0);
  await page.evaluate(() => window.searchFixture.emitDelta()); await settle();
  assert.ok(Math.abs((await hit.boundingBox()).y - before.y) < 2);
  await page.getByRole("button", { name: "Back to latest" }).click();
  await page.getByText("Live output background continues", { exact: true }).waitFor();
});

test("Ctrl+F 搜索完整会话，Enter 与 Shift+Enter 跳转，Escape 退出搜索", async () => {
  await page.goto(`${baseUrl}/tests/browser/search.html`);
  await page.getByText("Live output", { exact: true }).waitFor();
  await page.keyboard.press("Control+f");
  const input = page.getByRole("textbox", { name: "Search this conversation", exact: true });
  await input.fill("needle");
  await page.locator("article p").filter({ hasText: /^needle evidence 5$/ }).waitFor();
  assert.equal(await page.getByRole("search").getByRole("status").textContent(), "1 / 2");
  await input.press("Enter");
  await page.locator("article p").filter({ hasText: /^needle evidence 55$/ }).waitFor();
  await input.press("Shift+Enter");
  await page.locator("article p").filter({ hasText: /^needle evidence 5$/ }).waitFor();
  await input.press("Escape");
  assert.equal(await page.getByRole("search").count(), 0);
  assert.ok(await page.getByRole("button", { name: "Back to latest" }).isVisible());
});

test("聊天模式切换为语音界面，未选择模型不开麦，退出保留原文字草稿", async () => {
  await page.goto(`${baseUrl}/tests/browser/search.html`);
  await page.getByText("Live output", { exact: true }).waitFor();
  const editor = page.getByRole("textbox", { name: "Describe a task…" });
  await editor.fill("Keep my draft");
  const toggle = page.getByRole("button", { name: "Chat mode", exact: true });
  await toggle.click();
  const voicePanel = page.getByRole("region", { name: "Chat mode", exact: true });
  await voicePanel.waitFor();
  assert.equal(await editor.count(), 0);
  assert.equal(await voicePanel.getByRole("button").count(), 0);
  assert.equal(await voicePanel.locator("p").count(), 0);
  const panelStyle = await voicePanel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopWidth, blur: style.backdropFilter };
  });
  assert.deepEqual(panelStyle, { background: "rgba(0, 0, 0, 0)", border: "0px", blur: "none" });
  assert.equal(await page.getByText("Speak naturally; pause to send", { exact: true }).count(), 0);
  const orb = voicePanel.locator('[aria-hidden="true"] > div');
  await orb.locator("svg").waitFor();
  const idleFrame = await orb.locator("svg").evaluate((element) => element.innerHTML);
  await page.waitForFunction((before) => {
    const svg = document.querySelector('section[aria-label="Chat mode"] [aria-hidden="true"] svg');
    return svg.innerHTML !== before;
  }, idleFrame);
  const silentTransform = await orb.evaluate((element) => getComputedStyle(element).transform);
  await page.evaluate(async () => {
    const { SpeechPlayback } = await import("/src/features/speech/speech-playback.ts");
    SpeechPlayback.prototype.readLevel = () => 0.25;
  });
  await page.waitForFunction((before) => {
    const panel = document.querySelector('section[aria-label="Chat mode"]');
    const orb = panel.querySelector('[aria-hidden="true"] > div');
    return getComputedStyle(orb).transform !== before;
  }, silentTransform);
  const speakingTransform = await orb.evaluate((element) => getComputedStyle(element).transform);
  assert.ok(Number(speakingTransform.match(/^matrix\(([^,]+)/)[1]) > 1, "Speaking enlarges the orb");
  await page.evaluate(async () => {
    const { SpeechPlayback } = await import("/src/features/speech/speech-playback.ts");
    SpeechPlayback.prototype.readLevel = () => 0;
  });
  await page.waitForFunction(() => {
    const orb = document.querySelector('section[aria-label="Chat mode"] [aria-hidden="true"] > div');
    return Number(getComputedStyle(orb).transform.match(/^matrix\(([^,]+)/)[1]) < 1.01;
  });
  const bounds = await voicePanel.boundingBox();
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 800, "Voice panel remains inside the viewport");
  assert.ok(bounds.height < 140, "Idle orb panel keeps compact vertical spacing");
  await toggle.click();
  await editor.waitFor();
  assert.equal(await editor.textContent(), "Keep my draft");
});
