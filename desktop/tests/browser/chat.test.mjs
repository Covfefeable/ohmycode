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
