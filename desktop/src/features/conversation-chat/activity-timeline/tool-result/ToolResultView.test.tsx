import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { presentToolActivity } from "../tool-presentation";
import { ToolResultView } from "../ToolResultView";

vi.mock("../../../../shared/ui/image-preview/MarkdownImage", () => ({ MarkdownImage: ({ src }: { src: string }) => <img src={src} alt="Tool image" /> }));

const clipboard = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  clipboard.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
});

function show(tool: string, input: unknown, result: unknown) {
  return render(<ToolResultView presentation={presentToolActivity(tool, input, result)} completed />);
}

it("shows parameters even without output and copies the selected tab's exact value", async () => {
  const input = { selector: { text: "Install", enabled: false }, timeout: 0 };
  show("android_act", input, undefined);
  expect(screen.getByText("No output yet")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Input parameters" }));
  fireEvent.click(screen.getByRole("button", { name: "Raw data" }));
  expect(screen.getByRole("tabpanel").textContent).toBe(JSON.stringify(input, null, 2));
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith(JSON.stringify(input, null, 2)));
});

it("separates command output, ANSI colors, and exit metadata while retaining raw results", () => {
  const result = { output: "\u001b[31mFailed\u001b[0m\nsecond line", exitCode: 1, terminalId: "term-1" };
  show("terminal", { command: "build app" }, result);
  expect(screen.getByText("build app")).toBeTruthy();
  expect(screen.getByText("Failed").className).toContain("ansi-red-fg");
  expect(screen.getByText(/Exit code 1/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Raw data" }));
  expect(screen.getByRole("tabpanel").textContent).toBe(JSON.stringify(result, null, 2));
});

it("shows record lists without knowing browser or Android field names", () => {
  const result = { title: "Settings", rotation: 1, nodes: [
    { nodeId: 10, role: "button", name: "Browser control", extra: "retained" },
    { id: 20, class: "android.widget.Switch", text: "Device control", checked: false },
  ] };
  show("snapshot_provider", {}, result);
  expect(screen.getByText("Browser control")).toBeTruthy();
  expect(screen.getByText("Device control")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Raw data" }));
  expect(screen.getByRole("tabpanel").textContent).toBe(JSON.stringify(result, null, 2));
});

it("renders unknown collection names and heterogeneous nested records without a tool adapter", () => {
  const result = { arbitraryCollection: [
    { name: "First record", properties: { enabled: false } },
    { name: "Second record", count: 0 },
  ] };
  show("unknown_tool", {}, result);
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "properties" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "count" })).toBeTruthy();
  expect(screen.getAllByText("false").length).toBeGreaterThan(0);
  expect(screen.getByText("0")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Raw data" }));
  expect(screen.getByRole("tabpanel").textContent).toBe(JSON.stringify(result, null, 2));
});

it("renders MCP Markdown and images without tool-specific mappings", () => {
  const imageRef = `ohmycode-image://00000000-0000-0000-0000-000000000001/${"a".repeat(64)}`;
  show("mcp__any__tool", {}, { content: [
    { type: "text", text: "**Readable result**" },
    { type: "image", imageRef, mimeType: "image/png" },
  ] });
  expect(screen.getByText("Readable result").tagName).toBe("STRONG");
  expect(screen.getByRole("img", { name: "Tool image" }).getAttribute("src")).toBe(imageRef);
});

it("does not interpret JSON document fields as execution failures or hide false and zero results", () => {
  const view = show("custom", {}, '{"error":"document text"}');
  expect(screen.queryByRole("alert")).toBeNull();
  view.rerender(<ToolResultView presentation={presentToolActivity("custom", {}, false)} completed />);
  expect(screen.getByText("false")).toBeTruthy();
  view.rerender(<ToolResultView presentation={presentToolActivity("custom", {}, 0)} completed />);
  expect(screen.getByText("0")).toBeTruthy();
});

it("renders JSON inside MCP text as tables without changing the original text or success state", () => {
  const text = JSON.stringify({ return: [{ country: "中国", province: "广东省", city: "惠州市", street: [], active: false, count: 0 }] });
  const result = { content: [{ type: "text", text }], isError: false };
  show("mcp__maps__geo", {}, result);
  expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
  expect(screen.getByText(/惠州市/)).toBeTruthy();
  expect(screen.queryByText("isError")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Raw data" }));
  expect(screen.getByRole("tabpanel").textContent).toBe(JSON.stringify(result, null, 2));
});

it("expands the same selected data in a dialog and closes with Escape", () => {
  show("custom", { query: "test" }, { ok: true });
  fireEvent.click(screen.getByRole("tab", { name: "Input parameters" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand view" }));
  const dialog = screen.getByRole("dialog", { name: "Tool details" });
  expect(within(dialog).getByRole("tab", { name: "Input parameters" }).getAttribute("aria-selected")).toBe("true");
  fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("tab", { name: "Input parameters" }).getAttribute("aria-selected")).toBe("true");
});
