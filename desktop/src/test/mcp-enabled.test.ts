import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), call: vi.fn() }));
vi.mock("../../electron/capabilities/mcp-manager.js", () => ({ listMcpServers: mocks.list, callMcpTool: mocks.call }));
vi.mock("../../electron/capabilities/skill-manager.js", () => ({}));
vi.mock("../../electron/api/api-client.js", () => ({}));
import { executeMcpCapability, loadCapability } from "../../electron/capabilities/capability-manager";
import { createMcpToolName } from "@ohmycode/tool-contracts";

test("disabled MCP cannot be loaded or invoked using a previously known tool name", async () => {
  const id = "603677f7-73f0-4c00-a000-000000000001";
  mocks.list.mockResolvedValue([{ id, enabled: false, tools: [{ name: "search" }] }]);
  await expect(loadCapability(`mcp:${id}`)).rejects.toThrow("mcp_server_not_found");
  await expect(executeMcpCapability(createMcpToolName(id, "search"), {})).rejects.toThrow("mcp_tool_not_found");
  expect(mocks.call).not.toHaveBeenCalled();
});
