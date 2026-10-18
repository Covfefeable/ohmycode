import { createRef } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { VirtuosoMockContext, type VirtuosoHandle } from "react-virtuoso";
import { afterEach, expect, test, vi } from "vitest";
import { MessageList } from "./MessageList";

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  vi.unstubAllGlobals();
});

test("千条已加载消息不会全部挂入 DOM，轻微向上滚动立即解除贴底", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 100_160 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = options.top ?? 0;
    this.dispatchEvent(new Event("scroll"));
  } });
  const followRef = { current: true };
  const messages: LocalMessage[] = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), role: "user", content: `Message ${index}`, createdAt: "2026-10-18T00:00:00Z" }));
  const { container } = render(<VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 100 }}>
    <MessageList messages={messages} prependedCount={0} clearance={160} loading={false} failed={false} loadOlder={vi.fn(async () => {})} active listRef={createRef<VirtuosoHandle>()} followRef={followRef} renderMessage={(message) => <article>{message.content}</article>} />
  </VirtuosoMockContext.Provider>);
  await waitFor(() => expect(container.querySelectorAll("article").length).toBeGreaterThan(0));
  expect(container.querySelectorAll("article").length).toBeLessThan(30);
  const scroller = container.querySelector('[data-virtuoso-scroller="true"]')!;
  fireEvent.wheel(scroller, { deltaY: -1 });
  expect(followRef.current).toBe(false);
});
