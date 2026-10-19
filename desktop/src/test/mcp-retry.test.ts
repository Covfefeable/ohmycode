import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callTool: vi.fn(), connect: vi.fn(), close: vi.fn(), request: vi.fn() }));
vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: class {
  connect = mocks.connect; close = mocks.close; callTool = mocks.callTool;
} }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: class {} }));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({ SSEClientTransport: class {} }));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: class {} }));
vi.mock("../../electron/api/api-client.js", () => ({ apiRequest: mocks.request }));
import { callMcpTool, closeMcpSessions } from "../../electron/capabilities/mcp-manager";

afterEach(() => closeMcpSessions());
test("工具失败不自动重放，后续显式调用才重新连接", async () => {
  mocks.close.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue({ servers: [{ id: "server", transport: "http", configuration: { url: "https://example.com/mcp" } }] });
  mocks.callTool.mockRejectedValueOnce(new Error("response_lost")).mockResolvedValueOnce({ ok: true });
  await expect(callMcpTool("server", "create_issue", {})).rejects.toThrow("response_lost");
  expect(mocks.callTool).toHaveBeenCalledOnce();
  await expect(callMcpTool("server", "create_issue", {})).resolves.toEqual({ ok: true });
  expect(mocks.connect).toHaveBeenCalledTimes(2);
  expect(mocks.callTool).toHaveBeenCalledTimes(2);
});
