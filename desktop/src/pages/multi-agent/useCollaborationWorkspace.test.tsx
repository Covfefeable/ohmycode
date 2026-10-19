import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { useCollaborationWorkspace } from "./useCollaborationWorkspace";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../../features/feedback", () => ({ useFeedback: () => ({ toast }) }));
const agent: MultiAgentSummary = {
  id: "team", name: "Team", description: "Description", division: "Division", tasks: [],
  createdAt: "2026-10-19T00:00:00Z",
  templateTeam: { title: "Team", members: [
    { key: "host", name: "Host", role: "Host", instructions: "Guide", isHost: true, sortOrder: 0 },
  ] },
};
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={["/agents"]}>{children}</MemoryRouter>;
beforeEach(() => sessionStorage.clear());

test("模板编辑不制造运行任务，保存只发送模板字段", async () => {
  const update = vi.fn(async (_id: string, payload: Partial<MultiAgentSummary>) => ({ ...agent, ...payload }));
  Object.defineProperty(window, "ohmycode", { configurable: true, value: {
    multiAgents: { list: vi.fn(async () => [agent]), update },
    settings: { listModels: vi.fn(async () => []), onModelsChanged: () => () => {} },
  } });
  const { result } = renderHook(() => useCollaborationWorkspace(), { wrapper });
  await waitFor(() => expect(result.current.agents).toHaveLength(1));
  act(() => result.current.selectAgent(agent.id));
  expect(result.current.task).toBeNull();
  expect(result.current.team).toEqual(agent.templateTeam);
  act(() => result.current.addMember());
  const member = result.current.team!.members[1];
  expect(member).not.toHaveProperty("id");
  expect(member).not.toHaveProperty("status");
  act(() => result.current.updateMember("name", "Writer"));
  await act(() => result.current.saveTeam());
  expect(update).toHaveBeenCalledWith(agent.id, { templateTeam: expect.objectContaining({
    members: expect.arrayContaining([expect.objectContaining({ name: "Writer" })]),
  }) });
  expect(result.current.task).toBeNull();
  expect(agent.templateTeam.members).toHaveLength(1);
});
