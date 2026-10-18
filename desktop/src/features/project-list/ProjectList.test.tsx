import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ProjectList } from "./ProjectList";

vi.mock("../feedback", () => ({ useFeedback: () => ({ toast }) }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));

test.each(["target-message", null])("全局搜索传递准确的消息位置，标题命中 %s 不制造定位", async (messageId) => {
  const conversation: LocalConversation = { id: "thread", title: "Chosen conversation", createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z" };
  const project: LocalProject = { id: "project", name: "Project", path: "/project", deviceId: "test", deviceName: "Test", conversations: [conversation] };
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { projects: {
    list: async () => [project],
    searchConversations: async () => [{ projectId: project.id, projectName: project.name, conversation, snippet: "Matching evidence", messageId }],
  } } });
  const onConversationSelect = vi.fn();
  render(<ProjectList selectedConversationId={null} onConversationSelect={onConversationSelect} onConversationDelete={vi.fn()} refreshToken={0} heading={<h2>Projects</h2>} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "evidence" } });
  fireEvent.click(await screen.findByRole("button", { name: /Chosen conversation/ }));
  expect(onConversationSelect).toHaveBeenCalledWith(project, conversation, messageId ? { messageId, query: "evidence" } : undefined);
});
