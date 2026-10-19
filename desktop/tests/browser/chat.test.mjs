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
