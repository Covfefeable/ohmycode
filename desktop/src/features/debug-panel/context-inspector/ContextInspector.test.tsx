import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ContextInspector } from "./ContextInspector";
import type { ContextSnapshot } from "../../../../electron/debug/types";

vi.mock("./ContextJson", () => ({ default: ({ value }: { value: string }) => <pre data-testid="context-json">{value}</pre> }));
vi.mock("../../feedback", () => ({ useFeedback: () => ({ toast: vi.fn() }) }));

function fixture(model = "request-model"): ContextSnapshot {
  return { conversationId: "a", title: "Current conversation", snapshot: {
    capturedAt: "2026-10-20T00:00:00Z", runId: "turn", executionId: "execution", step: 0, status: "completed",
    body: { model, messages: [{ role: "user", content: "Actual sent content" }], tools: [{ type: "function", function: { name: "read_file" } }] },
    estimatedTokens: 100, contextLength: 4096, compacted: false, messageCount: 1, toolCount: 1, requestBytes: 256,
    usage: { prompt_tokens: 120, prompt_tokens_details: { cached_tokens: 0 } },
  } };
}

test("展示真实请求的模型和内容，仅手动刷新才更新，切换页签不发请求", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(fixture()).mockResolvedValueOnce(fixture("new-request-model"));
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { debug: { contextSnapshot: fetch } } });
  render(<ContextInspector conversationId="a" onClose={vi.fn()} />);
  expect(await screen.findByText("request-model")).toBeTruthy();
  expect(await screen.findByTestId("context-json")).toBeTruthy();
  expect(screen.getByTestId("context-json").textContent).toContain("Actual sent content");
  fireEvent.click(screen.getByRole("tab", { name: "Tool schemas" }));
  expect(screen.getByTestId("context-json").textContent).toContain("read_file");
  fireEvent.click(screen.getByRole("tab", { name: "Full request" }));
  expect(screen.getByTestId("context-json").textContent).toContain("request-model");
  expect(fetch).toHaveBeenCalledExactlyOnceWith("a");
  fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
  await screen.findByText("new-request-model");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("无历史快照和加载失败均明确提示，并允许重试", async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ...fixture(), snapshot: null }).mockRejectedValueOnce(new Error("network"));
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { debug: { contextSnapshot: fetch } } });
  render(<ContextInspector conversationId="a" onClose={vi.fn()} />);
  await screen.findByText(/No request snapshot yet/);
  expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not load context"));
  expect((screen.getByRole("button", { name: "Refresh snapshot" }) as HTMLButtonElement).disabled).toBe(false);
});
