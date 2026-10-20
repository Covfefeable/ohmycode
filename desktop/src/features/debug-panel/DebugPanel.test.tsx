import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { DebugPanel } from "./DebugPanel";

vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: vi.fn() }) }));
vi.mock("./context-inspector/ContextInspector", () => ({ ContextInspector: ({ conversationId }: { conversationId: string }) => <div data-testid="inspector">{conversationId}</div> }));

function open(path: string) {
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { debug: { getConfig: async () => ({ apiUrl: "http://localhost:8765" }) } } });
  render(<MemoryRouter initialEntries={[path]}><DebugPanel /></MemoryRouter>);
  for (const key of "ohmycodedebug") fireEvent.keyDown(window, { key });
}

test("快捷键固定当前会话，不受之后会话选择变化影响", async () => {
  sessionStorage.setItem("ohmycode.activeConversationId", "conversation-a");
  open("/");
  const button = await screen.findByRole("button", { name: "Inspect current conversation context" });
  sessionStorage.setItem("ohmycode.activeConversationId", "conversation-b");
  fireEvent.click(button);
  expect(screen.getByTestId("inspector").textContent).toBe("conversation-a");
});

test("非会话页面不能误用 sessionStorage 中残留的会话", async () => {
  sessionStorage.setItem("ohmycode.activeConversationId", "conversation-a");
  open("/settings");
  expect((await screen.findByRole("button", { name: "Inspect current conversation context" }) as HTMLButtonElement).disabled).toBe(true);
});
