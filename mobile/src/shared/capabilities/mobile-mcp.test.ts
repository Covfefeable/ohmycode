import { expect, test, vi } from "vitest";
import { MobileMcpClient } from "./mobile-mcp";

const mocks = vi.hoisted(() => ({ callTool: vi.fn(), connect: vi.fn(), close: vi.fn(), request: vi.fn() }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("@/shared/api/api-client", () => ({ authenticatedRequest: mocks.request }));
vi.mock("@modelcontextprotocol/sdk/client", () => ({ Client: class {
  connect = mocks.connect; close = mocks.close; callTool = mocks.callTool;
} }));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: class {} }));

test("移动端 MCP 不在响应失败后自动重放写操作", async () => {
  mocks.close.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue({ servers: [{ id: "server", enabled: true, transport: "http", configuration: { url: "https://example.com/mcp" }, tools: [{ name: "create_issue" }] }] });
  mocks.callTool.mockRejectedValueOnce(new Error("response_lost"));
  const client = new MobileMcpClient();
  try {
    const { createMcpToolName } = await import("@ohmycode/tool-contracts");
    await expect(client.execute(createMcpToolName("server", "create_issue"), {})).rejects.toThrow("response_lost");
    expect(mocks.callTool).toHaveBeenCalledOnce();
  } finally {
    await client.close();
  }
});
