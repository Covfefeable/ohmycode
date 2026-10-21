import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserState } from "@ohmycode/browser-use/types";
import { BrowserPanel } from "./BrowserPanel";

const state: BrowserState = { opened: true, selectedId: "tab-1", tabs: [{ id: "tab-1", title: "Example", url: "https://example.com/", loading: false, canGoBack: false, canGoForward: false }] };
const command = vi.fn().mockResolvedValue(state);
const layout = vi.fn().mockResolvedValue(undefined);
const reserveSpace = vi.fn().mockResolvedValue(1024);

beforeEach(() => {
  command.mockClear(); layout.mockClear(); reserveSpace.mockClear();
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { browser: { command, layout, reserveSpace } } });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 500, y: 140, width: 400, height: 500 } as DOMRect);
});
afterEach(() => vi.unstubAllGlobals());

it("uses shared controls and sends navigation only through the browser bridge", async () => {
  const close = vi.fn();
  render(<BrowserPanel conversationId="conversation" state={state} active onClose={close} />);
  expect(screen.getByRole("button", { name: "Back" }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Enter a URL" }), { target: { value: "example.org/path" } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await waitFor(() => expect(command).toHaveBeenCalledWith("conversation", { action: "navigate", url: "https://example.org/path" }));
  fireEvent.click(screen.getByRole("button", { name: "Close tab" }));
  expect(command).toHaveBeenCalledWith("conversation", { action: "close", tabId: "tab-1" });
  fireEvent.click(screen.getByRole("button", { name: "Hide browser" }));
  expect(close).toHaveBeenCalledOnce();
});

it("detaches the native page on unmount and masks it while a modal is open", async () => {
  const view = render(<BrowserPanel conversationId="one" state={state} active onClose={() => undefined} />);
  await waitFor(() => expect(layout).toHaveBeenLastCalledWith("one", { x: 500, y: 140, width: 400, height: 500 }));
  expect(reserveSpace).toHaveBeenCalledTimes(1);
  const modal = document.createElement("div");
  modal.setAttribute("aria-modal", "true");
  modal.getClientRects = () => [1] as unknown as DOMRectList;
  act(() => document.body.append(modal));
  await waitFor(() => expect(layout).toHaveBeenLastCalledWith("one", null));
  act(() => modal.remove());
  await waitFor(() => expect(layout).toHaveBeenLastCalledWith("one", { x: 500, y: 140, width: 400, height: 500 }));
  view.unmount();
  expect(layout).toHaveBeenLastCalledWith(null, null);
  expect(reserveSpace).toHaveBeenLastCalledWith(0);
});

it("preserves the base chat width returned by the host when switching from an expanded window", async () => {
  reserveSpace.mockResolvedValueOnce(900);
  const view = render(<BrowserPanel conversationId="two" state={state} active onClose={() => undefined} />);
  const panel = screen.getByRole("complementary");
  await waitFor(() => expect(panel.parentElement!.style.getPropertyValue("--browser-chat-min-width")).toBe("276px"));
  view.unmount();
  expect(panel.parentElement).toBeNull();
  expect(reserveSpace).toHaveBeenLastCalledWith(0);
});

it("displays navigation errors instead of leaving an unhandled rejection", async () => {
  command.mockRejectedValueOnce(new Error("browser_unsupported_url"));
  render(<BrowserPanel conversationId="one" state={state} active={false} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(reserveSpace).not.toHaveBeenCalled();
});
