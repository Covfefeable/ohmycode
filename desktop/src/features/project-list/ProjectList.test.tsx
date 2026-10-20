import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ProjectList } from "./ProjectList";

vi.mock("../feedback", () => ({ useFeedback: () => ({ toast }) }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
beforeEach(() => sessionStorage.removeItem("ohmycode.workspace.expandedProjects"));

test("项目展开和手动收起在页面卸载后仍记忆", async () => {
  const conversation = { id: "thread", title: "Remembered chat", createdAt: "", updatedAt: "" };
  const project = { id: "remembered", name: "Remembered project", conversations: [conversation], path: "/remembered", deviceId: "test", deviceName: "Test" };
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { projects: { list: async () => [project] } } });
  const props = { selectedConversationId: "thread", onConversationSelect: vi.fn(), onConversationDelete: vi.fn(), refreshToken: 0, heading: <h2>Projects</h2> };
  let view = render(<ProjectList {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Remembered project" }));
  expect(await screen.findByRole("button", { name: "Remembered chat" })).toBeTruthy();
  view.unmount();
  view = render(<ProjectList {...props} />);
  expect(await screen.findByRole("button", { name: "Remembered chat" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remembered project" }));
  view.unmount();
  render(<ProjectList {...props} />);
  await screen.findByRole("button", { name: "Remembered project" });
  expect(screen.queryByRole("button", { name: "Remembered chat" })).toBeNull();
});

test("列表失败保留明确错误，由用户重试而不是固定轮询", async () => {
  const list = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { projects: { list } } });
  render(<ProjectList selectedConversationId={null} onConversationSelect={vi.fn()} onConversationDelete={vi.fn()} refreshToken={0} heading={<h2>Projects</h2>} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(list).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(list).toHaveBeenCalledTimes(2);
});

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
